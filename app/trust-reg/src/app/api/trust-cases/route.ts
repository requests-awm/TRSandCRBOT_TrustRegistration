import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireRole, requireUser, ROLES_CAN_CREATE_CASE } from "@/server/auth/roles";
import { createTrustCase, listTrustCases } from "@/server/services/trustCaseService";
import { createTrustCaseSchema, listTrustCasesSchema } from "@/server/http/schemas";
import { toErrorResponse } from "@/server/http/errors";

// GET /api/trust-cases — WM requesters only see their own team; every other role sees all.
export async function GET(req: NextRequest) {
  try {
    const user = requireUser(await getCurrentUser());
    const params = listTrustCasesSchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const filter = { ...params };
    if (user.role === "wm_requester") {
      filter.wmTeam = user.wmTeam;
    }

    const cases = await listTrustCases(filter);
    return NextResponse.json(cases);
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/trust-cases — WM request form.
export async function POST(req: NextRequest) {
  try {
    const user = requireRole(await getCurrentUser(), ROLES_CAN_CREATE_CASE);
    const body = createTrustCaseSchema.parse(await req.json());

    const caseData = await createTrustCase(body, user);
    return NextResponse.json(caseData, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
