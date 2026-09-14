import { createServiceClient } from "@/lib/supabase/service";
import { Authority } from "@prisma/client";
import { recordEvent } from "./eventService";
import { AuthUser } from "@/server/auth/roles";
import { deriveOverallStatus, type RequirementSnapshot } from "@/server/workflow/deriveOverallStatus";
import { deriveActivationBlocked } from "@/server/workflow/deriveActivationBlocked";

export interface SetRequirementDecisionInput {
  trustCaseId: string;
  authority: Authority;
  requirementStatus: "required" | "not_required" | "under_review";
  requirementReason: string;
  complianceRuleId: string;
  registrationDeadline?: Date;
  internalTargetDate?: Date;
}

// Set the requirement decision for an authority (TRS or CRBOT).
// Creates or updates the registration requirement record.
// Recomputes the case's overall_status and activation_blocked.
export async function setRequirementDecision(input: SetRequirementDecisionInput, actor: AuthUser) {
  const client = createServiceClient();

  // Check if a requirement already exists for this (trust_case, authority) pair
  const { data: existing } = await client
    .from("trust_registration_requirements")
    .select("*")
    .eq("trust_case_id", input.trustCaseId)
    .eq("authority", input.authority)
    .single();

  let requirement;

  if (existing) {
    // Update existing
    const { data, error } = await client
      .from("trust_registration_requirements")
      .update({
        requirement_status: input.requirementStatus,
        requirement_reason: input.requirementReason,
        requirement_decided_by: actor.id,
        requirement_decided_at: new Date().toISOString(),
        compliance_rule_id: input.complianceRuleId,
        registration_deadline: input.registrationDeadline?.toISOString().split("T")[0],
        internal_target_date: input.internalTargetDate?.toISOString().split("T")[0],
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update requirement: ${error.message}`);
    }

    requirement = data;

    // Record event
    await recordEvent({
      trustCaseId: input.trustCaseId,
      registrationRequirementId: requirement.id,
      eventType: "requirement_added",
      comment: `Requirement decision updated: ${input.requirementStatus}. Reason: ${input.requirementReason}`,
      performedBy: actor.id,
      metadataJson: {
        authority: input.authority,
        requirementStatus: input.requirementStatus,
      },
    });
  } else {
    // Create new
    const { data, error } = await client
      .from("trust_registration_requirements")
      .insert({
        trust_case_id: input.trustCaseId,
        authority: input.authority,
        requirement_status: input.requirementStatus,
        requirement_reason: input.requirementReason,
        requirement_decided_by: actor.id,
        requirement_decided_at: new Date().toISOString(),
        compliance_rule_id: input.complianceRuleId,
        registration_deadline: input.registrationDeadline?.toISOString().split("T")[0],
        internal_target_date: input.internalTargetDate?.toISOString().split("T")[0],
        status: "requirement_review",
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create requirement: ${error.message}`);
    }

    requirement = data;

    // Record event
    await recordEvent({
      trustCaseId: input.trustCaseId,
      registrationRequirementId: requirement.id,
      eventType: "requirement_added",
      comment: `${input.authority.toUpperCase()} requirement added: ${input.requirementStatus}. Reason: ${input.requirementReason}`,
      performedBy: actor.id,
      metadataJson: {
        authority: input.authority,
        requirementStatus: input.requirementStatus,
      },
    });
  }

  // Recompute the case's derived status
  await recomputeCaseDerivedState(input.trustCaseId, actor.id);

  return requirement;
}

// Assign an AEP processor/reviewer to a requirement.
export async function assignOwner(requirementId: string, ownerId: string, actor: AuthUser) {
  const client = createServiceClient();

  const { data, error } = await client
    .from("trust_registration_requirements")
    .update({ assigned_to: ownerId })
    .eq("id", requirementId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to assign owner: ${error.message}`);
  }

  // Record event
  const requirement = data;
  await recordEvent({
    trustCaseId: requirement.trust_case_id,
    registrationRequirementId: requirementId,
    eventType: "owner_assigned",
    comment: `Owner assigned by ${actor.email}`,
    performedBy: actor.id,
    metadataJson: { ownerId },
  });

  return data;
}

// Recompute the trust case's overall_status and activation_blocked.
// Called after every requirement mutation.
export async function recomputeCaseDerivedState(trustCaseId: string, actor: string) {
  const client = createServiceClient();

  // Fetch all requirements for this case
  const { data: requirements, error: fetchError } = await client
    .from("trust_registration_requirements")
    .select("requirement_status, status, registration_deadline")
    .eq("trust_case_id", trustCaseId);

  if (fetchError || !requirements) {
    console.error("Failed to fetch requirements for recompute:", fetchError);
    return;
  }

  // Derive new status
  const newOverallStatus = deriveOverallStatus(requirements as RequirementSnapshot[]);
  const newActivationBlocked = deriveActivationBlocked(requirements as RequirementSnapshot[]);

  // Fetch current case state to detect changes
  const { data: currentCase, error: caseError } = await client
    .from("trust_cases")
    .select("overall_status, activation_blocked")
    .eq("id", trustCaseId)
    .single();

  if (caseError || !currentCase) {
    console.error("Failed to fetch current case state:", caseError);
    return;
  }

  // Update if changed
  const hasStatusChange = currentCase.overall_status !== newOverallStatus;
  const hasBlockChange = currentCase.activation_blocked !== newActivationBlocked;

  if (hasStatusChange || hasBlockChange) {
    const { error: updateError } = await client
      .from("trust_cases")
      .update({
        overall_status: newOverallStatus,
        activation_blocked: newActivationBlocked,
      })
      .eq("id", trustCaseId);

    if (updateError) {
      console.error("Failed to update case derived state:", updateError);
      return;
    }

    // Record the status change event
    if (hasStatusChange) {
      await recordEvent({
        trustCaseId,
        eventType: "case_created", // TODO: use a more appropriate event type if needed
        previousStatus: currentCase.overall_status,
        newStatus: newOverallStatus,
        comment: `Case status auto-recomputed`,
        performedBy: actor,
      });
    }

    // Record the activation gate event
    if (hasBlockChange && !newActivationBlocked) {
      await recordEvent({
        trustCaseId,
        eventType: "activation_unblocked",
        comment: `Activation gate released: all required registrations verified`,
        performedBy: actor,
      });
    }
  }
}
