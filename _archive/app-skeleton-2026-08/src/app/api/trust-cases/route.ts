import { getCurrentUser } from "@/server/auth/session";
import { createTrustCase } from "@/server/services/trustCaseService";
import { requireRole } from "@/server/auth/roles";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    requireRole(user, ["wm_requester", "administrator"]);

    const body = await req.json();

    const caseData = await createTrustCase(
      {
        insightlyId: body.insightlyId,
        clientDisplayName: body.clientDisplayName,
        trustName: body.trustName,
        providerName: body.providerName,
        providerCountry: body.providerCountry,
        trustType: body.trustType,
        trustCreationDate: body.trustCreationDate ? new Date(body.trustCreationDate) : undefined,
        requestingWmTeam: body.requestingWmTeam,
        businessPriority: body.businessPriority,
        targetProviderSubmissionDate: body.targetProviderSubmissionDate
          ? new Date(body.targetProviderSubmissionDate)
          : undefined,
      },
      user!
    );

    return NextResponse.json(caseData, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
