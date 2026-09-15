import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireUser } from "@/server/auth/roles";
import { searchClients } from "@/server/services/directoryService";
import { toErrorResponse } from "@/server/http/errors";

// GET /api/clients/search?q=smith — client master lookup for the request form.
export async function GET(req: NextRequest) {
  try {
    requireUser(await getCurrentUser());
    const q = req.nextUrl.searchParams.get("q") ?? "";
    return NextResponse.json(await searchClients(q));
  } catch (err) {
    return toErrorResponse(err);
  }
}
