import type {
  Authority,
  ChecklistItem,
  DocumentRow,
  EventRow,
  EventType,
  RequirementRow,
  RequirementStatus,
  TrustCaseRow,
  TrustCaseWithRequirements,
  UserRole,
} from "@/server/domain/types";
import { applyTransition } from "@/server/workflow/requirementStateMachine";
import { deriveOverallStatus, reconcileOverallStatus } from "@/server/workflow/deriveOverallStatus";
import { deriveActivationBlocked } from "@/server/workflow/deriveActivationBlocked";
import type { AuditEventRow } from "@/server/services/eventService";
import { ApiError, type SessionUser, type TrustRegApi } from "./client";
import { DEV_USER_IDS, readDevRole } from "@/lib/session/devRole";
import { ROLE_LABEL } from "@/lib/labels";

// PLACEHOLDER DATA LAYER.
// Runs the whole workflow in the browser with seeded data persisted to localStorage, so the UI
// can be exercised end to end before the database and API exist. Business rules come from the
// same pure modules the server uses, so behaviour matches what the real API will do.

const STORAGE_KEY = "trust_reg.mock.v2";
const FILES_KEY = "trust_reg.mock.files.v1";
const MAX_MOCK_FILE_BYTES = 4 * 1024 * 1024;

interface MockDb {
  cases: TrustCaseRow[];
  requirements: RequirementRow[];
  documents: DocumentRow[];
  events: EventRow[];
  counter: number;
}

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

const nowIso = () => new Date().toISOString();
const daysFromNow = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};
const daysAgoIso = (days: number, hours = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours);
  return d.toISOString();
};

const CHECKLISTS: Record<Authority, ChecklistItem[]> = {
  trs: [
    { key: "lead_trustee_details", label: "Lead trustee details confirmed", completed: false },
    { key: "settlor_details", label: "Settlor details confirmed", completed: false },
    { key: "beneficiary_details", label: "Beneficiary details confirmed", completed: false },
    { key: "gateway_access", label: "HMRC Government Gateway access ready", completed: false },
  ],
  crbot: [
    { key: "trustee_details", label: "Trustee details confirmed", completed: false },
    { key: "beneficial_owners", label: "Beneficial owners identified", completed: false },
    { key: "ros_access", label: "Revenue Online Service access ready", completed: false },
  ],
};

const U = DEV_USER_IDS;

function currentUser(): SessionUser {
  const role = readDevRole();
  return {
    id: U[role],
    email: `${role}@dev.local`,
    role,
    fullName: `Dev ${ROLE_LABEL[role]}`,
    wmTeam: role === "wm_requester" ? "WM Team A" : undefined,
    isActive: true,
  };
}

function seed(): MockDb {
  const db: MockDb = { cases: [], requirements: [], documents: [], events: [], counter: 1 };
  const year = new Date().getFullYear();

  const mkCase = (
    partial: Partial<TrustCaseRow> & Pick<TrustCaseRow, "trust_name" | "client_display_name" | "provider_name" | "provider_country">,
    createdDaysAgo: number
  ): TrustCaseRow => {
    const row: TrustCaseRow = {
      id: uuid(),
      case_reference: `NTR-${year}-${String(db.counter++).padStart(6, "0")}`,
      insightly_id: `INS-${100000 + db.counter}`,
      trust_type: "Discretionary trust",
      trust_creation_date: daysFromNow(-400),
      requesting_wm_user_id: U.wm_requester,
      requesting_wm_team: "WM Team A",
      assigned_aep_user_id: U.aep_processor,
      business_priority: "standard",
      overall_status: "requirement_review",
      activation_blocked: true,
      target_provider_submission_date: daysFromNow(30),
      created_at: daysAgoIso(createdDaysAgo),
      updated_at: daysAgoIso(createdDaysAgo),
      closed_at: null,
      is_deleted: false,
      deleted_at: null,
      deletion_reason: null,
      ...partial,
    };
    db.cases.push(row);
    db.events.push(
      mkEvent(row.id, null, "case_created", U.wm_requester, `Case created by wm_requester@dev.local`, null, null, row.created_at)
    );
    return row;
  };

  const mkReq = (
    c: TrustCaseRow,
    authority: Authority,
    decision: RequirementRow["requirement_status"],
    status: RequirementStatus,
    extra: Partial<RequirementRow> = {}
  ): RequirementRow => {
    const checklist = CHECKLISTS[authority].map((i) => ({ ...i, completed: status !== "not_started" && status !== "requirement_review" }));
    const row: RequirementRow = {
      id: uuid(),
      trust_case_id: c.id,
      authority,
      requirement_status: decision,
      requirement_reason:
        decision === "required"
          ? authority === "trs"
            ? "UK-resident trustees and UK tax liability"
            : "Irish-resident trustee and Irish provider"
          : decision === "not_required"
            ? "No Irish connection"
            : null,
      requirement_decided_by: decision === "under_review" ? null : U.aep_processor,
      requirement_decided_at: decision === "under_review" ? null : daysAgoIso(10),
      compliance_rule_id: null,
      registration_deadline: decision === "required" ? daysFromNow(60) : null,
      internal_target_date: decision === "required" ? daysFromNow(45) : null,
      status,
      assigned_to: U.aep_processor,
      submitted_at: null,
      completed_at: null,
      verified_at: null,
      verified_by: null,
      authority_reference: null,
      completion_notes: null,
      checklist,
      created_at: c.created_at,
      updated_at: nowIso(),
      ...extra,
    };
    db.requirements.push(row);
    if (decision !== "under_review") {
      db.events.push(
        mkEvent(
          c.id,
          row.id,
          "requirement_added",
          U.aep_processor,
          `${authority.toUpperCase()} requirement added: ${decision}. Reason: ${row.requirement_reason}`,
          null,
          null,
          daysAgoIso(10)
        )
      );
    }
    return row;
  };

  const mkDoc = (
    r: RequirementRow,
    type: DocumentRow["document_type"],
    verification: DocumentRow["verification_status"],
    uploadedBy: string,
    version = 1
  ) => {
    const row: DocumentRow = {
      id: uuid(),
      registration_requirement_id: r.id,
      document_type: type,
      file_name: `${type}_v${version}.pdf`,
      storage_key: `trust-reg/${r.trust_case_id}/${r.id}/${type}_v${version}.pdf`,
      mime_type: "application/pdf",
      file_size: 184_320 + version * 1024,
      document_version: version,
      uploaded_by: uploadedBy,
      uploaded_at: daysAgoIso(3),
      is_current: true,
      verification_status: verification,
      verified_by: verification === "pending" ? null : U.aep_reviewer,
      verified_at: verification === "pending" ? null : daysAgoIso(1),
      rejection_reason: verification === "rejected" ? "Document is illegible; please re-scan at higher resolution." : null,
      malware_scan_status: "clean",
      file_hash: null,
      created_at: daysAgoIso(3),
      updated_at: nowIso(),
    };
    db.documents.push(row);
    db.events.push(
      mkEvent(r.trust_case_id, r.id, "document_uploaded", uploadedBy, `${type} uploaded (v${version})`, null, null, row.uploaded_at)
    );
    return row;
  };

  // 1. Brand new request, nothing decided
  mkCase(
    {
      trust_name: "Hartley Family Settlement",
      client_display_name: "Hartley, Margaret",
      provider_name: "Canada Life International",
      provider_country: "Isle of Man",
      business_priority: "urgent",
      assigned_aep_user_id: null,
    },
    1
  );

  // 2. TRS required, awaiting information -> blocked
  const c2 = mkCase(
    {
      trust_name: "Okafor Discretionary Trust",
      client_display_name: "Okafor, Daniel",
      provider_name: "Utmost International",
      provider_country: "Ireland",
      trust_type: "Discretionary trust",
    },
    12
  );
  const c2trs = mkReq(c2, "trs", "required", "awaiting_information");
  mkReq(c2, "crbot", "required", "not_started");
  db.events.push(
    mkEvent(c2.id, c2trs.id, "information_requested", U.aep_processor, "Need settlor date of birth and NI number.", "not_started", "awaiting_information", daysAgoIso(4))
  );

  // 3. In progress: TRS submitted, CRBOT not required
  const c3 = mkCase(
    {
      trust_name: "Bramwell Life Interest Trust",
      client_display_name: "Bramwell, Susan",
      provider_name: "Quilter International",
      provider_country: "Isle of Man",
      trust_type: "Interest in possession trust",
    },
    25
  );
  const c3trs = mkReq(c3, "trs", "required", "submitted", { submitted_at: daysAgoIso(5) });
  mkReq(c3, "crbot", "not_required", "not_required");
  db.events.push(mkEvent(c3.id, c3trs.id, "submitted_to_authority", U.aep_processor, "Submitted via Government Gateway.", "registration_in_progress", "submitted", daysAgoIso(5)));

  // 4. Evidence uploaded, waiting for verification (maker-checker demo)
  const c4 = mkCase(
    {
      trust_name: "Nkosi Pension Bypass Trust",
      client_display_name: "Nkosi, Thandiwe",
      provider_name: "Standard Life International",
      provider_country: "Ireland",
      trust_type: "Pilot trust",
      business_priority: "critical",
    },
    40
  );
  const c4trs = mkReq(c4, "trs", "required", "completed_pending_evidence", { submitted_at: daysAgoIso(20), completed_at: daysAgoIso(3) });
  const c4crbot = mkReq(c4, "crbot", "required", "registration_in_progress");
  mkDoc(c4trs, "trs_proof_of_registration", "pending", U.aep_processor);
  void c4crbot;

  // 5. Overdue: deadline passed, still in progress
  const c5 = mkCase(
    {
      trust_name: "Fitzgerald Charitable Trust",
      client_display_name: "Fitzgerald, Aoife",
      provider_name: "Zurich International Life",
      provider_country: "Ireland",
      trust_type: "Charitable trust",
    },
    95
  );
  mkReq(c5, "crbot", "required", "registration_in_progress", { registration_deadline: daysFromNow(-7), internal_target_date: daysFromNow(-20) });
  mkReq(c5, "trs", "not_required", "not_required");

  // 6. Fully verified: ready for provider
  const c6 = mkCase(
    {
      trust_name: "Whitcombe Loan Trust",
      client_display_name: "Whitcombe, Peter",
      provider_name: "Prudential International",
      provider_country: "Ireland",
      trust_type: "Loan trust",
    },
    120
  );
  const c6trs = mkReq(c6, "trs", "required", "verified_completed", {
    submitted_at: daysAgoIso(60),
    completed_at: daysAgoIso(30),
    verified_at: daysAgoIso(28),
    verified_by: U.aep_reviewer,
    authority_reference: "XTTRS00012345678",
  });
  mkReq(c6, "crbot", "not_required", "not_required");
  mkDoc(c6trs, "trs_proof_of_registration", "verified", U.aep_processor);
  db.events.push(mkEvent(c6.id, c6trs.id, "evidence_verified", U.aep_reviewer, "Proof of registration checked against HMRC record.", "completed_pending_evidence", "verified_completed", daysAgoIso(28)));
  db.events.push(mkEvent(c6.id, null, "activation_unblocked", U.aep_reviewer, "Activation gate released: all required registrations verified", null, null, daysAgoIso(28)));
  db.events.push(mkEvent(c6.id, null, "wm_notified", U.aep_reviewer, "WM team notified: trust ready for provider submission", null, null, daysAgoIso(28)));

  // 7. Evidence rejected
  const c7 = mkCase(
    {
      trust_name: "Adeyemi Gift Trust",
      client_display_name: "Adeyemi, Bolanle",
      provider_name: "RL360",
      provider_country: "Isle of Man",
      trust_type: "Gift trust",
    },
    55
  );
  const c7trs = mkReq(c7, "trs", "required", "evidence_rejected", { submitted_at: daysAgoIso(30), completed_at: daysAgoIso(6) });
  mkDoc(c7trs, "trs_urn_confirmation", "rejected", U.aep_processor);
  db.events.push(mkEvent(c7.id, c7trs.id, "evidence_rejected", U.aep_reviewer, "Document is illegible; please re-scan at higher resolution.", "completed_pending_evidence", "evidence_rejected", daysAgoIso(1)));

  for (const c of db.cases) recompute(db, c.id, U.administrator, true);
  return db;
}

function mkEvent(
  caseId: string,
  reqId: string | null,
  type: EventType,
  by: string,
  comment: string | null,
  prev: string | null,
  next: string | null,
  at: string = nowIso(),
  metadata: Record<string, unknown> | null = null
): EventRow {
  return {
    id: uuid(),
    trust_case_id: caseId,
    registration_requirement_id: reqId,
    event_type: type,
    previous_status: prev,
    new_status: next,
    comment,
    metadata_json: metadata,
    performed_by: by,
    performed_at: at,
    created_at: at,
    updated_at: at,
  };
}

function load(): MockDb {
  if (typeof window === "undefined") return seed();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MockDb;
  } catch {
    // fall through to reseed
  }
  const db = seed();
  save(db);
  return db;
}

function save(db: MockDb) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // storage unavailable; state stays in memory for this page load
  }
}

let memo: MockDb | null = null;
const db = () => (memo ??= load());
const commit = () => save(db());

// Uploaded file bytes, as data URLs, kept apart from the metadata so the main record stays small.
function readFiles(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(FILES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeFile(id: string, dataUrl: string) {
  try {
    const files = readFiles();
    files[id] = dataUrl;
    window.localStorage.setItem(FILES_KEY, JSON.stringify(files));
  } catch {
    // storage full or unavailable; download will report the file as unavailable
  }
}

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });

async function sha256Hex(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export function resetMockData() {
  memo = seed();
  commit();
  try {
    window.localStorage.removeItem(FILES_KEY);
  } catch {
    // ignore
  }
}

function recompute(d: MockDb, caseId: string, actorId: string, silent = false) {
  const c = d.cases.find((x) => x.id === caseId);
  if (!c) return;
  const reqs = d.requirements.filter((r) => r.trust_case_id === caseId);
  const snap = reqs.map((r) => ({ requirementStatus: r.requirement_status, status: r.status, registrationDeadline: r.registration_deadline }));
  const blocked = deriveActivationBlocked(snap);
  const overall = reconcileOverallStatus(c.overall_status, deriveOverallStatus(snap), blocked);
  const statusChanged = c.overall_status !== overall;
  const blockChanged = c.activation_blocked !== blocked;
  if (!statusChanged && !blockChanged) return;
  const prev = c.overall_status;
  c.overall_status = overall;
  c.activation_blocked = blocked;
  c.updated_at = nowIso();
  if (silent) return;
  if (statusChanged) d.events.push(mkEvent(caseId, null, "status_changed", actorId, "Case status recomputed from requirements", prev, overall));
  if (blockChanged && !blocked) {
    d.events.push(mkEvent(caseId, null, "activation_unblocked", actorId, "Activation gate released: all required registrations verified", null, null));
    d.events.push(mkEvent(caseId, null, "wm_notified", actorId, "WM team notified: trust ready for provider submission", null, null, nowIso(), { recipient: "wm_requester@dev.local" }));
  }
}

const withReqs = (d: MockDb, c: TrustCaseRow): TrustCaseWithRequirements => ({
  ...c,
  requirements: d.requirements.filter((r) => r.trust_case_id === c.id),
});

function requireRole(user: SessionUser, roles: UserRole[]) {
  if (!roles.includes(user.role)) throw new ApiError(403, `Forbidden: role ${user.role} is not allowed for this action`);
}

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export const mockClient: TrustRegApi = {
  mode: "mock",

  async me() {
    await delay(20);
    return currentUser();
  },

  async listCases(filter = {}) {
    await delay();
    const user = currentUser();
    const d = db();
    let rows = d.cases.filter((c) => !c.is_deleted);
    if (user.role === "wm_requester") rows = rows.filter((c) => c.requesting_wm_team === user.wmTeam);
    if (filter.status) rows = rows.filter((c) => c.overall_status === filter.status);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      rows = rows.filter((c) => [c.trust_name, c.client_display_name, c.case_reference].some((v) => v.toLowerCase().includes(q)));
    }
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).map((c) => withReqs(d, c));
  },

  async getCase(id) {
    await delay();
    const d = db();
    const c = d.cases.find((x) => x.id === id && !x.is_deleted);
    if (!c) throw new ApiError(404, `Trust case ${id} not found`);
    const user = currentUser();
    if (user.role === "wm_requester" && c.requesting_wm_team !== user.wmTeam) throw new ApiError(403, "This case belongs to another WM team");
    return withReqs(d, c);
  },

  async createCase(input) {
    await delay();
    const user = currentUser();
    requireRole(user, ["wm_requester", "administrator"]);
    const d = db();
    const year = new Date().getFullYear();
    const row: TrustCaseRow = {
      id: uuid(),
      case_reference: `NTR-${year}-${String(d.counter++).padStart(6, "0")}`,
      insightly_id: input.insightlyId,
      client_display_name: input.clientDisplayName,
      trust_name: input.trustName,
      provider_name: input.providerName,
      provider_country: input.providerCountry,
      trust_type: input.trustType,
      trust_creation_date: input.trustCreationDate ?? null,
      requesting_wm_user_id: user.id,
      requesting_wm_team: input.requestingWmTeam,
      assigned_aep_user_id: null,
      business_priority: input.businessPriority,
      overall_status: "requirement_review",
      activation_blocked: true,
      target_provider_submission_date: input.targetProviderSubmissionDate ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
      closed_at: null,
      is_deleted: false,
      deleted_at: null,
      deletion_reason: null,
    };
    d.cases.push(row);
    d.events.push(mkEvent(row.id, null, "case_created", user.id, `Case created by ${user.email}`, null, null, nowIso(), { caseReference: row.case_reference }));
    commit();
    return row;
  },

  async handBackToWm(caseId, input = {}) {
    await delay();
    const user = currentUser();
    requireRole(user, ["aep_processor", "aep_reviewer", "administrator"]);
    const d = db();
    const c = d.cases.find((x) => x.id === caseId && !x.is_deleted);
    if (!c) throw new ApiError(404, "Trust case not found");
    if (c.activation_blocked || c.overall_status !== "ready_for_provider") {
      throw new ApiError(409, `Case cannot be handed back while its status is ${c.overall_status}. Every required registration must be verified first.`);
    }
    const reqIds = d.requirements.filter((r) => r.trust_case_id === caseId).map((r) => r.id);
    const certs = d.documents.filter((x) => reqIds.includes(x.registration_requirement_id) && x.is_current && x.verification_status === "verified");
    if (certs.length === 0) throw new ApiError(409, "No verified certificate is attached to this case. Upload and verify the registration evidence before handing back.");
    const prev = c.overall_status;
    c.overall_status = "handed_back_to_wm";
    c.updated_at = nowIso();
    d.events.push(
      mkEvent(caseId, null, "case_handed_back", user.id, input.comment || "Registration pack handed back to WM", prev, "handed_back_to_wm", nowIso(), {
        certificates: certs.map((x) => ({ id: x.id, fileName: x.file_name, documentType: x.document_type })),
      })
    );
    d.events.push(mkEvent(caseId, null, "wm_notified", user.id, "WM team notified: registration pack handed back", null, null, nowIso(), { recipient: "wm_requester@dev.local", notificationType: "handed_back_to_wm" }));
    commit();
    return c;
  },

  async closeCase(caseId, input = {}) {
    await delay();
    const user = currentUser();
    requireRole(user, ["wm_requester", "aep_reviewer", "administrator"]);
    const d = db();
    const c = d.cases.find((x) => x.id === caseId && !x.is_deleted);
    if (!c) throw new ApiError(404, "Trust case not found");
    if (user.role === "wm_requester" && c.requesting_wm_team !== user.wmTeam) throw new ApiError(403, "This case belongs to another WM team");
    if (!["ready_for_provider", "handed_back_to_wm"].includes(c.overall_status)) {
      throw new ApiError(409, `Case cannot be closed while its status is ${c.overall_status}.`);
    }
    const prev = c.overall_status;
    c.overall_status = "closed";
    c.closed_at = nowIso();
    c.updated_at = nowIso();
    d.events.push(mkEvent(caseId, null, "case_closed", user.id, input.comment || "Provider accepted the trust; case closed", prev, "closed"));
    commit();
    return c;
  },

  async setRequirementDecision(caseId, input) {
    await delay();
    const user = currentUser();
    requireRole(user, ["aep_processor", "aep_reviewer", "administrator"]);
    const d = db();
    if (!d.cases.some((c) => c.id === caseId)) throw new ApiError(404, "Trust case not found");
    const status: RequirementStatus = input.requirementStatus === "not_required" ? "not_required" : "requirement_review";
    let req = d.requirements.find((r) => r.trust_case_id === caseId && r.authority === input.authority);
    const decision = {
      requirement_status: input.requirementStatus,
      requirement_reason: input.requirementReason,
      requirement_decided_by: user.id,
      requirement_decided_at: nowIso(),
      registration_deadline: input.registrationDeadline ?? null,
      internal_target_date: input.internalTargetDate ?? null,
      status,
      updated_at: nowIso(),
    };
    if (req) {
      Object.assign(req, decision);
    } else {
      req = {
        id: uuid(),
        trust_case_id: caseId,
        authority: input.authority,
        compliance_rule_id: null,
        assigned_to: null,
        submitted_at: null,
        completed_at: null,
        verified_at: null,
        verified_by: null,
        authority_reference: null,
        completion_notes: null,
        checklist: CHECKLISTS[input.authority].map((i) => ({ ...i })),
        created_at: nowIso(),
        ...decision,
      };
      d.requirements.push(req);
    }
    d.events.push(
      mkEvent(caseId, req.id, "requirement_added", user.id, `${input.authority.toUpperCase()} requirement ${input.requirementStatus}. Reason: ${input.requirementReason}`, null, null)
    );
    recompute(d, caseId, user.id);
    commit();
    return req;
  },

  async patchRequirement(id, input) {
    await delay();
    const user = currentUser();
    requireRole(user, ["aep_processor", "aep_reviewer", "administrator"]);
    const d = db();
    const req = d.requirements.find((r) => r.id === id);
    if (!req) throw new ApiError(404, "Requirement not found");
    if (input.assignedTo !== undefined && input.assignedTo !== req.assigned_to) {
      req.assigned_to = input.assignedTo;
      d.events.push(mkEvent(req.trust_case_id, id, "owner_assigned", user.id, `Owner assigned by ${user.email}`, null, null));
    }
    if (input.registrationDeadline !== undefined) req.registration_deadline = input.registrationDeadline;
    if (input.internalTargetDate !== undefined) req.internal_target_date = input.internalTargetDate;
    if (input.checklist !== undefined) req.checklist = input.checklist;
    if (input.authorityReference !== undefined) req.authority_reference = input.authorityReference;
    if (input.completionNotes !== undefined) req.completion_notes = input.completionNotes;
    req.updated_at = nowIso();
    recompute(d, req.trust_case_id, user.id);
    commit();
    return req;
  },

  async transition(id, input) {
    await delay();
    const user = currentUser();
    const d = db();
    const req = d.requirements.find((r) => r.id === id);
    if (!req) throw new ApiError(404, "Requirement not found");
    const docs = d.documents.filter((x) => x.registration_requirement_id === id);
    const { transition, ...payload } = input;
    const result = applyTransition(transition, {
      status: req.status,
      documents: docs,
      actingUserId: user.id,
      actingUserRole: user.role,
      payload,
      checklist: req.checklist,
    });
    if (!result.ok) throw new ApiError(409, result.error);
    const prev = req.status;
    req.status = result.newStatus;
    req.updated_at = nowIso();
    if (transition === "SUBMIT_TO_AUTHORITY") req.submitted_at = nowIso();
    if (result.newStatus === "completed_pending_evidence") req.completed_at = nowIso();
    if (result.newStatus === "verified_completed") {
      req.verified_at = nowIso();
      req.verified_by = user.id;
      req.authority_reference = payload.authorityReference ?? req.authority_reference;
    }
    if (payload.completionNotes) req.completion_notes = payload.completionNotes;
    d.events.push(
      mkEvent(req.trust_case_id, id, result.eventType, user.id, payload.comment ?? payload.rejectionReason ?? null, prev, result.newStatus, nowIso(), { transition, ...payload })
    );
    recompute(d, req.trust_case_id, user.id);
    commit();
    return req;
  },

  async listDocuments(requirementId) {
    await delay();
    return db()
      .documents.filter((x) => x.registration_requirement_id === requirementId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  async uploadDocument(input) {
    await delay();
    const user = currentUser();
    requireRole(user, ["aep_processor", "aep_reviewer", "administrator"]);
    const d = db();
    const req = d.requirements.find((r) => r.id === input.registrationRequirementId);
    if (!req) throw new ApiError(404, "Requirement not found");
    if (["verified_completed", "not_required", "cancelled"].includes(req.status)) {
      throw new ApiError(403, `Documents cannot be added to a requirement in status ${req.status}`);
    }
    const file = input.file;
    if (file.size <= 0) throw new ApiError(400, "The uploaded file is empty");
    if (file.size > MAX_MOCK_FILE_BYTES) throw new ApiError(400, `Placeholder mode stores files up to ${MAX_MOCK_FILE_BYTES / 1024 / 1024} MB in this browser`);
    const sameType = d.documents.filter((x) => x.registration_requirement_id === req.id && x.document_type === input.documentType);
    for (const x of sameType) x.is_current = false;
    const version = sameType.reduce((m, x) => Math.max(m, x.document_version), 0) + 1;
    const id = uuid();
    const row: DocumentRow = {
      id,
      registration_requirement_id: req.id,
      document_type: input.documentType,
      file_name: file.name,
      storage_key: `${req.trust_case_id}/${req.id}/${input.documentType}/${Date.now()}-${file.name}`,
      mime_type: file.type || "application/octet-stream",
      file_size: file.size,
      document_version: version,
      uploaded_by: user.id,
      uploaded_at: nowIso(),
      is_current: true,
      verification_status: "pending",
      verified_by: null,
      verified_at: null,
      rejection_reason: null,
      malware_scan_status: "pending",
      file_hash: await sha256Hex(file),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    writeFile(id, await fileToDataUrl(file));
    d.documents.push(row);
    d.events.push(mkEvent(req.trust_case_id, req.id, "document_uploaded", user.id, `${input.documentType} uploaded (v${version})`, null, null, nowIso(), { fileName: file.name, version }));
    commit();
    return row;
  },

  async getDocumentDownload(documentId) {
    await delay(40);
    const user = currentUser();
    const d = db();
    const doc = d.documents.find((x) => x.id === documentId);
    if (!doc) throw new ApiError(404, "Document not found");
    const req = d.requirements.find((r) => r.id === doc.registration_requirement_id);
    const c = req && d.cases.find((x) => x.id === req.trust_case_id);
    if (user.role === "wm_requester") {
      if (!c || c.requesting_wm_team !== user.wmTeam) throw new ApiError(403, "This case belongs to another WM team");
      if (doc.verification_status !== "verified") throw new ApiError(403, "Only verified certificates are released to the WM team");
    }
    const url = readFiles()[documentId];
    if (!url) throw new ApiError(404, "This seeded document has no file behind it. Upload a real file to try the download.");
    return { url, expiresAt: new Date(Date.now() + 300_000).toISOString(), fileName: doc.file_name };
  },

  async verifyDocument(documentId, input) {
    await delay();
    const user = currentUser();
    requireRole(user, ["aep_reviewer", "compliance_reviewer", "administrator"]);
    const d = db();
    const doc = d.documents.find((x) => x.id === documentId);
    if (!doc) throw new ApiError(404, "Document not found");
    if (doc.uploaded_by === user.id) {
      throw new ApiError(403, "Verification denied: you cannot verify or reject a document you uploaded (maker-checker control)");
    }
    if (input.verificationStatus === "rejected" && !input.rejectionReason?.trim()) throw new ApiError(400, "rejectionReason is required when rejecting");
    doc.verification_status = input.verificationStatus;
    doc.verified_by = user.id;
    doc.verified_at = nowIso();
    doc.rejection_reason = input.verificationStatus === "rejected" ? (input.rejectionReason ?? null) : null;
    doc.updated_at = nowIso();
    const req = d.requirements.find((r) => r.id === doc.registration_requirement_id)!;
    d.events.push(
      mkEvent(req.trust_case_id, req.id, input.verificationStatus === "verified" ? "evidence_verified" : "evidence_rejected", user.id, `Document ${input.verificationStatus}${input.rejectionReason ? ": " + input.rejectionReason : ""}`, null, null)
    );
    commit();
    return doc;
  },

  async listEvents(caseId) {
    await delay();
    return db()
      .events.filter((e) => e.trust_case_id === caseId)
      .sort((a, b) => b.performed_at.localeCompare(a.performed_at));
  },

  async listAllEvents(filter = {}) {
    await delay();
    const user = currentUser();
    const d = db();
    const visibleCases = d.cases.filter((c) => !c.is_deleted && (user.role !== "wm_requester" || c.requesting_wm_team === user.wmTeam));
    const byId = new Map(visibleCases.map((c) => [c.id, c]));
    const from = filter.from ? new Date(filter.from).getTime() : null;
    const to = filter.to ? new Date(filter.to).getTime() : null;
    return d.events
      .filter((e) => byId.has(e.trust_case_id))
      .filter((e) => !filter.type || e.event_type === filter.type)
      .filter((e) => !filter.caseId || e.trust_case_id === filter.caseId)
      .filter((e) => from == null || new Date(e.performed_at).getTime() >= from)
      .filter((e) => to == null || new Date(e.performed_at).getTime() <= to)
      .sort((a, b) => b.performed_at.localeCompare(a.performed_at))
      .map((e): AuditEventRow => {
        const c = byId.get(e.trust_case_id)!;
        return { ...e, case_reference: c.case_reference, trust_name: c.trust_name };
      });
  },
};
