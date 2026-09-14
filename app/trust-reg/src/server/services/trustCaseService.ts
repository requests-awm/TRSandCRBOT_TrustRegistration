import { createServiceClient } from "@/lib/supabase/service";
import { generateCaseReference } from "@/server/workflow/caseReference";
import { recordEvent } from "./eventService";
import { AuthUser } from "@/server/auth/roles";
import type { BusinessPriority, OverallStatus, TrustCaseRow, TrustCaseWithRequirements } from "@/server/domain/types";
import { conflict, forbidden, notFound } from "@/server/http/errors";
import { getVerifiedDocumentsForCase } from "./documentService";
import { notifyWmHandedBack } from "./notificationService";

export interface CreateTrustCaseInput {
  insightlyId: string;
  clientDisplayName: string;
  trustName: string;
  providerName: string;
  providerCountry: string;
  trustType: string;
  trustCreationDate?: Date;
  requestingWmTeam: string;
  businessPriority: BusinessPriority;
  targetProviderSubmissionDate?: Date;
}

const toDateOnly = (d?: Date) => (d ? d.toISOString().split("T")[0] : undefined);

export async function createTrustCase(input: CreateTrustCaseInput, actor: AuthUser): Promise<TrustCaseRow> {
  const client = createServiceClient();
  const caseReference = await generateCaseReference();

  const { data: caseData, error: insertError } = await client
    .from("trust_cases")
    .insert({
      case_reference: caseReference,
      insightly_id: input.insightlyId,
      client_display_name: input.clientDisplayName,
      trust_name: input.trustName,
      provider_name: input.providerName,
      provider_country: input.providerCountry,
      trust_type: input.trustType,
      trust_creation_date: toDateOnly(input.trustCreationDate),
      requesting_wm_user_id: actor.id,
      requesting_wm_team: input.requestingWmTeam,
      business_priority: input.businessPriority,
      target_provider_submission_date: toDateOnly(input.targetProviderSubmissionDate),
    })
    .select()
    .single();

  if (insertError || !caseData) {
    throw new Error(`Failed to create trust case: ${insertError?.message}`);
  }

  await recordEvent({
    trustCaseId: caseData.id,
    eventType: "case_created",
    comment: `Case created by ${actor.email}`,
    performedBy: actor.id,
    metadataJson: { caseReference, trustName: input.trustName },
  });

  return caseData as TrustCaseRow;
}

export async function getTrustCase(caseId: string): Promise<TrustCaseWithRequirements> {
  const client = createServiceClient();

  const { data, error } = await client
    .from("trust_cases")
    .select("*, requirements:trust_registration_requirements(*)")
    .eq("id", caseId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch trust case: ${error.message}`);
  if (!data) throw notFound(`Trust case ${caseId} not found`);

  return data as TrustCaseWithRequirements;
}

export interface ListTrustCasesFilter {
  wmTeam?: string;
  status?: OverallStatus;
  assignedAepUserId?: string;
  search?: string;
  includeDeleted?: boolean;
}

export async function listTrustCases(filter: ListTrustCasesFilter = {}): Promise<TrustCaseWithRequirements[]> {
  const client = createServiceClient();

  let query = client.from("trust_cases").select("*, requirements:trust_registration_requirements(*)");

  if (filter.wmTeam) query = query.eq("requesting_wm_team", filter.wmTeam);
  if (filter.status) query = query.eq("overall_status", filter.status);
  if (filter.assignedAepUserId) query = query.eq("assigned_aep_user_id", filter.assignedAepUserId);
  if (!filter.includeDeleted) query = query.eq("is_deleted", false);
  if (filter.search) {
    const term = `%${filter.search}%`;
    query = query.or(`trust_name.ilike.${term},client_display_name.ilike.${term},case_reference.ilike.${term}`);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list trust cases: ${error.message}`);

  return (data ?? []) as TrustCaseWithRequirements[];
}

export async function assignAepOwner(caseId: string, aepUserId: string | null, actor: AuthUser): Promise<TrustCaseRow> {
  const client = createServiceClient();

  const { data, error } = await client
    .from("trust_cases")
    .update({ assigned_aep_user_id: aepUserId })
    .eq("id", caseId)
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to assign AEP owner: ${error?.message}`);

  await recordEvent({
    trustCaseId: caseId,
    eventType: "owner_assigned",
    comment: `AEP owner assigned by ${actor.email}`,
    performedBy: actor.id,
    metadataJson: { aepUserId },
  });

  return data as TrustCaseRow;
}

// AEP hands the verified registration pack back to WM. Only possible once the activation gate is
// open, and it notifies the requesting WM user with the list of certificates.
export async function handBackToWm(caseId: string, comment: string | undefined, actor: AuthUser): Promise<TrustCaseRow> {
  const client = createServiceClient();
  const trustCase = await getTrustCase(caseId);

  if (trustCase.activation_blocked || trustCase.overall_status !== "ready_for_provider") {
    throw conflict(`Case cannot be handed back while its status is ${trustCase.overall_status}. Every required registration must be verified first.`);
  }

  const certificates = await getVerifiedDocumentsForCase(caseId);
  if (certificates.length === 0) {
    throw conflict("No verified certificate is attached to this case. Upload and verify the registration evidence before handing back.");
  }

  const { data, error } = await client
    .from("trust_cases")
    .update({ overall_status: "handed_back_to_wm" })
    .eq("id", caseId)
    .select()
    .single();
  if (error || !data) throw new Error(`Failed to hand back case: ${error?.message}`);

  await recordEvent({
    trustCaseId: caseId,
    eventType: "case_handed_back",
    previousStatus: trustCase.overall_status,
    newStatus: "handed_back_to_wm",
    comment: comment ?? "Registration pack handed back to WM",
    performedBy: actor.id,
    metadataJson: { certificates: certificates.map((d) => ({ id: d.id, fileName: d.file_name, documentType: d.document_type })) },
  });

  await notifyWmHandedBack({
    trustCaseId: caseId,
    caseReference: trustCase.case_reference,
    trustName: trustCase.trust_name,
    providerName: trustCase.provider_name,
    requestingWmUserId: trustCase.requesting_wm_user_id,
    actorId: actor.id,
    comment,
    certificates: certificates.map((d) => d.file_name),
  });

  return data as TrustCaseRow;
}

// WM confirms the provider has accepted the trust. Closes the case for reporting.
export async function closeCase(caseId: string, comment: string | undefined, actor: AuthUser): Promise<TrustCaseRow> {
  const client = createServiceClient();
  const trustCase = await getTrustCase(caseId);

  if (actor.role === "wm_requester" && trustCase.requesting_wm_team !== actor.wmTeam) {
    throw forbidden("This case belongs to another WM team");
  }
  if (!["ready_for_provider", "handed_back_to_wm"].includes(trustCase.overall_status)) {
    throw conflict(`Case cannot be closed while its status is ${trustCase.overall_status}.`);
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from("trust_cases")
    .update({ overall_status: "closed", closed_at: now })
    .eq("id", caseId)
    .select()
    .single();
  if (error || !data) throw new Error(`Failed to close case: ${error?.message}`);

  await recordEvent({
    trustCaseId: caseId,
    eventType: "case_closed",
    previousStatus: trustCase.overall_status,
    newStatus: "closed",
    comment: comment ?? "Provider accepted the trust; case closed",
    performedBy: actor.id,
  });

  return data as TrustCaseRow;
}

// Soft delete only. Rows are never removed.
export async function softDeleteTrustCase(caseId: string, reason: string, actor: AuthUser): Promise<void> {
  const client = createServiceClient();

  const { error } = await client
    .from("trust_cases")
    .update({ is_deleted: true, deleted_at: new Date().toISOString(), deletion_reason: reason })
    .eq("id", caseId);

  if (error) throw new Error(`Failed to delete trust case: ${error.message}`);

  await recordEvent({
    trustCaseId: caseId,
    eventType: "status_changed",
    comment: `Case soft-deleted: ${reason}`,
    performedBy: actor.id,
  });
}
