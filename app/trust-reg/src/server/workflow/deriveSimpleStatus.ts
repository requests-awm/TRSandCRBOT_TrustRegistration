import type { OverallStatus, RequirementDecisionStatus, RequirementStatus, SimpleStatus } from "@/server/domain/types";

// Collapses the detailed workflow into the three states the requirement asks for:
// not started / in progress / completed. Used for the dashboard roll-up and WM-facing views.

const NOT_STARTED: RequirementStatus[] = ["requirement_review", "not_started"];
const COMPLETED: RequirementStatus[] = ["verified_completed", "not_required", "cancelled"];

export function simpleRequirementStatus(status: RequirementStatus): SimpleStatus {
  if (COMPLETED.includes(status)) return "completed";
  if (NOT_STARTED.includes(status)) return "not_started";
  return "in_progress";
}

export interface SimpleStatusSnapshot {
  requirementStatus: RequirementDecisionStatus;
  status: RequirementStatus;
}

// Case level:
// - completed  when the case has been handed back or closed, or every required registration is verified
// - not_started when nothing has been decided, or every required registration is still not started
// - in_progress otherwise
export function simpleCaseStatus(overallStatus: OverallStatus, requirements: SimpleStatusSnapshot[]): SimpleStatus {
  if (overallStatus === "ready_for_provider" || overallStatus === "handed_back_to_wm" || overallStatus === "closed") {
    return "completed";
  }
  const required = requirements.filter((r) => r.requirementStatus === "required");
  if (required.length === 0) return "not_started";
  if (required.every((r) => simpleRequirementStatus(r.status) === "not_started")) return "not_started";
  return "in_progress";
}
