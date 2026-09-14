import type { OverallStatus, RequirementStatus, RequirementDecisionStatus } from "@/server/domain/types";

export interface RequirementSnapshot {
  requirementStatus: RequirementDecisionStatus;
  status: RequirementStatus;
  registrationDeadline?: string | Date | null;
}

const TERMINAL: RequirementStatus[] = ["verified_completed", "not_required", "cancelled"];

// Precedence, in order:
// 1. nothing decided yet                            -> requirement_review
// 2. any required, unfinished, deadline passed       -> overdue
// 3. any required requirement still awaiting input   -> blocked
// 4. every required requirement verified_completed   -> ready_for_provider
// 5. otherwise                                       -> registration_in_progress
export function deriveOverallStatus(requirements: RequirementSnapshot[], now: Date = new Date()): OverallStatus {
  if (requirements.length === 0 || requirements.every((r) => r.requirementStatus === "under_review")) {
    return "requirement_review";
  }

  const required = requirements.filter((r) => r.requirementStatus === "required");

  const overdue = required.some(
    (r) =>
      !TERMINAL.includes(r.status) &&
      r.registrationDeadline != null &&
      new Date(r.registrationDeadline).getTime() < now.getTime()
  );
  if (overdue) return "overdue";

  const blocked = required.some((r) => r.status === "awaiting_information" || r.status === "requirement_review");
  if (blocked) return "blocked";

  if (required.length > 0 && required.every((r) => r.status === "verified_completed")) {
    return "ready_for_provider";
  }

  return "registration_in_progress";
}

// handed_back_to_wm and closed are set by people, not derived. They survive a recompute for as long
// as the activation gate stays open; if a requirement is reopened the derived status takes over again.
const MANUAL: OverallStatus[] = ["handed_back_to_wm", "closed"];

export function reconcileOverallStatus(current: OverallStatus, derived: OverallStatus, activationBlocked: boolean): OverallStatus {
  if (MANUAL.includes(current) && !activationBlocked) return current;
  return derived;
}
