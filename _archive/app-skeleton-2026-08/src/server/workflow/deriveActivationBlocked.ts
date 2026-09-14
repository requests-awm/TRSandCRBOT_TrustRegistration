import { RequirementDecisionStatus, RequirementStatus } from "@prisma/client";

export interface RequirementSnapshot {
  requirementStatus: RequirementDecisionStatus;
  status: RequirementStatus;
}

// Derive whether a trust case should have activation_blocked = true.
// Rule: activation_blocked is false ONLY when:
// 1. At least one requirement has been decided (requirement_status != under_review), AND
// 2. Every REQUIRED requirement has status = verified_completed
//
// Otherwise: activation_blocked = true
export function deriveActivationBlocked(requirements: RequirementSnapshot[]): boolean {
  // No requirements decided yet -> still blocked
  if (requirements.length === 0 || requirements.every((r) => r.requirementStatus === "under_review")) {
    return true;
  }

  // Get all REQUIRED requirements
  const requiredReqs = requirements.filter((r) => r.requirementStatus === "required");

  // If there are no required requirements, stay blocked (can't activate without any known requirement)
  if (requiredReqs.length === 0) {
    return true;
  }

  // Check if all required are verified_completed
  const allVerified = requiredReqs.every((r) => r.status === "verified_completed");

  return !allVerified; // blocked = !allVerified
}
