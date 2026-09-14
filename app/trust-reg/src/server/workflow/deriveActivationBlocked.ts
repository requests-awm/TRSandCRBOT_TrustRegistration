import type { RequirementDecisionStatus, RequirementStatus } from "@/server/domain/types";

export interface RequirementSnapshot {
  requirementStatus: RequirementDecisionStatus;
  status: RequirementStatus;
}

// activation_blocked is false ONLY when at least one requirement has been decided AND
// every REQUIRED requirement is verified_completed. Everything else stays blocked.
export function deriveActivationBlocked(requirements: RequirementSnapshot[]): boolean {
  if (requirements.length === 0 || requirements.every((r) => r.requirementStatus === "under_review")) {
    return true;
  }
  const required = requirements.filter((r) => r.requirementStatus === "required");
  if (required.length === 0) return true;
  return !required.every((r) => r.status === "verified_completed");
}
