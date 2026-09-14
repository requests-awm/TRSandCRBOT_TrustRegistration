import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireUser } from "@/server/auth/roles";
import { getDocumentDownload } from "@/server/services/documentService";
import { toErrorResponse } from "@/server/http/errors";

type Params = { params: Promise<{ id: string }> };

// GET /api/registration-documents/:id/download — a short-lived signed URL for the stored file.
// AEP roles may fetch any document; WM requesters only verified certificates on their own team's cases.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = requireUser(await getCurrentUser());
    const { id } = await params;
    const link = await getDocumentDownload(id, user);
    return NextResponse.json(link, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
