"use client";

import { useState } from "react";
import type { Authority, ChecklistItem, RequirementRow, UserRole } from "@/server/domain/types";
import { STATE_MACHINE, availableTransitions, type Transition } from "@/server/workflow/requirementStateMachine";
import { AUTHORITY_LABEL, DECISION_LABEL, formatDate } from "@/lib/labels";
import { useSession } from "@/lib/session/SessionProvider";
import { ApiError, type RequirementDecisionInput } from "@/lib/api";
import { Alert, Button, Card, DL, Field, Input, Modal, RequirementStatusBadge, Select, Textarea } from "../ui";
import { DocumentsPanel } from "./DocumentsPanel";

const PROCESS_ROLES: UserRole[] = ["aep_processor", "aep_reviewer", "administrator"];

export function RequirementPanel({
  caseId,
  authority,
  requirement,
  onChanged,
}: {
  caseId: string;
  authority: Authority;
  requirement: RequirementRow | undefined;
  onChanged: () => Promise<void>;
}) {
  const { api, user } = useSession();
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [transition, setTransition] = useState<Transition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canProcess = !!user && PROCESS_ROLES.includes(user.role);
  const actions = requirement && user ? availableTransitions(requirement.status, user.role) : [];

  const toggleChecklist = async (item: ChecklistItem) => {
    if (!requirement?.checklist) return;
    setError(null);
    setBusy(true);
    try {
      await api.patchRequirement(requirement.id, {
        checklist: requirement.checklist.map((c) => (c.key === item.key ? { ...c, completed: !c.completed } : c)),
      });
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const checklistEditable = canProcess && requirement && ["not_started", "ready_to_register", "registration_in_progress"].includes(requirement.status);

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {AUTHORITY_LABEL[authority]}
          {requirement && <RequirementStatusBadge status={requirement.status} />}
        </span>
      }
      actions={
        canProcess && (
          <Button size="sm" variant="secondary" onClick={() => setDecisionOpen(true)}>
            {requirement ? "Change decision" : "Record decision"}
          </Button>
        )
      }
    >
      {!requirement && <p className="text-sm text-slate-500">No requirement decision recorded yet. AEP decides whether {AUTHORITY_LABEL[authority]} registration is needed.</p>}

      {requirement && (
        <div className="space-y-4">
          <DL
            items={[
              ["Decision", DECISION_LABEL[requirement.requirement_status]],
              ["Reason", requirement.requirement_reason],
              ["Registration deadline", formatDate(requirement.registration_deadline)],
              ["Internal target", formatDate(requirement.internal_target_date)],
              ["Submitted", formatDate(requirement.submitted_at, true)],
              ["Completed", formatDate(requirement.completed_at, true)],
              ["Verified", formatDate(requirement.verified_at, true)],
              ["Authority reference", requirement.authority_reference ? <span className="font-mono">{requirement.authority_reference}</span> : "—"],
            ]}
          />

          {requirement.checklist && requirement.checklist.length > 0 && requirement.requirement_status === "required" && (
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">Pre-submission checklist</div>
              <ul className="space-y-1">
                {requirement.checklist.map((item) => (
                  <li key={item.key}>
                    <label className={`flex items-center gap-2 text-sm ${checklistEditable ? "cursor-pointer" : "cursor-default"}`}>
                      <input type="checkbox" checked={item.completed} disabled={!checklistEditable || busy} onChange={() => toggleChecklist(item)} className="h-4 w-4 rounded border-slate-300" />
                      <span className={item.completed ? "text-slate-500 line-through" : "text-slate-800"}>{item.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <Alert tone="error">{error}</Alert>}

          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {actions.map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={t === "CANCEL_REQUIREMENT" || t === "REJECT_EVIDENCE" ? "danger" : t === "VERIFY_EVIDENCE" ? "primary" : "secondary"}
                  onClick={() => setTransition(t)}
                >
                  {STATE_MACHINE[t].label}
                </Button>
              ))}
            </div>
          )}

          {requirement.requirement_status === "required" && <DocumentsPanel requirement={requirement} onChanged={onChanged} />}
        </div>
      )}

      {decisionOpen && (
        <DecisionModal caseId={caseId} authority={authority} existing={requirement} onClose={() => setDecisionOpen(false)} onSaved={onChanged} />
      )}
      {transition && requirement && (
        <TransitionModal requirement={requirement} transition={transition} onClose={() => setTransition(null)} onSaved={onChanged} />
      )}
    </Card>
  );
}

function DecisionModal({
  caseId,
  authority,
  existing,
  onClose,
  onSaved,
}: {
  caseId: string;
  authority: Authority;
  existing?: RequirementRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api } = useSession();
  const [form, setForm] = useState<RequirementDecisionInput>({
    authority,
    requirementStatus: existing?.requirement_status ?? "required",
    requirementReason: existing?.requirement_reason ?? "",
    registrationDeadline: existing?.registration_deadline ?? "",
    internalTargetDate: existing?.internal_target_date ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.requirementReason.trim()) return setError("A reason is required for the decision");
    setBusy(true);
    setError(null);
    try {
      await api.setRequirementDecision(caseId, {
        ...form,
        registrationDeadline: form.registrationDeadline || undefined,
        internalTargetDate: form.internalTargetDate || undefined,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save decision");
      setBusy(false);
    }
  };

  return (
    <Modal title={`${AUTHORITY_LABEL[authority]} requirement decision`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Decision" required>
          <Select value={form.requirementStatus} onChange={(e) => setForm({ ...form, requirementStatus: e.target.value as RequirementDecisionInput["requirementStatus"] })}>
            <option value="required">Required</option>
            <option value="not_required">Not required</option>
            <option value="under_review">Under review</option>
          </Select>
        </Field>
        <Field label="Reason" required hint="Cite the rule applied, e.g. UK-resident trustees, Irish provider">
          <Textarea value={form.requirementReason} onChange={(e) => setForm({ ...form, requirementReason: e.target.value })} />
        </Field>
        {form.requirementStatus === "required" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Registration deadline" hint="Statutory deadline">
              <Input type="date" value={form.registrationDeadline ?? ""} onChange={(e) => setForm({ ...form, registrationDeadline: e.target.value })} />
            </Field>
            <Field label="Internal target date">
              <Input type="date" value={form.internalTargetDate ?? ""} onChange={(e) => setForm({ ...form, internalTargetDate: e.target.value })} />
            </Field>
          </div>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save decision"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TransitionModal({
  requirement,
  transition,
  onClose,
  onSaved,
}: {
  requirement: RequirementRow;
  transition: Transition;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api } = useSession();
  const def = STATE_MACHINE[transition];
  const required = def.requiredFields ?? [];
  const [comment, setComment] = useState("");
  const [authorityReference, setAuthorityReference] = useState(requirement.authority_reference ?? "");
  const [rejectionReason, setRejectionReason] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.transition(requirement.id, {
        transition,
        comment: comment || undefined,
        authorityReference: authorityReference || undefined,
        rejectionReason: rejectionReason || undefined,
        completionNotes: completionNotes || undefined,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Transition failed");
      setBusy(false);
    }
  };

  return (
    <Modal title={def.label} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          {AUTHORITY_LABEL[requirement.authority]}: <RequirementStatusBadge status={requirement.status} /> <span className="mx-1">→</span> <RequirementStatusBadge status={def.to} />
        </p>
        {required.includes("authorityReference") && (
          <Field label="Authority reference" required hint="URN / UTR from HMRC or CRBOT trust register number">
            <Input value={authorityReference} onChange={(e) => setAuthorityReference(e.target.value)} />
          </Field>
        )}
        {required.includes("rejectionReason") && (
          <Field label="Rejection reason" required>
            <Textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
          </Field>
        )}
        {transition === "RECORD_COMPLETION_EVIDENCE" && (
          <Field label="Completion notes">
            <Textarea value={completionNotes} onChange={(e) => setCompletionNotes(e.target.value)} />
          </Field>
        )}
        <Field label="Comment" required={required.includes("comment")}>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy} variant={transition === "CANCEL_REQUIREMENT" || transition === "REJECT_EVIDENCE" ? "danger" : "primary"}>
            {busy ? "Applying…" : def.label}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
