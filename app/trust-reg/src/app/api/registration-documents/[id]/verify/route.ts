import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireRole, ROLES_CAN_VERIFY } from "@/server/auth/roles";
import { verifyDocument } from "@/server/services/documentService";
import { verifyDocumentSchema } from "@/server/http/schemas";
import { toErrorResponse } from "@/server/http/errors";

type Params = { params: Promise<{ id: string }> };

// POST /api/registration-documents/:id/verify — verify or reject. Maker-checker enforced in the service.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = requireRole(await getCurrentUser(), ROLES_CAN_VERIFY);
    const { id } = await params;
    const body = verifyDocumentSchema.parse(await req.json());

    const document = await verifyDocument({ documentId: id, ...body }, user);
    return NextResponse.json(document);
  } catch (err) {
    return toErrorResponse(err);
  }
}
