import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireUser } from "@/server/auth/roles";
import { listProfiles } from "@/server/services/directoryService";
import { toErrorResponse } from "@/server/http/errors";
import { USER_ROLES, type UserRole } from "@/server/domain/types";

// GET /api/profiles?roles=aep_processor,aep_reviewer — active people for owner pickers and name display.
export async function GET(req: NextRequest) {
  try {
    requireUser(await getCurrentUser());
    const roles = (req.nextUrl.searchParams.get("roles") ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter((r): r is UserRole => (USER_ROLES as readonly string[]).includes(r));
    return NextResponse.json(await listProfiles(roles.length ? roles : undefined));
  } catch (err) {
    return toErrorResponse(err);
  }
}
