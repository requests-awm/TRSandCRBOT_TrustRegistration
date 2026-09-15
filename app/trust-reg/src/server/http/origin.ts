import type { NextRequest } from "next/server";
import { env } from "@/server/env";

// The public origin of this deployment, for absolute redirects from route handlers.
// Behind Cloud Run (or any reverse proxy) req.nextUrl.origin is the container's own address
// (https://0.0.0.0:3000), so prefer APP_BASE_URL, then the proxy's forwarded headers.
export function publicOrigin(req: NextRequest): string {
  const configured = env("APP_BASE_URL");
  if (configured) return configured.replace(/\/$/, "");

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host && !/^(0\.0\.0\.0|127\.0\.0\.1|\[::\]|::)(:\d+)?$/.test(host)) {
    const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }

  return req.nextUrl.origin;
}
