// Local Supabase-compatible stack with no Docker:
//   * embedded Postgres 17 (real server binaries via the embedded-postgres package)
//   * PostgREST 16 (Windows binary in .local-stack/bin, libpq DLLs borrowed from the Postgres package)
//   * a small gateway on :54321 that proxies /rest/v1 to PostgREST and emulates the Storage and
//     Auth-admin endpoints the app calls (object upload, signed URL, download, admin user lookup)
//
//   npm run stack            # start everything, print the env block
//   npm run stack -- --with-app   # also start `next dev` on :3000 wired to the stack
//   npm run stack -- --reset      # wipe the data directory first
//
// Then, in another terminal:  INTEGRATION_BASE_URL=http://localhost:3000 npm test -- integration
//
// This is a development substitute for the shared AWM Supabase project. It applies the SAME SQL
// (prisma migration, 001, 003, 002) so the services run against the real schema, RLS and triggers.

import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STACK = path.join(ROOT, ".local-stack");
const DB_DIR = path.join(STACK, "db");
const FILES_DIR = path.join(STACK, "storage");
const PGRST_EXE = path.join(STACK, "bin", "postgrest.exe");
const PG_BIN = path.join(ROOT, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin");

const PG_PORT = Number(process.env.STACK_PG_PORT ?? 54322);
const PGRST_PORT = Number(process.env.STACK_PGRST_PORT ?? 54323);
const API_PORT = Number(process.env.STACK_API_PORT ?? 54321);
const APP_PORT = Number(process.env.STACK_APP_PORT ?? 3000);

const JWT_SECRET = "local-stack-only-jwt-secret-0123456789abcdefghijklmnopqrstuvwxyz";
const AUTHENTICATOR_PASSWORD = "authenticator";
const SIGN_SECRET = "local-stack-storage-signing-secret";

const args = new Set(process.argv.slice(2));
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

// ---- JWTs (same shape Supabase issues) ---------------------------------------------------------
const b64url = (s) => Buffer.from(s).toString("base64url");
function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: "supabase-local", iat: 1700000000, exp: 4102444800, ...payload }));
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}
const ANON_KEY = signJwt({ role: "anon" });
const SERVICE_KEY = signJwt({ role: "service_role" });

// ---- Postgres --------------------------------------------------------------------------------
if (args.has("--reset") && existsSync(DB_DIR)) {
  log("resetting data directory");
  rmSync(DB_DIR, { recursive: true, force: true });
  rmSync(FILES_DIR, { recursive: true, force: true });
}
mkdirSync(FILES_DIR, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: DB_DIR,
  user: "postgres",
  password: "postgres",
  port: PG_PORT,
  persistent: true,
  onLog: () => {},
  onError: (m) => {
    const s = String(m).trim();
    if (s && !/LOG:|HINT:|database system/.test(s)) console.error("[postgres]", s.split("\n")[0]);
  },
});

const fresh = !existsSync(path.join(DB_DIR, "PG_VERSION"));
if (fresh) {
  log("initialising Postgres cluster");
  await pg.initialise();
}
log(`starting Postgres on :${PG_PORT}`);
await pg.start();

const sql = pg.getPgClient();
await sql.connect();

const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const stripTx = (s) => s.replace(/^\s*(BEGIN|COMMIT);\s*$/gim, "");

await sql.query(`
  CREATE TABLE IF NOT EXISTS public.local_stack_applied (name text PRIMARY KEY, applied_at timestamptz DEFAULT now());
`);
const applied = new Set((await sql.query(`SELECT name FROM public.local_stack_applied`)).rows.map((r) => r.name));
async function apply(name, body) {
  if (applied.has(name)) return;
  log(`applying ${name}`);
  await sql.query("BEGIN");
  try {
    await sql.query(body);
    await sql.query(`INSERT INTO public.local_stack_applied (name) VALUES ($1)`, [name]);
    await sql.query("COMMIT");
  } catch (e) {
    await sql.query("ROLLBACK");
    throw new Error(`${name} failed: ${e.message}`);
  }
}

await apply(
  "000_supabase_stubs",
  `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
      CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '${AUTHENTICATOR_PASSWORD}';
    END IF;
  END $$;
  GRANT anon, authenticated, service_role TO authenticator;

  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY, instance_id uuid, aud text, role text, email text, encrypted_password text,
    email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
    created_at timestamptz, updated_at timestamptz
  );
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;

  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE IF NOT EXISTS storage.buckets (
    id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text, owner uuid,
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), metadata jsonb
  );
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
`
);
await apply("010_prisma_init", read("prisma/migrations/20260913000000_init/migration.sql"));
await apply("020_rls_constraints", stripTx(read("supabase/sql/001_rls_and_constraints.sql")));
await apply("030_storage", stripTx(read("supabase/sql/003_storage.sql")));
await apply("040_seed_dev", stripTx(read("supabase/sql/002_seed_dev.sql")));
// PostgREST resolves the schema cache as authenticator; the RPC and tables must be visible to it.
await apply("050_postgrest_grants", `GRANT USAGE ON SCHEMA trust_reg TO anon; GRANT USAGE ON SCHEMA storage, auth TO service_role;`);

const counts = await sql.query(
  `SELECT (SELECT count(*) FROM trust_reg.profiles) AS profiles, (SELECT count(*) FROM trust_reg.trust_cases) AS cases`
);
log(`schema ready: ${counts.rows[0].profiles} profiles, ${counts.rows[0].cases} cases`);

// ---- PostgREST -------------------------------------------------------------------------------
if (!existsSync(PGRST_EXE)) {
  console.error(`PostgREST binary missing at ${PGRST_EXE}. Download postgrest-v16.3-windows-x86-64.zip from GitHub and unzip it there.`);
  process.exit(1);
}
const pgrst = spawn(PGRST_EXE, [], {
  env: {
    ...process.env,
    PATH: `${PG_BIN};${process.env.PATH ?? ""}`,
    PGRST_DB_URI: `postgres://authenticator:${AUTHENTICATOR_PASSWORD}@127.0.0.1:${PG_PORT}/postgres`,
    PGRST_DB_SCHEMAS: "public,trust_reg",
    PGRST_DB_ANON_ROLE: "anon",
    PGRST_DB_POOL: "4",
    PGRST_JWT_SECRET: JWT_SECRET,
    PGRST_SERVER_HOST: "127.0.0.1",
    PGRST_SERVER_PORT: String(PGRST_PORT),
    PGRST_LOG_LEVEL: "error",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
pgrst.stdout.on("data", (d) => process.stdout.write(`[postgrest] ${d}`));
pgrst.stderr.on("data", (d) => process.stderr.write(`[postgrest] ${d}`));
pgrst.on("exit", (code) => log(`postgrest exited (${code})`));

async function waitFor(url, headers = {}, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${url}`);
}
await waitFor(`http://127.0.0.1:${PGRST_PORT}/`, { apikey: ANON_KEY });
log(`PostgREST ready on :${PGRST_PORT}`);

// ---- Gateway: /rest/v1 proxy + Storage + Auth admin emulation -------------------------------------
const safeSegments = (p) => p.split("/").filter((s) => s && s !== "." && s !== "..");
const objectPath = (bucket, key) => path.join(FILES_DIR, ...safeSegments(bucket), ...safeSegments(key));
const sign = (bucket, key, exp) => createHmac("sha256", SIGN_SECRET).update(`${bucket}/${key}/${exp}`).digest("base64url");

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function extractMultipartFile(buf, contentType) {
  const m = /boundary=("?)([^";]+)\1/.exec(contentType);
  if (!m) return buf;
  const boundary = Buffer.from(`--${m[2]}`);
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const headEnd = buf.indexOf("\r\n\r\n", start);
    if (headEnd === -1) break;
    const head = buf.subarray(start, headEnd).toString();
    const next = buf.indexOf(boundary, headEnd);
    if (/filename=/.test(head)) return buf.subarray(headEnd + 4, next - 2);
    start = next;
  }
  return buf;
}

async function proxyToPostgrest(req, res) {
  const target = `http://127.0.0.1:${PGRST_PORT}${req.url.replace(/^\/rest\/v1/, "")}`;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
  const upstream = await fetch(target, { method: req.method, headers, body, redirect: "manual" });
  const out = {};
  upstream.headers.forEach((v, k) => {
    if (!["content-encoding", "transfer-encoding", "connection"].includes(k)) out[k] = v;
  });
  res.writeHead(upstream.status, out);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

async function handleStorage(req, res, url) {
  const rest = url.pathname.replace(/^\/storage\/v1\//, "");

  // POST /object/sign/{bucket}/{key}  -> signed URL
  let m = /^object\/sign\/([^/]+)\/(.+)$/.exec(rest);
  if (m && req.method === "POST") {
    const [, bucket, key] = m;
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    if (!existsSync(objectPath(bucket, decodeURIComponent(key)))) return json(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
    const exp = Math.floor(Date.now() / 1000) + Number(body.expiresIn ?? 60);
    const token = `${exp}.${sign(bucket, decodeURIComponent(key), exp)}`;
    return json(res, 200, { signedURL: `/object/sign/${bucket}/${key}?token=${token}` });
  }
  // GET /object/sign/{bucket}/{key}?token=...  -> file
  if (m && req.method === "GET") {
    const [, bucket, key] = m;
    const token = url.searchParams.get("token") ?? "";
    const [expStr, sig = ""] = token.split(".");
    const expected = sign(bucket, decodeURIComponent(key), Number(expStr));
    const okSig = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!okSig || Number(expStr) < Date.now() / 1000) return json(res, 400, { statusCode: "400", error: "InvalidJWT", message: "Signed URL invalid or expired" });
    return serveFile(res, objectPath(bucket, decodeURIComponent(key)), url.searchParams.get("download"));
  }
  // POST|PUT /object/{bucket}/{key}  -> upload
  m = /^object\/([^/]+)\/(.+)$/.exec(rest);
  if (m && (req.method === "POST" || req.method === "PUT")) {
    const [, bucket, key] = m;
    const decoded = decodeURIComponent(key);
    const file = objectPath(bucket, decoded);
    if (existsSync(file) && req.method === "POST" && req.headers["x-upsert"] !== "true") {
      return json(res, 409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    }
    const raw = await readBody(req);
    const bytes = /^multipart\/form-data/.test(req.headers["content-type"] ?? "") ? extractMultipartFile(raw, req.headers["content-type"]) : raw;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    writeFileSync(`${file}.meta.json`, JSON.stringify({ contentType: req.headers["content-type"], size: bytes.length, uploadedAt: new Date().toISOString() }));
    await sql.query(
      `INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [bucket, decoded, { size: bytes.length, mimetype: req.headers["content-type"] }]
    ).catch(() => {});
    return json(res, 200, { Key: `${bucket}/${decoded}`, Id: `${bucket}:${decoded}` });
  }
  // GET /object/{bucket}/{key} (service role)  -> file
  if (m && req.method === "GET") return serveFile(res, objectPath(m[1], decodeURIComponent(m[2])), null);
  // DELETE /object/{bucket}  body { prefixes: [] }
  m = /^object\/([^/]+)$/.exec(rest);
  if (m && req.method === "DELETE") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    for (const p of body.prefixes ?? []) rmSync(objectPath(m[1], p), { force: true });
    return json(res, 200, (body.prefixes ?? []).map((name) => ({ name })));
  }
  if (rest === "bucket" && req.method === "GET") {
    const r = await sql.query(`SELECT id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at FROM storage.buckets`);
    return json(res, 200, r.rows);
  }
  return json(res, 404, { statusCode: "404", error: "not_found", message: `local stack: unsupported storage route ${req.method} ${rest}` });
}

function serveFile(res, file, downloadAs) {
  if (!existsSync(file)) return json(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
  let meta = {};
  try {
    meta = JSON.parse(readFileSync(`${file}.meta.json`, "utf8"));
  } catch {}
  const headers = { "content-type": meta.contentType ?? "application/octet-stream", "content-length": statSync(file).size, "cache-control": "no-store" };
  if (downloadAs != null) headers["content-disposition"] = `attachment; filename="${downloadAs || path.basename(file)}"`;
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

async function handleAuth(req, res, url) {
  const rest = url.pathname.replace(/^\/auth\/v1\//, "");
  if (rest === "health") return json(res, 200, { name: "local-stack-auth", version: "0" });
  const m = /^admin\/users\/([0-9a-f-]{36})$/.exec(rest);
  if (m && req.method === "GET") {
    const r = await sql.query(`SELECT id, email, created_at, updated_at, email_confirmed_at, raw_app_meta_data, raw_user_meta_data FROM auth.users WHERE id = $1`, [m[1]]);
    if (r.rows.length === 0) return json(res, 404, { code: 404, msg: "User not found" });
    const u = r.rows[0];
    return json(res, 200, {
      id: u.id,
      aud: "authenticated",
      role: "authenticated",
      email: u.email,
      email_confirmed_at: u.email_confirmed_at,
      app_metadata: u.raw_app_meta_data ?? {},
      user_metadata: u.raw_user_meta_data ?? {},
      created_at: u.created_at,
      updated_at: u.updated_at,
    });
  }
  return json(res, 501, { code: 501, msg: `local stack: auth route ${req.method} ${rest} not emulated (use AUTH_MODE=dev)` });
}

const gateway = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${API_PORT}`);
  try {
    if (url.pathname.startsWith("/rest/v1")) return await proxyToPostgrest(req, res);
    if (url.pathname.startsWith("/storage/v1/")) return await handleStorage(req, res, url);
    if (url.pathname.startsWith("/auth/v1/")) return await handleAuth(req, res, url);
    if (url.pathname === "/" || url.pathname === "/health") return json(res, 200, { status: "ok", stack: "local", postgres: PG_PORT, postgrest: PGRST_PORT });
    return json(res, 404, { message: `local stack: no route ${url.pathname}` });
  } catch (e) {
    console.error("[gateway]", e);
    return json(res, 500, { message: e.message });
  }
});
await new Promise((r) => gateway.listen(API_PORT, "127.0.0.1", r));
log(`gateway ready on http://127.0.0.1:${API_PORT}`);

// ---- env for the app -----------------------------------------------------------------------
const appEnv = {
  NEXT_PUBLIC_DATA_SOURCE: "http",
  AUTH_MODE: "dev",
  NEXT_PUBLIC_AUTH_MODE: "dev",
  DEV_DEFAULT_ROLE: "administrator",
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${API_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`,
  NOTIFICATION_PROVIDER: "console",
  APP_BASE_URL: `http://localhost:${APP_PORT}`,
  CRON_SECRET: "local-stack-cron-secret",
  WM_FALLBACK_EMAIL: "wm-team@dev.local",
};
writeFileSync(path.join(STACK, "app.env"), Object.entries(appEnv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
console.log("\n# Environment for the app (also written to .local-stack/app.env):");
for (const [k, v] of Object.entries(appEnv)) console.log(`${k}=${k.endsWith("KEY") ? v.slice(0, 24) + "…" : v}`);
console.log(`\n# Dev sign-in users (AUTH_MODE=dev picks the role from the x-dev-role header; see 002_seed_dev.sql)`);
console.log(`# Run the lifecycle test:  INTEGRATION_BASE_URL=http://localhost:${APP_PORT} npm test -- integration\n`);

// ---- optional: start next dev ----------------------------------------------------------------
let app;
if (args.has("--with-app")) {
  log(`starting next dev on :${APP_PORT}`);
  app = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(APP_PORT)], {
    cwd: ROOT,
    env: { ...process.env, ...appEnv },
    stdio: "inherit",
  });
  app.on("exit", (code) => log(`next dev exited (${code})`));
}

// ---- shutdown --------------------------------------------------------------------------------
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  log("shutting down");
  app?.kill();
  pgrst.kill();
  gateway.close();
  try {
    await sql.end();
  } catch {}
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("message", (m) => m === "shutdown" && shutdown());
if (args.has("--exit-after-ready")) await shutdown();
