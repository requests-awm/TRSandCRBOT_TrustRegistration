import type { TrustRegApi } from "./client";
import { httpClient } from "./httpClient";
import { mockClient } from "./mockClient";
import { publicConfig } from "@/lib/publicConfig";

// NEXT_PUBLIC_DATA_SOURCE=mock  -> in-browser placeholder data
// NEXT_PUBLIC_DATA_SOURCE=http  -> the /api routes backed by Supabase
// Resolved at request time through publicConfig(), so the same build serves both.
export function getApi(): TrustRegApi {
  return publicConfig().dataSource === "http" ? httpClient : mockClient;
}

export type { TrustRegApi } from "./client";
export * from "./client";
