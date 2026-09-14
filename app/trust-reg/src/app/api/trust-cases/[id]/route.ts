import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireRole, requireUser, ROLES_CAN_PROCESS } from "@/server/auth/roles";
import { assignAepOwner, getTrustCase, softDeleteTrustCase } from "@/server/services/trustCaseService";
import { deleteTrustCaseSchema, patchTrustCaseSchema } from "@/server/http/schemas";
import { forbidden, toErrorResponse } from "@/server/http/errors";

type Params = { params: Promise<{ id: string }> };

// GET /api/trust-cases/:id
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = requireUser(await getCurrentUser());
    const { id } = await params;
    const trustCase = await getTrustCase(id);

    if (user.role === "wm_requester" && trustCase.requesting_wm_team !== user.wmTeam) {
      throw forbidden("This case belongs to another WM team");
    }

    return NextResponse.json(trustCase);
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PATCH /api/trust-cases/:id — assign the AEP owner.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = requireRole(await getCurrentUser(), ROLES_CAN_PROCESS);
    const { id } = await params;
    const body = patchTrustCaseSchema.parse(await req.json());

    const updated = await assignAepOwner(id, body.assignedAepUserId, user);
    return NextResponse.json(updated);
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/trust-cases/:id — soft delete with a reason. Administrators only.
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = requireRole(await getCurrentUser(), ["administrator"]);
    const { id } = await params;
    const body = deleteTrustCaseSchema.parse(await req.json());

    await softDeleteTrustCase(id, body.reason, user);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
