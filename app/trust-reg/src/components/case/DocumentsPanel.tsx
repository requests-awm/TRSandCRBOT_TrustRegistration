"use client";

import { useCallback, useEffect, useState } from "react";
import type { DocumentRow, DocumentType, RequirementRow, UserRole } from "@/server/domain/types";
import { DOCUMENT_TYPES } from "@/server/domain/types";
import { DOCUMENT_TYPE_LABEL, formatBytes, formatDate } from "@/lib/labels";
import { useSession } from "@/lib/session/SessionProvider";
import { ApiError } from "@/lib/api";
import { Alert, Button, Field, Input, Modal, Select, Textarea, VerificationBadge } from "../ui";
import { DownloadButton } from "./DownloadButton";

const UPLOAD_ROLES: UserRole[] = ["aep_processor", "aep_reviewer", "administrator"];
const VERIFY_ROLES: UserRole[] = ["aep_reviewer", "compliance_reviewer", "administrator"];
const READ_ALL_ROLES: UserRole[] = ["aep_processor", "aep_reviewer", "compliance_reviewer", "administrator", "auditor"];

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.doc,.docx";
const MAX_MB = 25;

const typesFor = (authority: RequirementRow["authority"]): DocumentType[] =>
  DOCUMENT_TYPES.filter((t) => (authority === "trs" ? !t.startsWith("crbot_") : !t.startsWith("trs_")));

export function DocumentsPanel({ requirement, onChanged }: { requirement: RequirementRow; onChanged: () => Promise<void> }) {
  const { api, user } = useSession();
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [rejecting, setRejecting] = useState<DocumentRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api
        .listDocuments(requirement.id)
        .then(setDocs)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load documents")),
    [api, requirement.id]
  );

  useEffect(() => {
    let cancelled = false;
    api
      .listDocuments(requirement.id)
      .then((rows) => !cancelled && setDocs(rows))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load documents"));
    return () => {
      cancelled = true;
    };
  }, [api, requirement.id, requirement.updated_at]);

  const canUpload = !!user && UPLOAD_ROLES.includes(user.role) && !["verified_completed", "not_required", "cancelled"].includes(requirement.status);
  const canVerify = !!user && VERIFY_ROLES.includes(user.role);
  const canDownload = (d: DocumentRow) => !!user && (READ_ALL_ROLES.includes(user.role) || (user.role === "wm_requester" && d.verification_status === "verified"));

  const verify = async (doc: DocumentRow) => {
    setError(null);
    setBusyId(doc.id);
    try {
      await api.verifyDocument(doc.id, { verificationStatus: "verified" });
      await load();
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Verification failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="border-t border-slate-100 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-slate-500">Evidence documents</div>
        {canUpload && (
          <Button size="sm" variant="secondary" onClick={() => setUploadOpen(true)}>
            Upload document
          </Button>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {docs && docs.length === 0 && <p className="text-sm text-slate-500">No documents uploaded.</p>}
      {docs && docs.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md ring-1 ring-slate-200">
          {docs.map((d) => {
            const own = user?.id === d.uploaded_by;
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{d.file_name}</span>
                    <span className="text-xs text-slate-500">v{d.document_version}</span>
                    {d.is_current ? (
                      <span className="rounded bg-slate-100 px-1.5 text-[10px] font-medium text-slate-600">current</span>
                    ) : (
                      <span className="rounded bg-slate-50 px-1.5 text-[10px] text-slate-400">superseded</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {DOCUMENT_TYPE_LABEL[d.document_type]} · {formatBytes(d.file_size)} · uploaded {formatDate(d.uploaded_at, true)}
                  </div>
                  {d.file_hash && (
                    <div className="font-mono text-[10px] text-slate-400" title="SHA-256 of the stored file">
                      sha256 {d.file_hash.slice(0, 16)}…
                    </div>
                  )}
                  {d.rejection_reason && <div className="text-xs text-red-700">Rejected: {d.rejection_reason}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <VerificationBadge status={d.verification_status} />
                  {canDownload(d) && <DownloadButton documentId={d.id} size="sm" variant="ghost" />}
                  {canVerify && d.is_current && d.verification_status === "pending" && (
                    <>
                      <Button size="sm" disabled={own || busyId === d.id} title={own ? "Maker-checker: you uploaded this document" : undefined} onClick={() => verify(d)}>
                        Verify
                      </Button>
                      <Button size="sm" variant="danger" disabled={own || busyId === d.id} title={own ? "Maker-checker: you uploaded this document" : undefined} onClick={() => setRejecting(d)}>
                        Reject
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {uploadOpen && (
        <UploadModal
          requirement={requirement}
          onClose={() => setUploadOpen(false)}
          onSaved={async () => {
            await load();
            await onChanged();
          }}
        />
      )}
      {rejecting && (
        <RejectModal
          doc={rejecting}
          onClose={() => setRejecting(null)}
          onSaved={async () => {
            await load();
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

// The file goes to the API as multipart/form-data; the server stores it in the private evidence
// bucket, hashes it and records the metadata. In placeholder mode it is kept in this browser.
function UploadModal({ requirement, onClose, onSaved }: { requirement: RequirementRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const { api } = useSession();
  const types = typesFor(requirement.authority);
  const [documentType, setDocumentType] = useState<DocumentType>(types[0]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setError("Choose a file");
    if (file.size > MAX_MB * 1024 * 1024) return setError(`File exceeds the ${MAX_MB} MB limit`);
    setBusy(true);
    setError(null);
    try {
      await api.uploadDocument({ registrationRequirementId: requirement.id, documentType, file });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
      setBusy(false);
    }
  };

  return (
    <Modal title="Upload evidence document" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {api.mode === "mock" && <Alert tone="info">Placeholder mode: the file is kept in this browser only (up to 4 MB).</Alert>}
        <Field label="Document type" required>
          <Select value={documentType} onChange={(e) => setDocumentType(e.target.value as DocumentType)}>
            {types.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="File" required hint={`PDF, PNG, JPEG or Word, up to ${MAX_MB} MB`}>
          <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} accept={ACCEPT} />
        </Field>
        {file && (
          <p className="text-xs text-slate-500">
            {file.name} · {formatBytes(file.size)}
          </p>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !file}>
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RejectModal({ doc, onClose, onSaved }: { doc: DocumentRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const { api } = useSession();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return setError("A reason is required");
    setBusy(true);
    try {
      await api.verifyDocument(doc.id, { verificationStatus: "rejected", rejectionReason: reason });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rejection failed");
      setBusy(false);
    }
  };

  return (
    <Modal title={`Reject ${doc.file_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Rejection reason" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {busy ? "Rejecting…" : "Reject document"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
