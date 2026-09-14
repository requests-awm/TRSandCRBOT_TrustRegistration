import { createServiceClient } from "@/lib/supabase/service";
import type { DocumentType, DocumentRow, TrustCaseRow } from "@/server/domain/types";
import { recordEvent } from "./eventService";
import { AuthUser, ROLES_CAN_READ_ALL } from "@/server/auth/roles";
import { forbidden, notFound } from "@/server/http/errors";
import { createEvidenceDownloadUrl, storeEvidenceFile } from "./storageService";

export interface UploadDocumentInput {
  registrationRequirementId: string;
  documentType: DocumentType;
  file: File;
}

// Stores the file in Storage, then records the metadata row.
// Versioning: previous documents of the same type on the requirement are marked not-current.
export async function uploadDocument(input: UploadDocumentInput, actor: AuthUser): Promise<DocumentRow> {
  const client = createServiceClient();

  const { data: requirement, error: reqError } = await client
    .from("trust_registration_requirements")
    .select("id, trust_case_id, status")
    .eq("id", input.registrationRequirementId)
    .maybeSingle();

  if (reqError) throw new Error(`Failed to load requirement: ${reqError.message}`);
  if (!requirement) throw notFound(`Requirement ${input.registrationRequirementId} not found`);
  if (["verified_completed", "not_required", "cancelled"].includes(requirement.status)) {
    throw forbidden(`Documents cannot be added to a requirement in status ${requirement.status}`);
  }

  const stored = await storeEvidenceFile({
    trustCaseId: requirement.trust_case_id,
    requirementId: requirement.id,
    documentType: input.documentType,
    file: input.file,
  });

  const { data: previous } = await client
    .from("registration_documents")
    .select("document_version")
    .eq("registration_requirement_id", input.registrationRequirementId)
    .eq("document_type", input.documentType)
    .order("document_version", { ascending: false })
    .limit(1);

  const nextVersion = previous && previous.length > 0 ? previous[0].document_version + 1 : 1;

  const { error: versionError } = await client
    .from("registration_documents")
    .update({ is_current: false })
    .eq("registration_requirement_id", input.registrationRequirementId)
    .eq("document_type", input.documentType)
    .eq("is_current", true);

  if (versionError) {
    throw new Error(`Failed to version out old documents: ${versionError.message}`);
  }

  const { data: document, error: insertError } = await client
    .from("registration_documents")
    .insert({
      registration_requirement_id: input.registrationRequirementId,
      document_type: input.documentType,
      file_name: input.file.name,
      storage_key: stored.storageKey,
      mime_type: stored.mimeType,
      file_size: stored.fileSize,
      uploaded_by: actor.id,
      file_hash: stored.fileHash,
      malware_scan_status: "pending",
      verification_status: "pending",
      is_current: true,
      document_version: nextVersion,
    })
    .select()
    .single();

  if (insertError || !document) {
    throw new Error(`Failed to record document: ${insertError?.message}`);
  }

  await recordEvent({
    trustCaseId: requirement.trust_case_id,
    registrationRequirementId: input.registrationRequirementId,
    eventType: "document_uploaded",
    comment: `${input.documentType} uploaded (v${nextVersion})`,
    performedBy: actor.id,
    metadataJson: {
      documentId: document.id,
      fileName: input.file.name,
      documentType: input.documentType,
      version: nextVersion,
      fileHash: stored.fileHash,
    },
  });

  return document as DocumentRow;
}

export interface VerifyDocumentInput {
  documentId: string;
  verificationStatus: "verified" | "rejected";
  rejectionReason?: string;
}

// Maker-checker: the verifier must not be the uploader.
export async function verifyDocument(input: VerifyDocumentInput, actor: AuthUser): Promise<DocumentRow> {
  const client = createServiceClient();

  const { data: document, error: fetchError } = await client
    .from("registration_documents")
    .select("uploaded_by, registration_requirement_id")
    .eq("id", input.documentId)
    .single();

  if (fetchError || !document) {
    throw notFound(`Document not found: ${fetchError?.message ?? input.documentId}`);
  }

  if (document.uploaded_by === actor.id) {
    throw forbidden("Verification denied: you cannot verify or reject a document you uploaded (maker-checker control)");
  }

  const updatePayload: Partial<DocumentRow> = {
    verification_status: input.verificationStatus,
    verified_by: actor.id,
    verified_at: new Date().toISOString(),
    rejection_reason: input.verificationStatus === "rejected" ? (input.rejectionReason ?? null) : null,
  };

  const { data: updated, error: updateError } = await client
    .from("registration_documents")
    .update(updatePayload)
    .eq("id", input.documentId)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to verify document: ${updateError?.message}`);
  }

  const { data: requirement } = await client
    .from("trust_registration_requirements")
    .select("trust_case_id")
    .eq("id", document.registration_requirement_id)
    .single();

  if (requirement) {
    await recordEvent({
      trustCaseId: requirement.trust_case_id,
      registrationRequirementId: document.registration_requirement_id,
      eventType: input.verificationStatus === "verified" ? "evidence_verified" : "evidence_rejected",
      comment: `Document ${input.verificationStatus}${input.rejectionReason ? ": " + input.rejectionReason : ""}`,
      performedBy: actor.id,
      metadataJson: {
        documentId: input.documentId,
        verificationStatus: input.verificationStatus,
      },
    });
  }

  return updated as DocumentRow;
}

export async function getDocuments(registrationRequirementId: string): Promise<DocumentRow[]> {
  const client = createServiceClient();

  const { data, error } = await client
    .from("registration_documents")
    .select("*")
    .eq("registration_requirement_id", registrationRequirementId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch documents: ${error.message}`);
  }

  return (data ?? []) as DocumentRow[];
}

export async function getDocument(documentId: string): Promise<DocumentRow> {
  const client = createServiceClient();
  const { data, error } = await client.from("registration_documents").select("*").eq("id", documentId).maybeSingle();
  if (error) throw new Error(`Failed to fetch document: ${error.message}`);
  if (!data) throw notFound(`Document ${documentId} not found`);
  return data as DocumentRow;
}

// Every current, verified certificate on a case. This is the pack WM submits to the provider.
export async function getVerifiedDocumentsForCase(trustCaseId: string): Promise<DocumentRow[]> {
  const client = createServiceClient();
  const { data: requirements, error: reqError } = await client
    .from("trust_registration_requirements")
    .select("id")
    .eq("trust_case_id", trustCaseId);
  if (reqError) throw new Error(`Failed to load requirements: ${reqError.message}`);
  const ids = (requirements ?? []).map((r) => r.id);
  if (ids.length === 0) return [];

  const { data, error } = await client
    .from("registration_documents")
    .select("*")
    .in("registration_requirement_id", ids)
    .eq("is_current", true)
    .eq("verification_status", "verified")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load verified documents: ${error.message}`);
  return (data ?? []) as DocumentRow[];
}

// Who may read a document:
// - AEP, compliance, admin and auditor roles: any document
// - WM requesters: verified documents on cases raised by their own team
export function assertCanReadDocument(user: AuthUser, document: DocumentRow, trustCase: Pick<TrustCaseRow, "requesting_wm_team">): void {
  if (ROLES_CAN_READ_ALL.includes(user.role)) return;
  if (user.role === "wm_requester") {
    if (trustCase.requesting_wm_team !== user.wmTeam) throw forbidden("This case belongs to another WM team");
    if (document.verification_status !== "verified") throw forbidden("Only verified certificates are released to the WM team");
    return;
  }
  throw forbidden(`Role ${user.role} may not download documents`);
}

export async function getDocumentDownload(documentId: string, user: AuthUser): Promise<{ url: string; expiresAt: string; fileName: string }> {
  const client = createServiceClient();
  const document = await getDocument(documentId);

  const { data: requirement, error } = await client
    .from("trust_registration_requirements")
    .select("trust_case_id, trust_cases!inner(requesting_wm_team)")
    .eq("id", document.registration_requirement_id)
    .single();
  if (error || !requirement) throw new Error(`Failed to resolve document case: ${error?.message}`);

  const trustCase = (Array.isArray(requirement.trust_cases) ? requirement.trust_cases[0] : requirement.trust_cases) as Pick<
    TrustCaseRow,
    "requesting_wm_team"
  >;
  assertCanReadDocument(user, document, trustCase);

  const link = await createEvidenceDownloadUrl(document.storage_key, document.file_name);
  return { ...link, fileName: document.file_name };
}
