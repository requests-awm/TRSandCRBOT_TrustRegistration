// Browser-visible configuration, resolved at request time rather than build time.
//
// The root layout reads the runtime environment on the server and injects it as
// window.__TRUST_REG_CONFIG__ before any client bundle runs. Client code calls publicConfig() instead
// of process.env.NEXT_PUBLIC_*, so one image serves every environment (Cloud Run sets the values as
// ordinary environment variables). Nothing in this file mentions process.env by name: Turbopack rewrites
// those references at build time, which is exactly what we are avoiding.

export interface PublicConfig {
  dataSource: "mock" | "http";
  authMode: "dev" | "supabase";
  supabaseUrl: string;
  supabaseAnonKey: string;
  staleAfterDays: number;
}

declare global {
  interface Window {
    __TRUST_REG_CONFIG__?: PublicConfig;
  }
}

export const CONFIG_GLOBAL = "__TRUST_REG_CONFIG__";

type EnvMap = Record<string, string | undefined>;

function runtimeEnv(): EnvMap {
  const proc = (globalThis as unknown as { process?: { env?: EnvMap } }).process;
  return proc?.env ?? {};
}

function read(name: string): string | undefined {
  const v = runtimeEnv()[name];
  return v === undefined || v === "" ? undefined : v;
}

const DEFAULT_STALE_DAYS = 14;

function staleDays(raw: string | undefined): number {
  const n = Number(raw ?? DEFAULT_STALE_DAYS);
  return Math.max(1, Number.isFinite(n) ? n : DEFAULT_STALE_DAYS) || DEFAULT_STALE_DAYS;
}

// Server side (root layout, SSR of client components): the real process environment at request time.
export function readServerPublicConfig(): PublicConfig {
  return {
    dataSource: read("NEXT_PUBLIC_DATA_SOURCE") === "http" ? "http" : "mock",
    authMode: (read("AUTH_MODE") ?? read("NEXT_PUBLIC_AUTH_MODE")) === "dev" ? "dev" : "supabase",
    supabaseUrl: read("NEXT_PUBLIC_SUPABASE_URL") ?? read("SUPABASE_URL") ?? "",
    supabaseAnonKey: read("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? read("SUPABASE_ANON_KEY") ?? "",
    staleAfterDays: staleDays(read("NEXT_PUBLIC_STALE_AFTER_DAYS") ?? read("STALE_AFTER_DAYS")),
  };
}

// Browser without the layout script (tests, isolated renders): safest defaults, never real credentials.
const BROWSER_FALLBACK: PublicConfig = {
  dataSource: "mock",
  authMode: "supabase",
  supabaseUrl: "",
  supabaseAnonKey: "",
  staleAfterDays: DEFAULT_STALE_DAYS,
};

export function publicConfig(): PublicConfig {
  if (typeof window === "undefined") return readServerPublicConfig();
  return window.__TRUST_REG_CONFIG__ ?? BROWSER_FALLBACK;
}

// Inline script body for the root layout. "<" is escaped so a value can never close the script tag.
export function publicConfigScript(cfg: PublicConfig): string {
  return `window.${CONFIG_GLOBAL}=${JSON.stringify(cfg).replace(/</g, "\\u003c")};`;
}
