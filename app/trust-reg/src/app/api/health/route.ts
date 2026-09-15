import { NextResponse } from "next/server";
import { authMode, dataSource, supabaseUrl } from "@/server/env";

// GET /api/health — liveness for the container healthcheck and load balancer. No auth, no database.
export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "trust-reg",
      dataSource: dataSource(),
      authMode: authMode(),
      supabaseConfigured: Boolean(supabaseUrl()),
      time: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } }
  );
}
