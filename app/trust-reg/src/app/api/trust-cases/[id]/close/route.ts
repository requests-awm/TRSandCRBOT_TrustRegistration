import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireRole } from "@/server/auth/roles";
import { closeCase } from "@/server/services/trustCaseService";
import { caseCommentSchema } from "@/server/http/schemas";
import { toErrorResponse } from "@/server/http/errors";

type Params = { params: Promise<{ id: string }> };

// POST /api/trust-cases/:id/close — WM confirms the provider accepted the trust.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = requireRole(await getCurrentUser(), ["wm_requester", "aep_reviewer", "administrator"]);
    const { id } = await params;
    const body = caseCommentSchema.parse(await req.json().catch(() => ({})));

    const updated = await closeCase(id, body.comment || undefined, user);
    return NextResponse.json(updated);
  } catch (err) {
    return toErrorResponse(err);
  }
}
