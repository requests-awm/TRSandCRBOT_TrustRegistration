import type { NextRequest } from "next/server";
import { env } from "@/server/env";

const INTERNAL_HOST = /^(0\.0\.0\.0|127\.0\.0\.1|\[::\]|::|localhost)(:\d+)?$/i;

// The public origin for absolute redirects from route handlers.
//
// Stay on the host the visitor actually used: the service answers on both its run.app address and
// trustregistration.ascotwm.com, and the session cookie is bound to whichever one the browser is on,
// so redirecting to a different host would drop the session. Behind Cloud Run, req.nextUrl.origin is the
// container's own address (https://0.0.0.0:3000), which is why the proxy headers come first.
// APP_BASE_URL is the fallback for contexts with no usable host, and for links built outside a request
// (emails), which the notification service reads directly.
export function publicOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host && !INTERNAL_HOST.test(host)) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }

  const configured = env("APP_BASE_URL");
  if (configured) return configured.replace(/\/$/, "");

  return req.nextUrl.origin;
}
