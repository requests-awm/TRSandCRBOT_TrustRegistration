import { describe, expect, it } from "vitest";
import { USER_ROLES, type DocumentRow, type UserRole } from "@/server/domain/types";
import type { AuthUser } from "@/server/auth/roles";
import { assertCanReadDocument } from "./documentService";

const user = (role: UserRole, wmTeam?: string): AuthUser => ({ id: "u", email: `${role}@x`, role, wmTeam, isActive: true });

const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  id: "d",
  registration_requirement_id: "r",
  document_type: "trs_proof_of_registration",
  file_name: "cert.pdf",
  storage_key: "k",
  mime_type: "application/pdf",
  file_size: 1,
  document_version: 1,
  uploaded_by: "p",
  uploaded_at: "2026-09-13T00:00:00Z",
  is_current: true,
  verification_status: "verified",
  verified_by: "v",
  verified_at: "2026-09-13T00:00:00Z",
  rejection_reason: null,
  malware_scan_status: "clean",
  file_hash: null,
  created_at: "2026-09-13T00:00:00Z",
  updated_at: "2026-09-13T00:00:00Z",
  ...over,
});

const teamA = { requesting_wm_team: "WM Team A" };

describe("assertCanReadDocument", () => {
  it("lets every AEP, compliance, admin and auditor role read anything", () => {
    for (const role of USER_ROLES.filter((r) => r !== "wm_requester")) {
      expect(() => assertCanReadDocument(user(role), doc({ verification_status: "pending" }), teamA)).not.toThrow();
      expect(() => assertCanReadDocument(user(role), doc({ verification_status: "rejected" }), teamA)).not.toThrow();
    }
  });

  it("lets a WM requester download a verified certificate on their own team's case", () => {
    expect(() => assertCanReadDocument(user("wm_requester", "WM Team A"), doc(), teamA)).not.toThrow();
  });

  it("blocks a WM requester from another team's case", () => {
    expect(() => assertCanReadDocument(user("wm_requester", "WM Team B"), doc(), teamA)).toThrow(/another WM team/);
  });

  it("blocks a WM requester from unverified or rejected evidence", () => {
    expect(() => assertCanReadDocument(user("wm_requester", "WM Team A"), doc({ verification_status: "pending" }), teamA)).toThrow(/verified certificates/);
    expect(() => assertCanReadDocument(user("wm_requester", "WM Team A"), doc({ verification_status: "rejected" }), teamA)).toThrow(/verified certificates/);
  });

  it("refusals are 403s", () => {
    try {
      assertCanReadDocument(user("wm_requester", "WM Team B"), doc(), teamA);
    } catch (err) {
      expect((err as { status?: number }).status).toBe(403);
    }
  });
});
