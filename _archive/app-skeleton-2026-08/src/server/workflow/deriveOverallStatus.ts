import { OverallStatus, RequirementStatus, RequirementDecisionStatus } from "@prisma/client";

export interface RequirementSnapshot {
  requirementStatus: RequirementDecisionStatus;
  status: RequirementStatus;
  registrationDeadline?: Date | null;
}

// Derive the overall trust case status from its requirements.
// Precedence (in order):
// 1. If no requirements have been decided -> requirement_review
// 2. If any required registration is overdue -> overdue
// 3. If any required registration is blocked/awaiting_information -> blocked
// 4. If any required registration is not verified_completed -> registration_in_progress
// 5. If every required registration is verified_completed -> ready_for_provider
// 6. [Later, after WM ack and provider confirmation] -> handed_back_to_wm, closed
export function deriveOverallStatus(
  requirements: RequirementSnapshot[],
  _wmAcknowledged: boolean = false,
  _providerSubmissionConfirmed: boolean = false
): OverallStatus {
  // Step 1: If no requirements decided yet
  if (requirements.length === 0 || requirements.every((r) => r.requirementStatus === "under_review")) {
    return "requirement_review";
  }

  const requiredReqs = requirements.filter((r) => r.requirementStatus === "required");

  // Step 2: Check for overdue (required registration with deadline passed)
  const now = new Date();
  const overdue = requiredReqs.some((r) => r.registrationDeadline && new Date(r.registrationDeadline) < now);
  if (overdue) {
    return "overdue";
  }

  // Step 3: Check for blocked (awaiting_information or requirement_review)
  const blocked = requiredReqs.some(
    (r) => r.status === "awaiting_information" || r.status === "requirement_review"
  );
  if (blocked) {
    return "blocked";
  }

  // Step 4: Check if all required are verified_completed
  const allVerified = requiredReqs.every((r) => r.status === "verified_completed");
  if (allVerified) {
    // Future: if wmAcknowledged && providerSubmissionConfirmed -> "closed"
    // For MVP, just return ready_for_provider
    return "ready_for_provider";
  }

  // Step 5: Default to in progress
  return "registration_in_progress";
}
