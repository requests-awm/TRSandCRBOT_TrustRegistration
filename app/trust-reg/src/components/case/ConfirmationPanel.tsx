"use client";

import { useEffect, useState } from "react";
import type { DocumentRow, RequirementRow, TrustCaseWithRequirements, UserRole } from "@/server/domain/types";
import { AUTHORITY_LABEL, DOCUMENT_TYPE_LABEL, formatDate } from "@/lib/labels";
import { useSession } from "@/lib/session/SessionProvider";
import { ApiError } from "@/lib/api";
import { Alert, Button, Card, Field, Modal, Textarea } from "../ui";
import { DownloadButton } from "./DownloadButton";

const AEP_ROLES: UserRole[] = ["aep_processor", "aep_reviewer", "administrator"];
const CLOSE_ROLES: UserRole[] = ["wm_requester", "aep_reviewer", "administrator"];

// The WM-facing confirmation: which registrations are done, the authority references, and the
// verified certificates to submit to the provider. Also hosts the hand-back and close actions.
export function ConfirmationPanel({ trustCase, onChanged }: { trustCase: TrustCaseWithRequirements; onChanged: () => Promise<void> }) {
  const { api, user } = useSession();
  const [certs, setCerts] = useState<Array<DocumentRow & { authority: RequirementRow["authority"] }> | null>(null);
  const [action, setAction] = useState<"hand_back" | "close" | null>(null);

  const required = trustCase.requirements.filter((r) => r.requirement_status === "required");
  const gateOpen = !trustCase.activation_blocked;
  const status = trustCase.overall_status;

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      required.map((r) => api.listDocuments(r.id).then((docs) => docs.filter((d) => d.is_current && d.verification_status === "verified").map((d) => ({ ...d, authority: r.authority }))))
    )
      .then((all) => !cancelled && setCerts(all.flat()))
      .catch(() => !cancelled && setCerts([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, trustCase.id, trustCase.updated_at, required.map((r) => r.updated_at).join("|")]);

  const canHandBack = !!user && AEP_ROLES.includes(user.role) && status === "ready_for_provider" && gateOpen;
  const canClose = !!user && CLOSE_ROLES.includes(user.role) && ["ready_for_provider", "handed_back_to_wm"].includes(status);

  if (!gateOpen && status !== "closed") return null;

  return (
    <Card
      title="Registration confirmation for WM"
      actions={
        <div className="flex gap-2">
          {canHandBack && (
            <Button size="sm" onClick={() => setAction("hand_back")}>
              Hand back to WM
            </Button>
          )}
          {canClose && (
            <Button size="sm" variant="secondary" onClick={() => setAction("close")}>
              Close case
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {status === "ready_for_provider" && (
          <Alert tone="success">All required registrations are verified. AEP can now hand the pack back to the WM team.</Alert>
        )}
        {status === "handed_back_to_wm" && (
          <Alert tone="info">Handed back to WM. Submit the certificates below to the provider, then close the case once the trust is accepted.</Alert>
        )}
        {status === "closed" && <Alert tone="info">Case closed {formatDate(trustCase.closed_at, true)}. The provider has accepted the trust.</Alert>}

        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">Registrations</div>
          <ul className="divide-y divide-slate-100 rounded-md ring-1 ring-slate-200 text-sm">
            {required.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="font-medium">{AUTHORITY_LABEL[r.authority]}</span>
                <span className="font-mono text-xs">{r.authority_reference ?? "—"}</span>
                <span className="text-xs text-slate-500">verified {formatDate(r.verified_at)}</span>
              </li>
            ))}
            {required.length === 0 && <li className="px-3 py-2 text-slate-500">No registration was required for this trust.</li>}
          </ul>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">Certificates to submit to the provider</div>
          {certs === null && <p className="text-sm text-slate-500">Loading…</p>}
          {certs && certs.length === 0 && <p className="text-sm text-slate-500">No verified certificate on file.</p>}
          {certs && certs.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-md ring-1 ring-slate-200 text-sm">
              {certs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{d.file_name}</div>
                    <div className="text-xs text-slate-500">
                      {AUTHORITY_LABEL[d.authority]} · {DOCUMENT_TYPE_LABEL[d.document_type]} · v{d.document_version}
                    </div>
                  </div>
                  <DownloadButton documentId={d.id} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {action && (
        <ActionModal
          action={action}
          onClose={() => setAction(null)}
          onConfirm={async (comment) => {
            if (action === "hand_back") await api.handBackToWm(trustCase.id, { comment });
            else await api.closeCase(trustCase.id, { comment });
            await onChanged();
          }}
        />
      )}
    </Card>
  );
}

function ActionModal({ action, onClose, onConfirm }: { action: "hand_back" | "close"; onClose: () => void; onConfirm: (comment?: string) => Promise<void> }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = action === "hand_back" ? "Hand registration pack back to WM" : "Close case";
  const blurb =
    action === "hand_back"
      ? "The requesting WM user will be emailed with the list of verified certificates and a link to this case."
      : "Confirms the provider has accepted the trust. The case moves to Closed and drops off the open-case counts.";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm(comment.trim() || undefined);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">{blurb}</p>
        <Field label="Note" hint="Optional. Recorded in the audit trail.">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Working…" : title}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
