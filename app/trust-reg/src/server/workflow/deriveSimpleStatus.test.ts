import { describe, expect, it } from "vitest";
import { REQUIREMENT_STATUSES } from "@/server/domain/types";
import { simpleCaseStatus, simpleRequirementStatus, type SimpleStatusSnapshot } from "./deriveSimpleStatus";

const req = (over: Partial<SimpleStatusSnapshot> = {}): SimpleStatusSnapshot => ({
  requirementStatus: "required",
  status: "not_started",
  ...over,
});

describe("simpleRequirementStatus", () => {
  it("maps every requirement status to one of three states", () => {
    for (const s of REQUIREMENT_STATUSES) {
      expect(["not_started", "in_progress", "completed"]).toContain(simpleRequirementStatus(s));
    }
  });

  it("treats review and not_started as not started", () => {
    expect(simpleRequirementStatus("requirement_review")).toBe("not_started");
    expect(simpleRequirementStatus("not_started")).toBe("not_started");
  });

  it("treats terminal states as completed", () => {
    expect(simpleRequirementStatus("verified_completed")).toBe("completed");
    expect(simpleRequirementStatus("not_required")).toBe("completed");
    expect(simpleRequirementStatus("cancelled")).toBe("completed");
  });

  it("everything between is in progress, including rejected evidence and pending verification", () => {
    expect(simpleRequirementStatus("awaiting_information")).toBe("in_progress");
    expect(simpleRequirementStatus("submitted")).toBe("in_progress");
    expect(simpleRequirementStatus("completed_pending_evidence")).toBe("in_progress");
    expect(simpleRequirementStatus("evidence_rejected")).toBe("in_progress");
  });
});

describe("simpleCaseStatus", () => {
  it("is not started with nothing decided", () => {
    expect(simpleCaseStatus("requirement_review", [])).toBe("not_started");
    expect(simpleCaseStatus("requirement_review", [req({ requirementStatus: "under_review", status: "requirement_review" })])).toBe("not_started");
  });

  it("is not started while every required registration is still not started", () => {
    expect(simpleCaseStatus("registration_in_progress", [req(), req({ status: "requirement_review" })])).toBe("not_started");
  });

  it("is in progress once any required registration has moved", () => {
    expect(simpleCaseStatus("registration_in_progress", [req({ status: "submitted" }), req()])).toBe("in_progress");
    expect(simpleCaseStatus("blocked", [req({ status: "awaiting_information" })])).toBe("in_progress");
    expect(simpleCaseStatus("overdue", [req({ status: "registration_in_progress" })])).toBe("in_progress");
  });

  it("is completed when ready for provider, handed back or closed", () => {
    expect(simpleCaseStatus("ready_for_provider", [req({ status: "verified_completed" })])).toBe("completed");
    expect(simpleCaseStatus("handed_back_to_wm", [req({ status: "verified_completed" })])).toBe("completed");
    expect(simpleCaseStatus("closed", [req({ status: "verified_completed" })])).toBe("completed");
  });

  it("is not completed just because one of two required registrations is verified", () => {
    expect(simpleCaseStatus("registration_in_progress", [req({ status: "verified_completed" }), req({ status: "submitted" })])).toBe("in_progress");
  });
});
