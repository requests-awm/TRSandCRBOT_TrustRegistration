import { ApiError, type TrustRegApi } from "./client";
import { readDevRole } from "@/lib/session/devRole";
import { publicConfig } from "@/lib/publicConfig";

// Talks to the Next.js route handlers. In AUTH_MODE=dev the chosen role travels in a header;
// with Supabase auth the session cookie does the work and the header is ignored.
function authHeaders(init: RequestInit = {}): Headers {
  const headers = new Headers(init.headers);
  if (publicConfig().authMode === "dev") {
    headers.set("x-dev-role", readDevRole());
  }
  return headers;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = body?.error ?? res.statusText;
    const detail = body?.issues ? ": " + body.issues.map((i: { path: string; message: string }) => `${i.path} ${i.message}`).join(", ") : "";
    throw new ApiError(res.status, message + detail);
  }
  return body as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = authHeaders(init);
  headers.set("content-type", "application/json");
  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  return parse<T>(res);
}

// Multipart: let the browser set the content-type boundary.
async function requestForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body: form, headers: authHeaders(), credentials: "same-origin" });
  return parse<T>(res);
}

const qs = (obj: Record<string, string | undefined>) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v) params.set(k, v);
  const s = params.toString();
  return s ? `?${s}` : "";
};

export const httpClient: TrustRegApi = {
  mode: "http",
  me: async () => {
    try {
      return await request("/api/me");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },
  listCases: (filter = {}) => request(`/api/trust-cases${qs({ status: filter.status, search: filter.search })}`),
  getCase: (id) => request(`/api/trust-cases/${id}`),
  createCase: (input) => request("/api/trust-cases", { method: "POST", body: JSON.stringify(input) }),
  handBackToWm: (id, input = {}) => request(`/api/trust-cases/${id}/hand-back`, { method: "POST", body: JSON.stringify(input) }),
  closeCase: (id, input = {}) => request(`/api/trust-cases/${id}/close`, { method: "POST", body: JSON.stringify(input) }),
  setRequirementDecision: (caseId, input) =>
    request(`/api/trust-cases/${caseId}/requirements`, { method: "POST", body: JSON.stringify(input) }),
  patchRequirement: (id, input) =>
    request(`/api/registration-requirements/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  transition: (id, input) =>
    request(`/api/registration-requirements/${id}/transition`, { method: "POST", body: JSON.stringify(input) }),
  listDocuments: (id) => request(`/api/registration-requirements/${id}/documents`),
  uploadDocument: (input) => {
    const form = new FormData();
    form.set("registrationRequirementId", input.registrationRequirementId);
    form.set("documentType", input.documentType);
    form.set("file", input.file, input.file.name);
    return requestForm("/api/registration-documents", form);
  },
  verifyDocument: (id, input) =>
    request(`/api/registration-documents/${id}/verify`, { method: "POST", body: JSON.stringify(input) }),
  getDocumentDownload: (id) => request(`/api/registration-documents/${id}/download`),
  listEvents: (caseId) => request(`/api/trust-cases/${caseId}/events`),
  listAllEvents: (filter = {}) => request(`/api/events${qs({ type: filter.type, caseId: filter.caseId, from: filter.from, to: filter.to })}`),
  searchClients: (q) => request(`/api/clients/search${qs({ q })}`),
  listProfiles: (roles) => request(`/api/profiles${qs({ roles: roles?.join(",") })}`),
  assignOwner: (caseId, aepUserId) => request(`/api/trust-cases/${caseId}`, { method: "PATCH", body: JSON.stringify({ assignedAepUserId: aepUserId }) }),
};
