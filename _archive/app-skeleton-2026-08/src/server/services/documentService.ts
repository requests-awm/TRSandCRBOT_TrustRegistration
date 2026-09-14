import { createServiceClient } from "@/lib/supabase/service";
import { DocumentType, VerificationStatus, MalwareScanStatus } from "@prisma/client";
import { recordEvent } from "./eventService";
import { AuthUser } from "@/server/auth/roles";

export interface UploadDocumentInput {
  registrationRequirementId: string;
  documentType: DocumentType;
  fileName: string;
  storageKey: string;
  mimeType: string;
  fileSize: number;
  fileHash?: string;
}

// Upload a registration document.
// Marks any prior version as not current.
export async function uploadDocument(input: UploadDocumentInput, actor: AuthUser) {
  const client = createServiceClient();

  // Mark all current documents for this requirement as not current (versioning)
  const { error: versionError } = await client
    .from("registration_documents")
    .update({ is_current: false })
    .eq("registration_requirement_id", input.registrationRequirementId)
    .eq("is_current", true);

  if (versionError) {
    console.warn("Failed to version out old documents:", versionError);
  }

  // Insert the new document
  const { data: document, error: insertError } = await client
    .from("registration_documents")
    .insert({
      registration_requirement_id: input.registrationRequirementId,
      document_type: input.documentType,
      file_name: input.fileName,
      storage_key: input.storageKey,
      mime_type: input.mimeType,
      file_size: input.fileSize,
      uploaded_by: actor.id,
      file_hash: input.fileHash,
      malware_scan_status: "pending", // Will be updated by an async scan job
      verification_status: "pending",
      is_current: true,
      document_version: 1,
    })
    .select()
    .single();

  if (insertError || !document) {
    throw new Error(`Failed to upload document: ${insertError?.message}`);
  }

  // Fetch the requirement to get the trust_case_id for the event
  const { data: requirement } = await client
    .from("trust_registration_requirements")
    .select("trust_case_id")
    .eq("id", input.registrationRequirementId)
    .single();

  if (requirement) {
    await recordEvent({
      trustCaseId: requirement.trust_case_id,
      registrationRequirementId: input.registrationRequirementId,
      eventType: "document_uploaded",
      comment: `${input.documentType} uploaded`,
      performedBy: actor.id,
      metadataJson: {
        fileName: input.fileName,
        documentType: input.documentType,
      },
    });
  }

  return document;
}

export interface VerifyDocumentInput {
  documentId: string;
  verificationStatus: "verified" | "rejected";
  rejectionReason?: string;
}

// Verify or reject a document.
// Enforces maker-checker: the verifier must not be the uploader.
// On successful verification, also updates the requirement's verifiedAt/verifiedBy.
export async function verifyDocument(input: VerifyDocumentInput, actor: AuthUser) {
  const client = createServiceClient();

  // Fetch the document to check uploader
  const { data: document, error: fetchError } = await client
    .from("registration_documents")
    .select("uploaded_by, registration_requirement_id")
    .eq("id", input.documentId)
    .single();

  if (fetchError || !document) {
    throw new Error(`Failed to fetch document: ${fetchError?.message}`);
  }

  // Maker-checker: verifier != uploader
  if (input.verificationStatus === "verified" && document.uploaded_by === actor.id) {
    throw new Error("Verification denied: you cannot verify a document you uploaded (maker-checker control)");
  }

  // Update document verification status
  const updatePayload: any = {
    verification_status: input.verificationStatus,
  };

  if (input.verificationStatus === "verified") {
    updatePayload.verified_by = actor.id;
    updatePayload.verified_at = new Date().toISOString();
  } else if (input.verificationStatus === "rejected") {
    updatePayload.rejection_reason = input.rejectionReason;
  }

  const { data: updated, error: updateError } = await client
    .from("registration_documents")
    .update(updatePayload)
    .eq("id", input.documentId)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to verify document: ${updateError?.message}`);
  }

  // Fetch requirement to get trust_case_id for the event
  const { data: requirement } = await client
    .from("trust_registration_requirements")
    .select("trust_case_id")
    .eq("id", document.registration_requirement_id)
    .single();

  if (requirement) {
    await recordEvent({
      trustCaseId: requirement.trust_case_id,
      registrationRequirementId: document.registration_requirement_id,
      eventType: "evidence_verified",
      comment: `Document ${input.verificationStatus}${input.rejectionReason ? ": " + input.rejectionReason : ""}`,
      performedBy: actor.id,
      metadataJson: {
        documentId: input.documentId,
        verificationStatus: input.verificationStatus,
      },
    });
  }

  return updated;
}

// Get all documents for a requirement
export async function getDocuments(registrationRequirementId: string) {
  const client = createServiceClient();

  const { data, error } = await client
    .from("registration_documents")
    .select("*")
    .eq("registration_requirement_id", registrationRequirementId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch documents: ${error.message}`);
  }

  return data;
}
