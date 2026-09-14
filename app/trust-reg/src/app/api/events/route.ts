import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireUser } from "@/server/auth/roles";
import { auditEventsToCsv, listEvents } from "@/server/services/eventService";
import { listEventsSchema } from "@/server/http/schemas";
import { toErrorResponse } from "@/server/http/errors";

// GET /api/events — cross-case audit trail, newest first.
//   ?type=  ?caseId=  ?from=  ?to=  ?format=csv
// WM requesters see events on their own team's cases only.
export async function GET(req: NextRequest) {
  try {
    const user = requireUser(await getCurrentUser());
    const params = listEventsSchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const rows = await listEvents({
      eventType: params.type,
      trustCaseId: params.caseId,
      from: params.from,
      to: params.to,
      wmTeam: user.role === "wm_requester" ? user.wmTeam : undefined,
    });

    if (params.format === "csv") {
      const stamp = new Date().toISOString().slice(0, 10);
      return new NextResponse(auditEventsToCsv(rows), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="trust-registration-audit-${stamp}.csv"`,
          "cache-control": "no-store",
        },
      });
    }

    return NextResponse.json(rows);
  } catch (err) {
    return toErrorResponse(err);
  }
}
