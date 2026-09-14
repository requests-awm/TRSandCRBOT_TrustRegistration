import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireRole, requireUser, ROLES_CAN_PROCESS } from "@/server/auth/roles";
import { getRequirement, updateRequirementFields } from "@/server/services/requirementService";
import { patchRequirementSchema } from "@/server/http/schemas";
import { toErrorResponse } from "@/server/http/errors";

type Params = { params: Promise<{ id: string }> };

// GET /api/registration-requirements/:id
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    requireUser(await getCurrentUser());
    const { id } = await params;
    return NextResponse.json(await getRequirement(id));
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PATCH /api/registration-requirements/:id — owner, dates, checklist, references. Never status.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = requireRole(await getCurrentUser(), ROLES_CAN_PROCESS);
    const { id } = await params;
    const body = patchRequirementSchema.parse(await req.json());

    const updated = await updateRequirementFields(id, body, user);
    return NextResponse.json(updated);
  } catch (err) {
    return toErrorResponse(err);
  }
}
