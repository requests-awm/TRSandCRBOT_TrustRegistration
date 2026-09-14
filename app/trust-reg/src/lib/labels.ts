import type {
  Authority,
  BusinessPriority,
  DocumentType,
  EventType,
  OverallStatus,
  RequirementDecisionStatus,
  RequirementStatus,
  SimpleStatus,
  UserRole,
  VerificationStatus,
} from "@/server/domain/types";

export const SIMPLE_STATUS_LABEL: Record<SimpleStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};

export const SIMPLE_STATUS_TONE: Record<SimpleStatus, string> = {
  not_started: "bg-slate-100 text-slate-700 ring-slate-200",
  in_progress: "bg-blue-100 text-blue-800 ring-blue-200",
  completed: "bg-emerald-100 text-emerald-800 ring-emerald-200",
};

export const AUTHORITY_LABEL: Record<Authority, string> = {
  trs: "UK TRS",
  crbot: "Ireland CRBOT",
};

export const OVERALL_STATUS_LABEL: Record<OverallStatus, string> = {
  requirement_review: "Requirement review",
  overdue: "Overdue",
  blocked: "Blocked",
  registration_in_progress: "Registration in progress",
  ready_for_provider: "Ready for provider",
  handed_back_to_wm: "Handed back to WM",
  closed: "Closed",
};

export const REQUIREMENT_STATUS_LABEL: Record<RequirementStatus, string> = {
  requirement_review: "Requirement review",
  not_started: "Not started",
  awaiting_information: "Awaiting information",
  ready_to_register: "Ready to register",
  registration_in_progress: "Registration in progress",
  submitted: "Submitted to authority",
  authority_query: "Authority query",
  completed_pending_evidence: "Completed, pending evidence",
  evidence_rejected: "Evidence rejected",
  verified_completed: "Verified complete",
  not_required: "Not required",
  cancelled: "Cancelled",
};

export const DECISION_LABEL: Record<RequirementDecisionStatus, string> = {
  required: "Required",
  not_required: "Not required",
  under_review: "Under review",
};

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  trs_proof_of_registration: "TRS proof of registration",
  trs_urn_confirmation: "TRS URN confirmation",
  trs_utr_confirmation: "TRS UTR confirmation",
  crbot_registration_confirmation: "CRBOT registration confirmation",
  crbot_trust_register_number: "CRBOT trust register number",
  authority_correspondence: "Authority correspondence",
  supporting_document: "Supporting document",
  provider_submission_copy: "Provider submission copy",
};

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  pending: "Pending verification",
  verified: "Verified",
  rejected: "Rejected",
};

export const ROLE_LABEL: Record<UserRole, string> = {
  wm_requester: "WM requester",
  aep_processor: "AEP processor",
  aep_reviewer: "AEP reviewer",
  compliance_reviewer: "Compliance reviewer",
  administrator: "Administrator",
  auditor: "Auditor",
};

export const PRIORITY_LABEL: Record<BusinessPriority, string> = {
  standard: "Standard",
  urgent: "Urgent",
  critical: "Critical",
};

export const EVENT_LABEL: Record<EventType, string> = {
  case_created: "Case created",
  requirement_added: "Requirement decision",
  owner_assigned: "Owner assigned",
  information_requested: "Information requested",
  document_uploaded: "Document uploaded",
  submitted_to_authority: "Submitted to authority",
  authority_query_received: "Authority query received",
  registration_completed: "Registration completed",
  evidence_verified: "Evidence verified",
  wm_notified: "WM notified",
  activation_unblocked: "Activation unblocked",
  case_reopened: "Case reopened",
  status_changed: "Status changed",
  evidence_rejected: "Evidence rejected",
  requirement_cancelled: "Requirement cancelled",
  case_handed_back: "Handed back to WM",
  case_closed: "Case closed",
};

// Tailwind classes per status. Kept here so every badge in the app agrees.
export const OVERALL_STATUS_TONE: Record<OverallStatus, string> = {
  requirement_review: "bg-slate-100 text-slate-700 ring-slate-200",
  overdue: "bg-red-100 text-red-800 ring-red-200",
  blocked: "bg-amber-100 text-amber-800 ring-amber-200",
  registration_in_progress: "bg-blue-100 text-blue-800 ring-blue-200",
  ready_for_provider: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  handed_back_to_wm: "bg-violet-100 text-violet-800 ring-violet-200",
  closed: "bg-zinc-200 text-zinc-700 ring-zinc-300",
};

export const REQUIREMENT_STATUS_TONE: Record<RequirementStatus, string> = {
  requirement_review: "bg-slate-100 text-slate-700 ring-slate-200",
  not_started: "bg-slate-100 text-slate-700 ring-slate-200",
  awaiting_information: "bg-amber-100 text-amber-800 ring-amber-200",
  ready_to_register: "bg-sky-100 text-sky-800 ring-sky-200",
  registration_in_progress: "bg-blue-100 text-blue-800 ring-blue-200",
  submitted: "bg-indigo-100 text-indigo-800 ring-indigo-200",
  authority_query: "bg-orange-100 text-orange-800 ring-orange-200",
  completed_pending_evidence: "bg-teal-100 text-teal-800 ring-teal-200",
  evidence_rejected: "bg-red-100 text-red-800 ring-red-200",
  verified_completed: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  not_required: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  cancelled: "bg-zinc-200 text-zinc-700 ring-zinc-300",
};

export const VERIFICATION_TONE: Record<VerificationStatus, string> = {
  pending: "bg-amber-100 text-amber-800 ring-amber-200",
  verified: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  rejected: "bg-red-100 text-red-800 ring-red-200",
};

export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return withTime
    ? d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
