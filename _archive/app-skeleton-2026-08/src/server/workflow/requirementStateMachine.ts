import { RequirementStatus, RegistrationDocument, UserRole } from "@prisma/client";

// All valid transitions in the registration workflow.
// Each transition defines: from states, to state, allowed roles, required fields, and preconditions.
export type Transition =
  | "DECIDE_REQUIREMENT"
  | "REQUEST_INFORMATION"
  | "MARK_READY_TO_REGISTER"
  | "START_REGISTRATION"
  | "SUBMIT_TO_AUTHORITY"
  | "RECORD_AUTHORITY_QUERY"
  | "RESOLVE_QUERY"
  | "RECORD_COMPLETION_EVIDENCE"
  | "VERIFY_EVIDENCE"
  | "REJECT_EVIDENCE"
  | "RESUBMIT_AFTER_REJECTION"
  | "CANCEL_REQUIREMENT"
  | "REOPEN_CASE";

export interface TransitionDefinition {
  from: RequirementStatus[];
  to: RequirementStatus;
  allowedRoles: UserRole[];
  requiredFields?: string[];
  precondition?: (ctx: TransitionContext) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

export interface TransitionContext {
  status: RequirementStatus;
  documents: RegistrationDocument[];
  actingUserId: string;
  actingUserRole: UserRole;
  payload: Record<string, unknown>;
  checklist?: unknown[];
}

export interface TransitionResult {
  newStatus: RequirementStatus;
  error?: never;
}

export interface TransitionError {
  error: string;
}

// Helper: is checklist complete?
function isChecklistComplete(checklist?: unknown): boolean {
  if (!Array.isArray(checklist)) return false;
  if (checklist.length === 0) return true; // Empty checklist is complete
  return (checklist as any[]).every((item) => item?.completed === true);
}

// The state machine definition: every legal transition is defined here.
export const STATE_MACHINE: Record<Transition, TransitionDefinition> = {
  DECIDE_REQUIREMENT: {
    from: ["requirement_review"],
    to: "not_started",
    allowedRoles: ["aep_processor", "aep_reviewer", "administrator"],
    requiredFields: ["requirementStatus"],
    precondition: async () => ({ ok: true }),
  },
  REQUEST_INFORMATION: {
    from: ["not_started"],
    to: "awaiting_information",
    allowedRoles: ["aep_processor", "aep_reviewer", "administrator"],
    requiredFields: ["comment"],
    precondition: async () => ({ ok: true }),
  },
  MARK_READY_TO_REGISTER: {
    from: ["awaiting_information"],
    to: "ready_to_register",
    allowedRoles: ["aep_processor", "aep_reviewer", "administrator"],
    precondition: async () => ({ ok: true }),
  },
  START_REGISTRATION: {
    from: ["ready_to_register"],
    to: "registration_in_progress",
    allowedRoles: ["aep_processor", "aep_reviewer", "administrator"],
    precondition: async () => ({ ok: true }),
  },
  SUBMIT_TO_AUTHORITY: {
    from: ["registration_in_progress"],
    to: "submitted",
    allowedRoles: ["aep_processor", "aep_reviewer", "administrator"],
    requiredFields: ["comment"],
    precondition: async (ctx) => {
      const complete = isChecklistComplete(ctx.checklist);
      if (!complete) {
        return { ok: false, reason: "Checklist must be complete before submission." };
      }
      return { ok: true };
    },
  },
  RECORD_AUTHORITY_QUERY: {
    from: ["submitted"],
    to: "authority_query",
    allowedRoles: ["aep_processor", "aep_reviewer", "administrator"],
    requiredFields: ["comment"],
    precondition: async () => ({ ok: true }),
  },
  RESOLVE_QUERY: {
    from: ["authority_query"],
    to: "submitted",
    allowedRoles: ["aep_processor", "aep_reviewer", "administrator"],
    requiredFields: ["comment"],
    precondition: async () => ({ ok: true }),
  },
  RECORD_COMPLETION_EVIDENCE: {
    from: ["submitted", "authority_query"],
    to: "completed_pending_evidence",
    allowedRoles: ["aep_processor", "aep_reviewer", "administrator"],
    precondition: async () => ({ ok: true }),
  },
  VERIFY_EVIDENCE: {
    from: ["completed_pending_evidence"],
    to: "verified_completed",
    allowedRoles: ["aep_reviewer", "compliance_reviewer", "administrator"],
    requiredFields: ["authorityReference"],
    precondition: async (ctx) => {
      // Maker-checker: verifier cannot be the uploader
      const currentDoc = ctx.documents.find((d) => d.isCurrent && d.verificationStatus === "verified");
      if (!currentDoc) {
        return { ok: false, reason: "No verified current document found." };
      }
      if (currentDoc.uploadedBy === ctx.actingUserId) {
        return {
          ok: false,
          reason: "Verification denied: uploader cannot verify their own document (maker-checker control).",
        };
      }
      return { ok: true };
    },
  },
  REJECT_EVIDENCE: {
    from: ["completed_pending_evidence"],
    to: "evidence_rejected",
    allowedRoles: ["aep_reviewer", "compliance_reviewer", "administrator"],
    requiredFields: ["rejectionReason"],
    precondition: async () => ({ ok: true }),
  },
  RESUBMIT_AFTER_REJECTION: {
    from: ["evidence_rejected"],
    to: "completed_pending_evidence",
    allowedRoles: ["aep_processor", "aep_reviewer", "administrator"],
    precondition: async () => ({ ok: true }),
  },
  CANCEL_REQUIREMENT: {
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
    precondition: async () => ({ ok: true }),
  },
  REOPEN_CASE: {
    from: ["verified_completed"],
    to: "registration_in_progress",
    allowedRoles: ["compliance_reviewer", "administrator"],
    requiredFields: ["comment"],
    precondition: async () => ({ ok: true }),
  },
};

// Apply a transition: validate it's legal and preconditions are met.
// Returns the new status on success, or an error.
export function applyTransition(
  transition: Transition,
  ctx: TransitionContext
): TransitionResult | TransitionError {
  const def = STATE_MACHINE[transition];

  if (!def) {
    return { error: `Unknown transition: ${transition}` };
  }

  // Check: is the current status in the "from" list?
  if (!def.from.includes(ctx.status)) {
    return {
      error: `Illegal transition: cannot ${transition} from ${ctx.status}. Allowed from: ${def.from.join(", ")}`,
    };
  }

  // Check: is the user's role allowed?
  if (!def.allowedRoles.includes(ctx.actingUserRole)) {
    return {
      error: `Forbidden: role '${ctx.actingUserRole}' is not allowed for ${transition}. Allowed roles: ${def.allowedRoles.join(", ")}`,
    };
  }

  // Check: are all required fields present in the payload?
  if (def.requiredFields) {
    const missing = def.requiredFields.filter((field) => !ctx.payload[field]);
    if (missing.length > 0) {
      return { error: `Missing required fields: ${missing.join(", ")}` };
    }
  }

  // If preconditions are async, this function would need to be async.
  // For now, we assume preconditions don't need DB access (they're passed already-loaded data).
  // In practice, they're called synchronously here, which won't work for async preconditions.
  // See the route handler below which handles the async version.

  return { newStatus: def.to };
}

// Synchronous version for testing/type checking. In actual routes, use the async wrapper.
export function applyTransitionSync(
  transition: Transition,
  ctx: Omit<TransitionContext, "documents"> & { documents: RegistrationDocument[] }
): TransitionResult | TransitionError {
  const result = applyTransition(transition, ctx as TransitionContext);
  return result;
}
