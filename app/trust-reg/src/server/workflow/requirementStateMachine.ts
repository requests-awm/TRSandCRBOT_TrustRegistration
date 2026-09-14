import type { RequirementStatus, DocumentRow, UserRole, ChecklistItem, EventType } from "@/server/domain/types";

export const TRANSITIONS = [
  "DECIDE_REQUIREMENT",
  "REQUEST_INFORMATION",
  "MARK_READY_TO_REGISTER",
  "START_REGISTRATION",
  "SUBMIT_TO_AUTHORITY",
  "RECORD_AUTHORITY_QUERY",
  "RESOLVE_QUERY",
  "RECORD_COMPLETION_EVIDENCE",
  "VERIFY_EVIDENCE",
  "REJECT_EVIDENCE",
  "RESUBMIT_AFTER_REJECTION",
  "CANCEL_REQUIREMENT",
  "REOPEN_CASE",
] as const;
export type Transition = (typeof TRANSITIONS)[number];

export type TransitionDocument = Pick<DocumentRow, "is_current" | "verification_status" | "uploaded_by">;

export interface TransitionContext {
  status: RequirementStatus;
  documents: TransitionDocument[];
  actingUserId: string;
  actingUserRole: UserRole;
  payload: Record<string, unknown>;
  checklist?: ChecklistItem[] | null;
}

export interface TransitionDefinition {
  label: string;
  from: RequirementStatus[];
  to: RequirementStatus;
  allowedRoles: UserRole[];
  requiredFields?: string[];
  eventType: EventType;
  precondition?: (ctx: TransitionContext) => { ok: true } | { ok: false; reason: string };
}

export type TransitionResult =
  | { ok: true; newStatus: RequirementStatus; eventType: EventType }
  | { ok: false; error: string };

function isChecklistComplete(checklist?: ChecklistItem[] | null): boolean {
  if (!Array.isArray(checklist)) return true;
  return checklist.every((item) => item?.completed === true);
}

const PROCESSING_ROLES: UserRole[] = ["aep_processor", "aep_reviewer", "administrator"];
const REVIEW_ROLES: UserRole[] = ["aep_reviewer", "compliance_reviewer", "administrator"];

export const STATE_MACHINE: Record<Transition, TransitionDefinition> = {
  DECIDE_REQUIREMENT: {
    label: "Confirm requirement decision",
    from: ["requirement_review"],
    to: "not_started",
    allowedRoles: PROCESSING_ROLES,
    eventType: "status_changed",
  },
  REQUEST_INFORMATION: {
    label: "Request information",
    from: ["not_started", "ready_to_register"],
    to: "awaiting_information",
    allowedRoles: PROCESSING_ROLES,
    requiredFields: ["comment"],
    eventType: "information_requested",
  },
  MARK_READY_TO_REGISTER: {
    label: "Mark ready to register",
    from: ["not_started", "awaiting_information"],
    to: "ready_to_register",
    allowedRoles: PROCESSING_ROLES,
    eventType: "status_changed",
  },
  START_REGISTRATION: {
    label: "Start registration",
    from: ["ready_to_register"],
    to: "registration_in_progress",
    allowedRoles: PROCESSING_ROLES,
    eventType: "status_changed",
  },
  SUBMIT_TO_AUTHORITY: {
    label: "Submit to authority",
    from: ["registration_in_progress"],
    to: "submitted",
    allowedRoles: PROCESSING_ROLES,
    requiredFields: ["comment"],
    eventType: "submitted_to_authority",
    precondition: (ctx) =>
      isChecklistComplete(ctx.checklist)
        ? { ok: true }
        : { ok: false, reason: "Checklist must be complete before submission." },
  },
  RECORD_AUTHORITY_QUERY: {
    label: "Record authority query",
    from: ["submitted"],
    to: "authority_query",
    allowedRoles: PROCESSING_ROLES,
    requiredFields: ["comment"],
    eventType: "authority_query_received",
  },
  RESOLVE_QUERY: {
    label: "Resolve query",
    from: ["authority_query"],
    to: "submitted",
    allowedRoles: PROCESSING_ROLES,
    requiredFields: ["comment"],
    eventType: "status_changed",
  },
  RECORD_COMPLETION_EVIDENCE: {
    label: "Record completion evidence",
    from: ["submitted", "authority_query"],
    to: "completed_pending_evidence",
    allowedRoles: PROCESSING_ROLES,
    eventType: "registration_completed",
    precondition: (ctx) =>
      ctx.documents.some((d) => d.is_current)
        ? { ok: true }
        : { ok: false, reason: "Upload the completion evidence document before recording completion." },
  },
  VERIFY_EVIDENCE: {
    label: "Verify evidence",
    from: ["completed_pending_evidence"],
    to: "verified_completed",
    allowedRoles: REVIEW_ROLES,
    requiredFields: ["authorityReference"],
    eventType: "evidence_verified",
    precondition: (ctx) => {
      const currentDoc = ctx.documents.find((d) => d.is_current && d.verification_status === "verified");
      if (!currentDoc) {
        return {
          ok: false,
          reason: "The current evidence document must be verified before the requirement can be closed.",
        };
      }
      if (currentDoc.uploaded_by === ctx.actingUserId) {
        return {
          ok: false,
          reason: "Verification denied: the uploader cannot verify their own document (maker-checker control).",
        };
      }
      return { ok: true };
    },
  },
  REJECT_EVIDENCE: {
    label: "Reject evidence",
    from: ["completed_pending_evidence"],
    to: "evidence_rejected",
    allowedRoles: REVIEW_ROLES,
    requiredFields: ["rejectionReason"],
    eventType: "evidence_rejected",
  },
  RESUBMIT_AFTER_REJECTION: {
    label: "Resubmit evidence",
    from: ["evidence_rejected"],
    to: "completed_pending_evidence",
    allowedRoles: PROCESSING_ROLES,
    eventType: "status_changed",
    precondition: (ctx) =>
      ctx.documents.some((d) => d.is_current && d.verification_status !== "rejected")
        ? { ok: true }
        : { ok: false, reason: "Upload a replacement document before resubmitting." },
  },
  CANCEL_REQUIREMENT: {
    label: "Cancel requirement",
    from: [
      "requirement_review",
      "not_started",
      "awaiting_information",
      "ready_to_register",
      "registration_in_progress",
      "submitted",
      "authority_query",
      "completed_pending_evidence",
      "evidence_rejected",
    ],
    to: "cancelled",
    allowedRoles: ["administrator"],
    requiredFields: ["comment"],
    eventType: "requirement_cancelled",
  },
  REOPEN_CASE: {
    label: "Reopen",
    from: ["verified_completed"],
    to: "registration_in_progress",
    allowedRoles: ["compliance_reviewer", "administrator"],
    requiredFields: ["comment"],
    eventType: "case_reopened",
  },
};

// Pure and synchronous: every precondition works on data the caller has already loaded.
export function applyTransition(transition: Transition, ctx: TransitionContext): TransitionResult {
  const def = STATE_MACHINE[transition];
  if (!def) return { ok: false, error: `Unknown transition: ${transition}` };

  if (!def.from.includes(ctx.status)) {
    return {
      ok: false,
      error: `Illegal transition: cannot ${transition} from ${ctx.status}. Allowed from: ${def.from.join(", ")}`,
    };
  }

  if (!def.allowedRoles.includes(ctx.actingUserRole)) {
    return {
      ok: false,
      error: `Forbidden: role ${ctx.actingUserRole} is not allowed for ${transition}. Allowed roles: ${def.allowedRoles.join(", ")}`,
    };
  }

  if (def.requiredFields) {
    const missing = def.requiredFields.filter((field) => {
      const v = ctx.payload[field];
      return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    });
    if (missing.length > 0) return { ok: false, error: `Missing required fields: ${missing.join(", ")}` };
  }

  if (def.precondition) {
    const check = def.precondition(ctx);
    if (!check.ok) return { ok: false, error: check.reason };
  }

  return { ok: true, newStatus: def.to, eventType: def.eventType };
}

// Transitions that are legal from a status for a role, ignoring payload and preconditions.
// The UI uses this to decide which action buttons to render.
export function availableTransitions(status: RequirementStatus, role: UserRole): Transition[] {
  return TRANSITIONS.filter(
    (t) => STATE_MACHINE[t].from.includes(status) && STATE_MACHINE[t].allowedRoles.includes(role)
  );
}
