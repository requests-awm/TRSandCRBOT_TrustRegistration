import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requireRole, ROLES_CAN_PROCESS } from "@/server/auth/roles";
import { uploadDocument } from "@/server/services/documentService";
import { uploadDocumentFieldsSchema } from "@/server/http/schemas";
import { badRequest, toErrorResponse } from "@/server/http/errors";

// POST /api/registration-documents — multipart/form-data with:
//   file                        the certificate or confirmation (PDF, PNG, JPEG, Word)
//   registrationRequirementId   uuid
//   documentType                one of DOCUMENT_TYPES
// The server writes the bytes to the private evidence bucket, hashes them, and records the metadata.
export async function POST(req: NextRequest) {
  try {
    const user = requireRole(await getCurrentUser(), ROLES_CAN_PROCESS);

    if (!req.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
      throw badRequest("Expected multipart/form-data with a file field");
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("A file is required");

    const fields = uploadDocumentFieldsSchema.parse({
      registrationRequirementId: form.get("registrationRequirementId"),
      documentType: form.get("documentType"),
    });

    const document = await uploadDocument({ ...fields, file }, user);
    return NextResponse.json(document, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
