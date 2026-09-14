import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireUser } from "@/server/auth/roles";
import { transitionRequirement } from "@/server/services/requirementService";
import { transitionSchema } from "@/server/http/schemas";
import { toErrorResponse } from "@/server/http/errors";

type Params = { params: Promise<{ id: string }> };

// POST /api/registration-requirements/:id/transition — the state machine endpoint.
// Role checks live in the state machine definition, so any active user may call this;
// an illegal role or transition comes back as 409.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = requireUser(await getCurrentUser());
    const { id } = await params;
    const { transition, ...payload } = transitionSchema.parse(await req.json());

    const updated = await transitionRequirement({ requirementId: id, transition, payload }, user);
    return NextResponse.json(updated);
  } catch (err) {
    return toErrorResponse(err);
  }
}
