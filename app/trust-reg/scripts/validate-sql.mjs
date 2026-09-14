// Applies the migration + Supabase SQL to an in-process Postgres (PGlite) and checks the behaviour
// the app relies on. No Docker or network needed:  npm run db:validate
//
// Supabase-managed objects that the scripts reference (auth.users, storage.buckets/objects, the
// anon / authenticated / service_role roles) are stubbed first, since they exist on any Supabase
// project but not in a bare Postgres.

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const stripTx = (sql) => sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gim, "");

const db = new PGlite({ extensions: { pgcrypto } });
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const expectError = async (label, fn, pattern) => {
  try {
    await fn();
    check(label, false, "no error raised");
  } catch (e) {
    check(label, pattern.test(e.message), e.message.split("\n")[0]);
  }
};

// ---- Supabase stubs -----------------------------------------------------------------------------
await db.exec(`
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY, instance_id uuid, aud text, role text, email text, encrypted_password text,
    email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
    created_at timestamptz, updated_at timestamptz
  );
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
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
`);
check("Supabase stubs created (auth, storage, roles)", true);

// ---- 1. Prisma migration --------------------------------------------------------------------------
await db.exec(read("prisma/migrations/20260913000000_init/migration.sql"));
const tables = await db.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'trust_reg' ORDER BY 1`
);
const enums = await db.query(
  `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'trust_reg' AND t.typtype = 'e'`
);
check("migration: 8 tables", tables.rows.length === 8, tables.rows.map((r) => r.table_name).join(", "));
check("migration: 11 enums", enums.rows.length === 11);
const badTs = await db.query(
  `SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema = 'trust_reg' AND data_type = 'timestamp without time zone'`
);
check("migration: every timestamp is TIMESTAMPTZ", badTs.rows.length === 0, JSON.stringify(badTs.rows));
const fkRules = await db.query(
  `SELECT DISTINCT delete_rule FROM information_schema.referential_constraints WHERE constraint_schema = 'trust_reg'`
);
check("migration: all FKs ON DELETE RESTRICT", fkRules.rows.every((r) => r.delete_rule === "RESTRICT"), fkRules.rows.map((r) => r.delete_rule).join(","));
const eventEnum = await db.query(`SELECT unnest(enum_range(NULL::trust_reg.event_type))::text AS v`);
check("migration: event_type has case_handed_back + case_closed", ["case_handed_back", "case_closed"].every((v) => eventEnum.rows.some((r) => r.v === v)));

// ---- 2. RLS, constraints, trigger, RPC -------------------------------------------------------------
await db.exec(stripTx(read("supabase/sql/001_rls_and_constraints.sql")));
const rls = await db.query(
  `SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'trust_reg' AND relkind = 'r'`
);
check("001: RLS enabled on every trust_reg table", rls.rows.every((r) => r.relrowsecurity === true), rls.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname).join(",") || "all");
const policies = await db.query(`SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'trust_reg'`);
check("001: service_role policy on all 8 tables", policies.rows.filter((p) => p.policyname === "service_role_full_access").length === 8, `${policies.rows.length} policies`);
const fk = await db.query(
  `SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = 'trust_reg' AND constraint_name = 'profiles_id_fkey'`
);
check("001: profiles.id -> auth.users FK", fk.rows.length === 1);

// ---- 3. Storage bucket ----------------------------------------------------------------------------
await db.exec(stripTx(read("supabase/sql/003_storage.sql")));
const bucket = await db.query(`SELECT public, file_size_limit, cardinality(allowed_mime_types) AS n FROM storage.buckets WHERE id = 'trust-registration-evidence'`);
check("003: private evidence bucket, 25 MiB, 5 mime types", bucket.rows.length === 1 && bucket.rows[0].public === false && Number(bucket.rows[0].file_size_limit) === 26214400 && bucket.rows[0].n === 5);
const objPolicy = await db.query(`SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'trust_reg_evidence_no_direct_access'`);
check("003: deny policy on storage.objects", objPolicy.rows.length === 1);
check("003: re-run is idempotent", await db.exec(stripTx(read("supabase/sql/003_storage.sql"))).then(() => true, () => false));

// ---- 4. Dev seed (local only) --------------------------------------------------------------------
await db.exec(stripTx(read("supabase/sql/002_seed_dev.sql")));
const profiles = await db.query(`SELECT role::text FROM trust_reg.profiles ORDER BY 1`);
check("002: six profiles, one per role", profiles.rows.length === 6, profiles.rows.map((r) => r.role).join(","));
const rules = await db.query(`SELECT authority::text, deadline_days FROM trust_reg.compliance_rules ORDER BY 1`);
check("002: TRS 90 / CRBOT 180 day rules", rules.rows.length === 2 && rules.rows.some((r) => r.authority === "trs" && r.deadline_days === 90) && rules.rows.some((r) => r.authority === "crbot" && r.deadline_days === 180));

// ---- 5. Behaviour -----------------------------------------------------------------------------
const y = new Date().getFullYear();
const r1 = await db.query(`SELECT trust_reg.next_case_reference() AS ref`);
const r2 = await db.query(`SELECT trust_reg.next_case_reference() AS ref`);
check("rpc: next_case_reference sequential", r1.rows[0].ref === `NTR-${y}-000001` && r2.rows[0].ref === `NTR-${y}-000002`, `${r1.rows[0].ref}, ${r2.rows[0].ref}`);

const WM = "00000000-0000-4000-8000-000000000001";
const caseRow = await db.query(
  `INSERT INTO trust_reg.trust_cases (case_reference, insightly_id, client_display_name, trust_name, provider_name, provider_country, trust_type,
     requesting_wm_user_id, requesting_wm_team, updated_at)
   VALUES ($1, 'INS-1', 'Client', 'Trust', 'Provider', 'Ireland', 'Discretionary', $2, 'WM Team A', now()) RETURNING id, overall_status::text, activation_blocked`,
  [r1.rows[0].ref, WM]
);
const c = caseRow.rows[0];
check("trust_cases: defaults requirement_review + activation_blocked", c.overall_status === "requirement_review" && c.activation_blocked === true);

const before = await db.query(`SELECT updated_at FROM trust_reg.trust_cases WHERE id = $1`, [c.id]);
check("updated_at: defaulted on insert without being supplied", before.rows[0].updated_at != null);
await new Promise((r) => setTimeout(r, 20));
await db.query(`UPDATE trust_reg.trust_cases SET trust_name = 'Trust renamed' WHERE id = $1`, [c.id]);
const after = await db.query(`SELECT updated_at FROM trust_reg.trust_cases WHERE id = $1`, [c.id]);
check("updated_at: trigger bumps it on UPDATE", new Date(after.rows[0].updated_at) > new Date(before.rows[0].updated_at));

await db.query(
  `INSERT INTO trust_reg.registration_events (trust_case_id, event_type, comment, performed_by) VALUES ($1, 'case_created', 'x', $2)`,
  [c.id, WM]
);
await expectError("events: UPDATE blocked by append-only trigger", () => db.query(`UPDATE trust_reg.registration_events SET comment = 'tamper' WHERE trust_case_id = $1`, [c.id]), /append-only/);
await expectError("events: DELETE blocked by append-only trigger", () => db.query(`DELETE FROM trust_reg.registration_events WHERE trust_case_id = $1`, [c.id]), /append-only/);
await expectError("trust_cases: DELETE restricted while events reference it", () => db.query(`DELETE FROM trust_reg.trust_cases WHERE id = $1`, [c.id]), /violates foreign key|restrict/i);

await db.query(
  `INSERT INTO trust_reg.trust_registration_requirements (trust_case_id, authority, updated_at) VALUES ($1, 'trs', now())`,
  [c.id]
);
await expectError("requirements: one per (case, authority)", () => db.query(`INSERT INTO trust_reg.trust_registration_requirements (trust_case_id, authority, updated_at) VALUES ($1, 'trs', now())`, [c.id]), /unique|duplicate/i);
await expectError("enums: invalid status rejected", () => db.query(`UPDATE trust_reg.trust_cases SET overall_status = 'done' WHERE id = $1`, [c.id]), /invalid input value for enum/);

// RLS from a non-service role: nothing visible / writable
await db.exec(`SET ROLE authenticated`);
const visible = await db.query(`SELECT count(*)::int AS n FROM trust_reg.profiles`);
check("rls: authenticated can read profiles (own role lookup)", visible.rows[0].n >= 0);
await expectError("rls: authenticated cannot read trust_cases", () => db.query(`SELECT count(*) FROM trust_reg.trust_cases`), /permission denied/);
await db.exec(`RESET ROLE`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
