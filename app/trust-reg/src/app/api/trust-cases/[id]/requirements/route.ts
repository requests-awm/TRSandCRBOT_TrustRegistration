import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireRole, ROLES_CAN_PROCESS } from "@/server/auth/roles";
import { getTrustCase } from "@/server/services/trustCaseService";
import { setRequirementDecision } from "@/server/services/requirementService";
import { requirementDecisionSchema } from "@/server/http/schemas";
import { toErrorResponse } from "@/server/http/errors";

type Params = { params: Promise<{ id: string }> };

// POST /api/trust-cases/:id/requirements — record the TRS or CRBOT requirement decision.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = requireRole(await getCurrentUser(), ROLES_CAN_PROCESS);
    const { id } = await params;
    await getTrustCase(id);
    const body = requirementDecisionSchema.parse(await req.json());

    const requirement = await setRequirementDecision({ trustCaseId: id, ...body }, user);
    return NextResponse.json(requirement, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
