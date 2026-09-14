import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireUser } from "@/server/auth/roles";
import { getTrustCase } from "@/server/services/trustCaseService";
import { listEventsForCase } from "@/server/services/eventService";
import { forbidden, toErrorResponse } from "@/server/http/errors";

type Params = { params: Promise<{ id: string }> };

// GET /api/trust-cases/:id/events — the audit trail for one case, newest first.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = requireUser(await getCurrentUser());
    const { id } = await params;
    const trustCase = await getTrustCase(id);

    if (user.role === "wm_requester" && trustCase.requesting_wm_team !== user.wmTeam) {
      throw forbidden("This case belongs to another WM team");
    }

    const events = await listEventsForCase(id);
    return NextResponse.json(events);
  } catch (err) {
    return toErrorResponse(err);
  }
}
