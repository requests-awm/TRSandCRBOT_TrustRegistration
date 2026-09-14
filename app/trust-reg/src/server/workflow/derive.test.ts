import { describe, expect, it } from "vitest";
import { deriveOverallStatus, reconcileOverallStatus, type RequirementSnapshot } from "./deriveOverallStatus";
import { deriveActivationBlocked } from "./deriveActivationBlocked";

const NOW = new Date("2026-09-13T12:00:00Z");
const past = "2026-09-01";
const future = "2026-12-01";

const req = (over: Partial<RequirementSnapshot> = {}): RequirementSnapshot => ({
  requirementStatus: "required",
  status: "not_started",
  registrationDeadline: future,
  ...over,
});

describe("deriveOverallStatus", () => {
  it("is requirement_review with no requirements or nothing decided", () => {
    expect(deriveOverallStatus([], NOW)).toBe("requirement_review");
    expect(deriveOverallStatus([req({ requirementStatus: "under_review" }), req({ requirementStatus: "under_review" })], NOW)).toBe("requirement_review");
  });

  it("overdue beats everything else", () => {
    expect(deriveOverallStatus([req({ registrationDeadline: past, status: "awaiting_information" })], NOW)).toBe("overdue");
    expect(deriveOverallStatus([req({ registrationDeadline: past, status: "submitted" }), req({ status: "verified_completed" })], NOW)).toBe("overdue");
  });

  it("a passed deadline on a finished requirement is not overdue", () => {
    expect(deriveOverallStatus([req({ registrationDeadline: past, status: "verified_completed" })], NOW)).toBe("ready_for_provider");
    expect(deriveOverallStatus([req({ registrationDeadline: past, status: "cancelled" }), req({ status: "not_started" })], NOW)).toBe("registration_in_progress");
  });

  it("ignores deadlines on not_required requirements", () => {
    expect(deriveOverallStatus([req({ requirementStatus: "not_required", status: "not_required", registrationDeadline: past }), req({ status: "not_started" })], NOW)).toBe(
      "registration_in_progress"
    );
  });

  it("blocked when a required requirement awaits information or a decision", () => {
    expect(deriveOverallStatus([req({ status: "awaiting_information" }), req({ status: "submitted" })], NOW)).toBe("blocked");
    expect(deriveOverallStatus([req({ status: "requirement_review" })], NOW)).toBe("blocked");
  });

  it("ready_for_provider only when every required requirement is verified", () => {
    expect(deriveOverallStatus([req({ status: "verified_completed" }), req({ requirementStatus: "not_required", status: "not_required" })], NOW)).toBe("ready_for_provider");
    expect(deriveOverallStatus([req({ status: "verified_completed" }), req({ status: "submitted" })], NOW)).toBe("registration_in_progress");
  });

  it("stays in progress when decided requirements are all not_required", () => {
    expect(deriveOverallStatus([req({ requirementStatus: "not_required", status: "not_required" })], NOW)).toBe("registration_in_progress");
  });

  it("a mix of decided and under_review counts as decided", () => {
    expect(deriveOverallStatus([req({ requirementStatus: "under_review" }), req({ status: "not_started" })], NOW)).toBe("registration_in_progress");
  });
});

describe("reconcileOverallStatus", () => {
  it("keeps a manual hand-back or close while the gate is open", () => {
    expect(reconcileOverallStatus("handed_back_to_wm", "ready_for_provider", false)).toBe("handed_back_to_wm");
    expect(reconcileOverallStatus("closed", "ready_for_provider", false)).toBe("closed");
  });

  it("drops back to the derived status when a reopen blocks activation again", () => {
    expect(reconcileOverallStatus("handed_back_to_wm", "registration_in_progress", true)).toBe("registration_in_progress");
    expect(reconcileOverallStatus("closed", "overdue", true)).toBe("overdue");
  });

  it("never invents a manual status", () => {
    expect(reconcileOverallStatus("registration_in_progress", "ready_for_provider", false)).toBe("ready_for_provider");
    expect(reconcileOverallStatus("ready_for_provider", "blocked", true)).toBe("blocked");
  });
});

describe("deriveActivationBlocked", () => {
  it("blocked with nothing decided", () => {
    expect(deriveActivationBlocked([])).toBe(true);
    expect(deriveActivationBlocked([req({ requirementStatus: "under_review" })])).toBe(true);
  });

  it("blocked when only not_required decisions exist", () => {
    expect(deriveActivationBlocked([req({ requirementStatus: "not_required", status: "not_required" })])).toBe(true);
  });

  it("blocked while any required requirement is not verified", () => {
    expect(deriveActivationBlocked([req({ status: "verified_completed" }), req({ status: "completed_pending_evidence" })])).toBe(true);
    expect(deriveActivationBlocked([req({ status: "cancelled" })])).toBe(true);
  });

  it("released when every required requirement is verified", () => {
    expect(deriveActivationBlocked([req({ status: "verified_completed" })])).toBe(false);
    expect(deriveActivationBlocked([req({ status: "verified_completed" }), req({ requirementStatus: "not_required", status: "not_required" })])).toBe(false);
  });
});
