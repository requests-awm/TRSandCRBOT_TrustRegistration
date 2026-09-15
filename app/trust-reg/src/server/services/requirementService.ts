import { createServiceClient } from "@/lib/supabase/service";
import type {
  Authority,
  RequirementRow,
  RequirementDecisionStatus,
  RequirementStatus,
  ChecklistItem,
  TrustCaseRow,
} from "@/server/domain/types";
import { recordEvent } from "./eventService";
import { getDocuments } from "./documentService";
import { notifyWmReadyForProvider, notifyWmStatusChanged, wmNotifyPolicy } from "./notificationService";
import { REQUIREMENT_STATUS_LABEL } from "@/lib/labels";
import { AuthUser } from "@/server/auth/roles";
import { deriveOverallStatus, reconcileOverallStatus, type RequirementSnapshot } from "@/server/workflow/deriveOverallStatus";
import { deriveActivationBlocked } from "@/server/workflow/deriveActivationBlocked";
import { applyTransition, type Transition } from "@/server/workflow/requirementStateMachine";
import { conflict, notFound } from "@/server/http/errors";

const toDateOnly = (d?: Date | null) => (d ? d.toISOString().split("T")[0] : undefined);

export interface SetRequirementDecisionInput {
  trustCaseId: string;
  authority: Authority;
  requirementStatus: RequirementDecisionStatus;
  requirementReason: string;
  complianceRuleId?: string;
  registrationDeadline?: Date;
  internalTargetDate?: Date;
}

// Creates or updates the (trust_case, authority) requirement and recomputes the case.
export async function setRequirementDecision(input: SetRequirementDecisionInput, actor: AuthUser): Promise<RequirementRow> {
  const client = createServiceClient();

  const { data: existing } = await client
    .from("trust_registration_requirements")
    .select("id, status")
    .eq("trust_case_id", input.trustCaseId)
    .eq("authority", input.authority)
    .maybeSingle();

  const decisionFields = {
    requirement_status: input.requirementStatus,
    requirement_reason: input.requirementReason,
    requirement_decided_by: actor.id,
    requirement_decided_at: new Date().toISOString(),
    compliance_rule_id: input.complianceRuleId ?? null,
    registration_deadline: toDateOnly(input.registrationDeadline) ?? null,
    internal_target_date: toDateOnly(input.internalTargetDate) ?? null,
  };

  // A not_required decision closes the requirement immediately; anything else waits in requirement_review.
  const statusForDecision: RequirementStatus =
    input.requirementStatus === "not_required" ? "not_required" : "requirement_review";

  let requirement: RequirementRow;

  if (existing) {
    const { data, error } = await client
      .from("trust_registration_requirements")
      .update({ ...decisionFields, status: statusForDecision })
      .eq("id", existing.id)
      .select()
      .single();
    if (error || !data) throw new Error(`Failed to update requirement: ${error?.message}`);
    requirement = data as RequirementRow;
  } else {
    const { data, error } = await client
      .from("trust_registration_requirements")
      .insert({
        trust_case_id: input.trustCaseId,
        authority: input.authority,
        ...decisionFields,
        status: statusForDecision,
        checklist: defaultChecklist(input.authority),
      })
      .select()
      .single();
    if (error || !data) throw new Error(`Failed to create requirement: ${error?.message}`);
    requirement = data as RequirementRow;
  }

  await recordEvent({
    trustCaseId: input.trustCaseId,
    registrationRequirementId: requirement.id,
    eventType: "requirement_added",
    comment: `${input.authority.toUpperCase()} requirement ${existing ? "updated" : "added"}: ${input.requirementStatus}. Reason: ${input.requirementReason}`,
    performedBy: actor.id,
    metadataJson: { authority: input.authority, requirementStatus: input.requirementStatus },
  });

  await recomputeCaseDerivedState(input.trustCaseId, actor);
  return requirement;
}

// PLACEHOLDER checklists. Replace with the agreed AEP checklist per authority.
export function defaultChecklist(authority: Authority): ChecklistItem[] {
  if (authority === "trs") {
    return [
      { key: "lead_trustee_details", label: "Lead trustee details confirmed", completed: false },
      { key: "settlor_details", label: "Settlor details confirmed", completed: false },
      { key: "beneficiary_details", label: "Beneficiary details confirmed", completed: false },
      { key: "gateway_access", label: "HMRC Government Gateway access ready", completed: false },
    ];
  }
  return [
    { key: "trustee_details", label: "Trustee details confirmed", completed: false },
    { key: "beneficial_owners", label: "Beneficial owners identified", completed: false },
    { key: "ros_access", label: "Revenue Online Service access ready", completed: false },
  ];
}

export interface UpdateRequirementFieldsInput {
  assignedTo?: string | null;
  registrationDeadline?: Date | null;
  internalTargetDate?: Date | null;
  checklist?: ChecklistItem[];
  authorityReference?: string | null;
  completionNotes?: string | null;
}

// Non-status edits: owner, dates, checklist, references. Status changes go through transitionRequirement.
export async function updateRequirementFields(
  requirementId: string,
  input: UpdateRequirementFieldsInput,
  actor: AuthUser
): Promise<RequirementRow> {
  const client = createServiceClient();

  const current = await getRequirement(requirementId);

  const patch: Record<string, unknown> = {};
  if (input.assignedTo !== undefined) patch.assigned_to = input.assignedTo;
  if (input.registrationDeadline !== undefined) patch.registration_deadline = toDateOnly(input.registrationDeadline) ?? null;
  if (input.internalTargetDate !== undefined) patch.internal_target_date = toDateOnly(input.internalTargetDate) ?? null;
  if (input.checklist !== undefined) patch.checklist = input.checklist;
  if (input.authorityReference !== undefined) patch.authority_reference = input.authorityReference;
  if (input.completionNotes !== undefined) patch.completion_notes = input.completionNotes;

  const { data, error } = await client
    .from("trust_registration_requirements")
    .update(patch)
    .eq("id", requirementId)
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to update requirement: ${error?.message}`);

  if (input.assignedTo !== undefined && input.assignedTo !== current.assigned_to) {
    await recordEvent({
      trustCaseId: current.trust_case_id,
      registrationRequirementId: requirementId,
      eventType: "owner_assigned",
      comment: `Owner assigned by ${actor.email}`,
      performedBy: actor.id,
      metadataJson: { ownerId: input.assignedTo },
    });
  }

  if (input.registrationDeadline !== undefined) {
    await recomputeCaseDerivedState(current.trust_case_id, actor);
  }

  return data as RequirementRow;
}

export async function getRequirement(requirementId: string): Promise<RequirementRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("trust_registration_requirements")
    .select("*")
    .eq("id", requirementId)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch requirement: ${error.message}`);
  if (!data) throw notFound(`Requirement ${requirementId} not found`);
  return data as RequirementRow;
}

export interface TransitionRequirementInput {
  requirementId: string;
  transition: Transition;
  payload: {
    comment?: string;
    authorityReference?: string;
    rejectionReason?: string;
    completionNotes?: string;
  };
}

// The core workflow endpoint: validates the transition against the state machine,
// persists the new status plus side fields, records the event and recomputes the case.
export async function transitionRequirement(input: TransitionRequirementInput, actor: AuthUser): Promise<RequirementRow> {
  const client = createServiceClient();
  const requirement = await getRequirement(input.requirementId);
  const documents = await getDocuments(input.requirementId);

  const result = applyTransition(input.transition, {
    status: requirement.status,
    documents,
    actingUserId: actor.id,
    actingUserRole: actor.role,
    payload: input.payload as Record<string, unknown>,
    checklist: requirement.checklist,
  });

  if (!result.ok) throw conflict(result.error);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: result.newStatus };
  if (result.newStatus === "submitted" && input.transition === "SUBMIT_TO_AUTHORITY") patch.submitted_at = now;
  if (result.newStatus === "completed_pending_evidence") patch.completed_at = now;
  if (result.newStatus === "verified_completed") {
    patch.verified_at = now;
    patch.verified_by = actor.id;
    patch.authority_reference = input.payload.authorityReference;
  }
  if (input.payload.completionNotes) patch.completion_notes = input.payload.completionNotes;

  const { data: updated, error } = await client
    .from("trust_registration_requirements")
    .update(patch)
    .eq("id", input.requirementId)
    .select()
    .single();

  if (error || !updated) throw new Error(`Failed to apply transition: ${error?.message}`);

  await recordEvent({
    trustCaseId: requirement.trust_case_id,
    registrationRequirementId: requirement.id,
    eventType: result.eventType,
    previousStatus: requirement.status,
    newStatus: result.newStatus,
    comment: input.payload.comment ?? input.payload.rejectionReason ?? undefined,
    performedBy: actor.id,
    metadataJson: { transition: input.transition, authority: requirement.authority, ...input.payload },
  });

  await recomputeCaseDerivedState(requirement.trust_case_id, actor);

  if (wmNotifyPolicy() === "all") {
    const { data: tc } = await client.from("trust_cases").select("*").eq("id", requirement.trust_case_id).single();
    if (tc) {
      const trustCase = tc as TrustCaseRow;
      await notifyWmStatusChanged({
        trustCaseId: trustCase.id,
        caseReference: trustCase.case_reference,
        trustName: trustCase.trust_name,
        providerName: trustCase.provider_name,
        requestingWmUserId: trustCase.requesting_wm_user_id,
        actorId: actor.id,
        registrationRequirementId: requirement.id,
        authority: requirement.authority.toUpperCase(),
        previousStatus: REQUIREMENT_STATUS_LABEL[requirement.status],
        newStatus: REQUIREMENT_STATUS_LABEL[result.newStatus],
        comment: input.payload.comment,
      }).catch((err) => console.error("status_changed notification failed:", err));
    }
  }

  return updated as RequirementRow;
}

// Recomputes overall_status and activation_blocked after every requirement mutation.
// Releasing the activation gate also notifies the requesting WM user.
export async function recomputeCaseDerivedState(trustCaseId: string, actor: AuthUser): Promise<void> {
  const client = createServiceClient();

  const { data: requirements, error: fetchError } = await client
    .from("trust_registration_requirements")
    .select("requirement_status, status, registration_deadline")
    .eq("trust_case_id", trustCaseId);

  if (fetchError || !requirements) {
    throw new Error(`Failed to fetch requirements for recompute: ${fetchError?.message}`);
  }

  const snapshots: RequirementSnapshot[] = requirements.map((r) => ({
    requirementStatus: r.requirement_status,
    status: r.status,
    registrationDeadline: r.registration_deadline,
  }));

  const derivedStatus = deriveOverallStatus(snapshots);
  const newActivationBlocked = deriveActivationBlocked(snapshots);

  const { data: currentCase, error: caseError } = await client
    .from("trust_cases")
    .select("*")
    .eq("id", trustCaseId)
    .single();

  if (caseError || !currentCase) {
    throw new Error(`Failed to fetch current case state: ${caseError?.message}`);
  }
  const trustCase = currentCase as TrustCaseRow;

  const newOverallStatus = reconcileOverallStatus(trustCase.overall_status, derivedStatus, newActivationBlocked);
  const hasStatusChange = trustCase.overall_status !== newOverallStatus;
  const hasBlockChange = trustCase.activation_blocked !== newActivationBlocked;
  if (!hasStatusChange && !hasBlockChange) return;

  const { error: updateError } = await client
    .from("trust_cases")
    .update({ overall_status: newOverallStatus, activation_blocked: newActivationBlocked })
    .eq("id", trustCaseId);

  if (updateError) throw new Error(`Failed to update case derived state: ${updateError.message}`);

  if (hasStatusChange) {
    await recordEvent({
      trustCaseId,
      eventType: "status_changed",
      previousStatus: trustCase.overall_status,
      newStatus: newOverallStatus,
      comment: "Case status recomputed from requirements",
      performedBy: actor.id,
    });
  }

  if (hasBlockChange && !newActivationBlocked) {
    await recordEvent({
      trustCaseId,
      eventType: "activation_unblocked",
      comment: "Activation gate released: all required registrations verified",
      performedBy: actor.id,
    });

    await notifyWmReadyForProvider({
      trustCaseId,
      caseReference: trustCase.case_reference,
      trustName: trustCase.trust_name,
      providerName: trustCase.provider_name,
      requestingWmUserId: trustCase.requesting_wm_user_id,
      actorId: actor.id,
    });
  }
}
