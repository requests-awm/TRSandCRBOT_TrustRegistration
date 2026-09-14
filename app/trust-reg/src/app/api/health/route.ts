import { NextResponse } from "next/server";

// GET /api/health — liveness for the container healthcheck and load balancer. No auth, no database.
export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "trust-reg",
      dataSource: process.env.NEXT_PUBLIC_DATA_SOURCE ?? "mock",
      authMode: process.env.AUTH_MODE ?? "supabase",
      time: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } }
  );
}
