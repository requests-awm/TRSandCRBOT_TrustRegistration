// Runtime environment access for server code.
//
// Next.js (Turbopack) rewrites `process.env.NEXT_PUBLIC_X` at build time in BOTH the server and browser
// bundles, and also rewrites aliases of `process.env` itself (dynamic keys come back as the string
// "TURBOPACK unreachable"). On Cloud Run the image is built once by the repository trigger and configured
// afterwards with environment variables, so server code must reach the real process object through
// globalThis, which the bundler does not analyse. Use env("NAME") on the server instead of process.env.NAME.
type EnvMap = Record<string, string | undefined>;

function runtimeEnv(): EnvMap {
  const proc = (globalThis as unknown as { process?: { env?: EnvMap } }).process;
  return proc?.env ?? {};
}

export function env(name: string): string | undefined {
  const v = runtimeEnv()[name];
  return v === undefined || v === "" ? undefined : v;
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export type DataSource = "mock" | "http";
export type AuthMode = "dev" | "supabase";

export const dataSource = (): DataSource => (env("NEXT_PUBLIC_DATA_SOURCE") === "http" ? "http" : "mock");
export const authMode = (): AuthMode => ((env("AUTH_MODE") ?? env("NEXT_PUBLIC_AUTH_MODE")) === "dev" ? "dev" : "supabase");
export const supabaseUrl = () => env("NEXT_PUBLIC_SUPABASE_URL") ?? env("SUPABASE_URL");
export const supabaseAnonKey = () => env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? env("SUPABASE_ANON_KEY");
