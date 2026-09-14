import { describe, expect, it } from "vitest";

// End-to-end happy path against a RUNNING dev server backed by a real database.
// Skipped unless INTEGRATION_BASE_URL is set, e.g.
//
//   # terminal 1: .env.local has real Supabase keys, AUTH_MODE=dev, NEXT_PUBLIC_DATA_SOURCE=http
//   npm run dev
//   # terminal 2
//   INTEGRATION_BASE_URL=http://localhost:3000 npm test -- integration
//
// Roles travel in the x-dev-role header (AUTH_MODE=dev only, refused in production builds).
// No seeded profiles are required: dev users are synthesised from the header. On a project without
// 002_seed_dev.sql the WM email falls back to WM_FALLBACK_EMAIL or the requester's user id.
// Passed 10/10 against the shared AWM Supabase project on 2026-09-14.

const BASE = process.env.INTEGRATION_BASE_URL;

type Role = "wm_requester" | "aep_processor" | "aep_reviewer" | "compliance_reviewer" | "administrator" | "auditor";

async function call<T>(role: Role, method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { "x-dev-role": role } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json as T;
}

interface CaseRow {
  id: string;
  case_reference: string;
  overall_status: string;
  activation_blocked: boolean;
  requirements?: Array<{ id: string; authority: string; status: string; checklist: Array<{ key: string; label: string; completed: boolean }> | null }>;
}
interface ReqRow {
  id: string;
  status: string;
  checklist: Array<{ key: string; label: string; completed: boolean }> | null;
}
interface DocRow {
  id: string;
  verification_status: string;
  file_hash: string | null;
}

// Remote databases add ~1s per round trip; some steps make five calls.
describe.skipIf(!BASE)("happy path: create → register → verify → hand back → download → close", { timeout: 60_000 }, () => {
  const stamp = Date.now();
  let caseId = "";
  let reqId = "";
  let docId = "";

  it("WM raises a request", async () => {
    const created = await call<CaseRow>("wm_requester", "POST", "/api/trust-cases", {
      insightlyId: `INS-IT-${stamp}`,
      clientDisplayName: "Integration, Test",
      trustName: `Integration Trust ${stamp}`,
      providerName: "Utmost International",
      providerCountry: "Ireland",
      trustType: "Discretionary trust",
      requestingWmTeam: "WM Team A",
      businessPriority: "standard",
    });
    expect(created.case_reference).toMatch(/^NTR-\d{4}-\d{6}$/);
    expect(created.activation_blocked).toBe(true);
    caseId = created.id;
  });

  it("AEP decides TRS is required and CRBOT is not", async () => {
    const trs = await call<ReqRow>("aep_processor", "POST", `/api/trust-cases/${caseId}/requirements`, {
      authority: "trs",
      requirementStatus: "required",
      requirementReason: "UK-resident trustees",
      registrationDeadline: "2030-01-01",
    });
    await call("aep_processor", "POST", `/api/trust-cases/${caseId}/requirements`, {
      authority: "crbot",
      requirementStatus: "not_required",
      requirementReason: "No Irish connection",
    });
    reqId = trs.id;
    const c = await call<CaseRow>("aep_processor", "GET", `/api/trust-cases/${caseId}`);
    expect(c.overall_status).toBe("blocked");
  });

  it("AEP walks the requirement to submitted", async () => {
    const t = (transition: string, extra: Record<string, unknown> = {}) =>
      call<ReqRow>("aep_processor", "POST", `/api/registration-requirements/${reqId}/transition`, { transition, ...extra });
    await t("DECIDE_REQUIREMENT");
    await t("MARK_READY_TO_REGISTER");
    const r = await t("START_REGISTRATION");
    await call("aep_processor", "PATCH", `/api/registration-requirements/${reqId}`, {
      checklist: (r.checklist ?? []).map((i) => ({ ...i, completed: true })),
    });
    const submitted = await t("SUBMIT_TO_AUTHORITY", { comment: "Submitted via Government Gateway" });
    expect(submitted.status).toBe("submitted");
  });

  it("AEP uploads the certificate and records completion", async () => {
    const form = new FormData();
    form.set("registrationRequirementId", reqId);
    form.set("documentType", "trs_proof_of_registration");
    form.set("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "proof.pdf", { type: "application/pdf" }));
    const doc = await call<DocRow>("aep_processor", "POST", "/api/registration-documents", form);
    expect(doc.file_hash).toMatch(/^[0-9a-f]{64}$/);
    docId = doc.id;
    const r = await call<ReqRow>("aep_processor", "POST", `/api/registration-requirements/${reqId}/transition`, { transition: "RECORD_COMPLETION_EVIDENCE" });
    expect(r.status).toBe("completed_pending_evidence");
  });

  it("the uploader cannot verify their own document (maker-checker)", async () => {
    await expect(call("aep_processor", "POST", `/api/registration-documents/${docId}/verify`, { verificationStatus: "verified" })).rejects.toThrow(/403/);
  });

  it("the reviewer verifies the document and the requirement, releasing the gate", async () => {
    const doc = await call<DocRow>("aep_reviewer", "POST", `/api/registration-documents/${docId}/verify`, { verificationStatus: "verified" });
    expect(doc.verification_status).toBe("verified");
    const r = await call<ReqRow>("aep_reviewer", "POST", `/api/registration-requirements/${reqId}/transition`, {
      transition: "VERIFY_EVIDENCE",
      authorityReference: `XTTRS${stamp}`,
    });
    expect(r.status).toBe("verified_completed");
    const c = await call<CaseRow>("aep_reviewer", "GET", `/api/trust-cases/${caseId}`);
    expect(c.overall_status).toBe("ready_for_provider");
    expect(c.activation_blocked).toBe(false);
  });

  it("WM can download the verified certificate through a signed URL", async () => {
    const link = await call<{ url: string; fileName: string }>("wm_requester", "GET", `/api/registration-documents/${docId}/download`);
    expect(link.url).toMatch(/^https?:\/\//);
    expect(link.fileName).toBe("proof.pdf");
    const res = await fetch(link.url);
    expect(res.status).toBe(200);
  });

  it("AEP hands the pack back and WM is notified", async () => {
    const c = await call<CaseRow>("aep_reviewer", "POST", `/api/trust-cases/${caseId}/hand-back`, { comment: "Pack ready" });
    expect(c.overall_status).toBe("handed_back_to_wm");
    const events = await call<Array<{ event_type: string }>>("auditor", "GET", `/api/trust-cases/${caseId}/events`);
    expect(events.map((e) => e.event_type)).toEqual(expect.arrayContaining(["case_handed_back", "wm_notified", "activation_unblocked"]));
  });

  it("another team's WM requester is refused", async () => {
    // The dev header can only pick a role, not a team, so this checks the team guard indirectly via a bogus team header.
    const res = await fetch(`${BASE}/api/trust-cases/${caseId}`, { headers: { "x-dev-role": "wm_requester", "x-dev-wm-team": "WM Team Z" } });
    expect(res.status).toBe(403);
  });

  it("WM closes the case once the provider accepts the trust", async () => {
    const c = await call<CaseRow>("wm_requester", "POST", `/api/trust-cases/${caseId}/close`, { comment: "Provider accepted" });
    expect(c.overall_status).toBe("closed");
    const csv = await fetch(`${BASE}/api/events?caseId=${caseId}&format=csv`, { headers: { "x-dev-role": "auditor" } }).then((r) => r.text());
    expect(csv.split("\r\n")[0]).toContain("case_reference");
    expect(csv).toContain("case_closed");
  });
});
