import type { Authority, SimpleStatus, TrustCaseWithRequirements } from "@/server/domain/types";
import { simpleCaseStatus } from "@/server/workflow/deriveSimpleStatus";
import { AUTHORITY_LABEL } from "@/lib/labels";

// Shape shared by the list and board views of the dashboard.
export type DashboardRow = TrustCaseWithRequirements & { simple: SimpleStatus; jurisdictions: Authority[] };

export const toDashboardRow = (c: TrustCaseWithRequirements): DashboardRow => ({
  ...c,
  simple: simpleCaseStatus(
    c.overall_status,
    c.requirements.map((r) => ({ requirementStatus: r.requirement_status, status: r.status }))
  ),
  jurisdictions: c.requirements.filter((r) => r.requirement_status === "required").map((r) => r.authority),
});

export const jurisdictionLabel = (j: Authority[]) =>
  j.length === 0 ? "Undecided" : j.length === 2 ? "UK TRS + Ireland CRBOT" : AUTHORITY_LABEL[j[0]];

// Overdue against the target provider submission date, ignoring cases that are already done.
export function isPastTarget(row: DashboardRow, now = new Date()): boolean {
  if (!row.target_provider_submission_date || row.simple === "completed") return false;
  return new Date(row.target_provider_submission_date).getTime() < now.setHours(0, 0, 0, 0);
}
