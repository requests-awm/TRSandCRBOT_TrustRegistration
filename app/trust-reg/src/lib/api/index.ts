import type { TrustRegApi } from "./client";
import { httpClient } from "./httpClient";
import { mockClient } from "./mockClient";

// NEXT_PUBLIC_DATA_SOURCE=mock  -> in-browser placeholder data (default until the DB exists)
// NEXT_PUBLIC_DATA_SOURCE=http  -> the real /api routes backed by Supabase
export function getApi(): TrustRegApi {
  return process.env.NEXT_PUBLIC_DATA_SOURCE === "http" ? httpClient : mockClient;
}

export type { TrustRegApi } from "./client";
export * from "./client";
