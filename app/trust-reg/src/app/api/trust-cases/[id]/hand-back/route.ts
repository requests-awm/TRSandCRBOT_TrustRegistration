import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireRole, ROLES_CAN_PROCESS } from "@/server/auth/roles";
import { handBackToWm } from "@/server/services/trustCaseService";
import { caseCommentSchema } from "@/server/http/schemas";
import { toErrorResponse } from "@/server/http/errors";

type Params = { params: Promise<{ id: string }> };

// POST /api/trust-cases/:id/hand-back — AEP returns the verified registration pack to the WM team.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = requireRole(await getCurrentUser(), ROLES_CAN_PROCESS);
    const { id } = await params;
    const body = caseCommentSchema.parse(await req.json().catch(() => ({})));

    const updated = await handBackToWm(id, body.comment || undefined, user);
    return NextResponse.json(updated);
  } catch (err) {
    return toErrorResponse(err);
  }
}
