import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireUser } from "@/server/auth/roles";
import { getDocuments } from "@/server/services/documentService";
import { toErrorResponse } from "@/server/http/errors";

type Params = { params: Promise<{ id: string }> };

// GET /api/registration-requirements/:id/documents — all versions, newest first.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    requireUser(await getCurrentUser());
    const { id } = await params;
    return NextResponse.json(await getDocuments(id));
  } catch (err) {
    return toErrorResponse(err);
  }
}
