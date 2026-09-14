import { describe, expect, it } from "vitest";
import { REQUIREMENT_STATUSES, USER_ROLES, type RequirementStatus, type UserRole } from "@/server/domain/types";
import {
  STATE_MACHINE,
  TRANSITIONS,
  applyTransition,
  availableTransitions,
  type Transition,
  type TransitionContext,
  type TransitionDocument,
} from "./requirementStateMachine";

const PROCESSOR = "11111111-1111-4111-8111-111111111111";
const REVIEWER = "22222222-2222-4222-8222-222222222222";

const doc = (over: Partial<TransitionDocument> = {}): TransitionDocument => ({
  is_current: true,
  verification_status: "pending",
  uploaded_by: PROCESSOR,
  ...over,
});

const ctx = (over: Partial<TransitionContext> = {}): TransitionContext => ({
  status: "not_started",
  documents: [],
  actingUserId: PROCESSOR,
  actingUserRole: "aep_processor",
  payload: {},
  checklist: [],
  ...over,
});

const fullPayload = { comment: "ok", authorityReference: "XTTRS1", rejectionReason: "bad scan" };

describe("state machine definition", () => {
  it("defines exactly 13 transitions", () => {
    expect(TRANSITIONS).toHaveLength(13);
    expect(Object.keys(STATE_MACHINE).sort()).toEqual([...TRANSITIONS].sort());
  });

  it("only uses known statuses and roles", () => {
    for (const t of TRANSITIONS) {
      const def = STATE_MACHINE[t];
      for (const s of [...def.from, def.to]) expect(REQUIREMENT_STATUSES).toContain(s);
      for (const r of def.allowedRoles) expect(USER_ROLES).toContain(r);
    }
  });

  it("never transitions out of terminal states except REOPEN_CASE from verified_completed", () => {
    for (const t of TRANSITIONS) {
      const def = STATE_MACHINE[t];
      expect(def.from).not.toContain("cancelled");
      expect(def.from).not.toContain("not_required");
      if (def.from.includes("verified_completed")) expect(t).toBe("REOPEN_CASE");
    }
  });
});

describe("applyTransition: every legal transition succeeds with the right role and payload", () => {
  for (const t of TRANSITIONS) {
    const def = STATE_MACHINE[t];
    for (const from of def.from) {
      it(`${t} from ${from} as ${def.allowedRoles[0]}`, () => {
        const role = def.allowedRoles[0];
        const actor = role === "aep_processor" ? PROCESSOR : REVIEWER;
        const result = applyTransition(t, {
          ...ctx({ status: from, actingUserRole: role, actingUserId: actor, payload: fullPayload }),
          documents: [doc({ verification_status: "verified", uploaded_by: PROCESSOR })],
        });
        expect(result).toEqual({ ok: true, newStatus: def.to, eventType: def.eventType });
      });
    }
  }
});

describe("applyTransition: illegal transitions are rejected", () => {
  for (const t of TRANSITIONS) {
    const def = STATE_MACHINE[t];
    const illegalFrom = REQUIREMENT_STATUSES.filter((s) => !def.from.includes(s));
    for (const from of illegalFrom) {
      it(`${t} is illegal from ${from}`, () => {
        const result = applyTransition(t, ctx({ status: from, actingUserRole: "administrator", actingUserId: REVIEWER, payload: fullPayload, documents: [doc({ verification_status: "verified" })] }));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/Illegal transition/);
      });
    }
  }

  it("rejects roles that are not allowed", () => {
    const result = applyTransition("SUBMIT_TO_AUTHORITY", ctx({ status: "registration_in_progress", actingUserRole: "wm_requester", payload: fullPayload }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Forbidden/);
  });

  it("only administrators can cancel", () => {
    for (const role of USER_ROLES.filter((r) => r !== "administrator") as UserRole[]) {
      const result = applyTransition("CANCEL_REQUIREMENT", ctx({ status: "not_started", actingUserRole: role, payload: fullPayload }));
      expect(result.ok).toBe(false);
    }
  });
});

describe("required fields", () => {
  it("REQUEST_INFORMATION needs a comment", () => {
    const missing = applyTransition("REQUEST_INFORMATION", ctx({ status: "not_started" }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/comment/);
    expect(applyTransition("REQUEST_INFORMATION", ctx({ status: "not_started", payload: { comment: "need DOB" } })).ok).toBe(true);
  });

  it("treats whitespace-only values as missing", () => {
    const result = applyTransition("REQUEST_INFORMATION", ctx({ status: "not_started", payload: { comment: "   " } }));
    expect(result.ok).toBe(false);
  });

  it("REJECT_EVIDENCE needs a rejectionReason", () => {
    const result = applyTransition("REJECT_EVIDENCE", ctx({ status: "completed_pending_evidence", actingUserRole: "aep_reviewer", actingUserId: REVIEWER }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/rejectionReason/);
  });
});

describe("preconditions", () => {
  it("SUBMIT_TO_AUTHORITY requires a complete checklist", () => {
    const base = ctx({ status: "registration_in_progress", payload: { comment: "submitting" } });
    const incomplete = applyTransition("SUBMIT_TO_AUTHORITY", { ...base, checklist: [{ key: "a", label: "A", completed: false }] });
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) expect(incomplete.error).toMatch(/Checklist/);

    expect(applyTransition("SUBMIT_TO_AUTHORITY", { ...base, checklist: [{ key: "a", label: "A", completed: true }] }).ok).toBe(true);
    expect(applyTransition("SUBMIT_TO_AUTHORITY", { ...base, checklist: [] }).ok).toBe(true);
    expect(applyTransition("SUBMIT_TO_AUTHORITY", { ...base, checklist: null }).ok).toBe(true);
  });

  it("RECORD_COMPLETION_EVIDENCE requires a current document", () => {
    expect(applyTransition("RECORD_COMPLETION_EVIDENCE", ctx({ status: "submitted" })).ok).toBe(false);
    expect(applyTransition("RECORD_COMPLETION_EVIDENCE", ctx({ status: "submitted", documents: [doc()] })).ok).toBe(true);
  });

  it("VERIFY_EVIDENCE requires a verified current document", () => {
    const base = ctx({ status: "completed_pending_evidence", actingUserRole: "aep_reviewer", actingUserId: REVIEWER, payload: { authorityReference: "X" } });
    expect(applyTransition("VERIFY_EVIDENCE", { ...base, documents: [] }).ok).toBe(false);
    expect(applyTransition("VERIFY_EVIDENCE", { ...base, documents: [doc({ verification_status: "pending" })] }).ok).toBe(false);
    expect(applyTransition("VERIFY_EVIDENCE", { ...base, documents: [doc({ verification_status: "verified", is_current: false })] }).ok).toBe(false);
    expect(applyTransition("VERIFY_EVIDENCE", { ...base, documents: [doc({ verification_status: "verified" })] }).ok).toBe(true);
  });

  it("VERIFY_EVIDENCE enforces maker-checker: uploader cannot close the requirement", () => {
    const result = applyTransition(
      "VERIFY_EVIDENCE",
      ctx({
        status: "completed_pending_evidence",
        actingUserRole: "aep_reviewer",
        actingUserId: PROCESSOR,
        payload: { authorityReference: "X" },
        documents: [doc({ verification_status: "verified", uploaded_by: PROCESSOR })],
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/maker-checker/);
  });

  it("RESUBMIT_AFTER_REJECTION needs a replacement document that is not rejected", () => {
    const base = ctx({ status: "evidence_rejected" });
    expect(applyTransition("RESUBMIT_AFTER_REJECTION", { ...base, documents: [doc({ verification_status: "rejected" })] }).ok).toBe(false);
    expect(applyTransition("RESUBMIT_AFTER_REJECTION", { ...base, documents: [doc({ verification_status: "rejected", is_current: false }), doc()] }).ok).toBe(true);
  });
});

describe("availableTransitions", () => {
  it("lists only legal transitions for the role", () => {
    expect(availableTransitions("not_started", "aep_processor").sort()).toEqual(["MARK_READY_TO_REGISTER", "REQUEST_INFORMATION"].sort());
    expect(availableTransitions("not_started", "administrator")).toContain("CANCEL_REQUIREMENT");
    expect(availableTransitions("completed_pending_evidence", "aep_processor")).toEqual([]);
    expect(availableTransitions("completed_pending_evidence", "compliance_reviewer").sort()).toEqual(["REJECT_EVIDENCE", "VERIFY_EVIDENCE"].sort());
    expect(availableTransitions("verified_completed", "aep_processor")).toEqual([]);
    expect(availableTransitions("cancelled", "administrator")).toEqual([]);
  });

  it("every non-terminal status has at least one exit for an administrator", () => {
    const terminal: RequirementStatus[] = ["not_required", "cancelled"];
    for (const s of REQUIREMENT_STATUSES.filter((x) => !terminal.includes(x))) {
      expect(availableTransitions(s, "administrator").length, s).toBeGreaterThan(0);
    }
  });
});

describe("happy path", () => {
  it("walks a requirement from review to verified", () => {
    const steps: Array<[Transition, UserRole, string, Partial<TransitionContext>]> = [
      ["DECIDE_REQUIREMENT", "aep_processor", PROCESSOR, {}],
      ["REQUEST_INFORMATION", "aep_processor", PROCESSOR, { payload: { comment: "need info" } }],
      ["MARK_READY_TO_REGISTER", "aep_processor", PROCESSOR, {}],
      ["START_REGISTRATION", "aep_processor", PROCESSOR, {}],
      ["SUBMIT_TO_AUTHORITY", "aep_processor", PROCESSOR, { payload: { comment: "sent" }, checklist: [] }],
      ["RECORD_AUTHORITY_QUERY", "aep_processor", PROCESSOR, { payload: { comment: "HMRC asked" } }],
      ["RESOLVE_QUERY", "aep_processor", PROCESSOR, { payload: { comment: "answered" } }],
      ["RECORD_COMPLETION_EVIDENCE", "aep_processor", PROCESSOR, { documents: [doc()] }],
      ["VERIFY_EVIDENCE", "aep_reviewer", REVIEWER, { payload: { authorityReference: "XTTRS0001" }, documents: [doc({ verification_status: "verified" })] }],
    ];
    let status: RequirementStatus = "requirement_review";
    for (const [t, role, actor, over] of steps) {
      const result = applyTransition(t, ctx({ status, actingUserRole: role, actingUserId: actor, ...over }));
      expect(result.ok, `${t} from ${status}`).toBe(true);
      if (result.ok) status = result.newStatus;
    }
    expect(status).toBe("verified_completed");
  });
});
