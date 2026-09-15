"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session/SessionProvider";
import type { ProfileSummary } from "@/lib/api";
import type { DocumentRow, EventRow, RequirementRow, TrustCaseWithRequirements } from "@/server/domain/types";
import {
  AUTHORITY_LABEL,
  DECISION_LABEL,
  DOCUMENT_TYPE_LABEL,
  EVENT_LABEL,
  OVERALL_STATUS_LABEL,
  PRIORITY_LABEL,
  REQUIREMENT_STATUS_LABEL,
  VERIFICATION_LABEL,
  formatDate,
} from "@/lib/labels";
import { Alert, Button, Spinner } from "@/components/ui";

// Printable evidence pack for one case: what an internal reviewer, the FCA or a provider would ask to
// see. Everything comes from the same records the app uses; nothing is re-typed.
export default function AuditPackPage() {
  const { id } = useParams<{ id: string }>();
  const { api, user } = useSession();
  const [trustCase, setTrustCase] = useState<TrustCaseWithRequirements | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [docs, setDocs] = useState<Record<string, DocumentRow[]>>({});
  const [people, setPeople] = useState<Record<string, ProfileSummary>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, ev, profiles] = await Promise.all([api.getCase(id), api.listEvents(id), api.listProfiles().catch(() => [] as ProfileSummary[])]);
        const perReq = await Promise.all(c.requirements.map((r) => api.listDocuments(r.id).then((d) => [r.id, d] as const)));
        if (cancelled) return;
        setTrustCase(c);
        setEvents([...ev].sort((a, b) => a.performed_at.localeCompare(b.performed_at)));
        setDocs(Object.fromEntries(perReq));
        setPeople(Object.fromEntries(profiles.map((p) => [p.id, p])));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load case");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, id, user?.role]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!trustCase) return <Spinner label="Assembling audit pack" />;

  const who = (userId: string | null | undefined) => (userId ? people[userId]?.fullName ?? userId : "—");
  const generatedAt = new Date().toISOString();

  return (
    <div className="mx-auto max-w-4xl space-y-8 print:max-w-none print:space-y-6 print:text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/cases/${trustCase.id}`} className="text-xs text-slate-500 hover:underline">
          ← Back to case
        </Link>
        <Button onClick={() => window.print()}>Print / save as PDF</Button>
      </div>

      <header className="border-b border-slate-300 pb-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">AWM · Trust registration audit pack</div>
        <h1 className="mt-1 text-2xl font-semibold">{trustCase.trust_name}</h1>
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700">
          <span>
            Case <span className="font-mono">{trustCase.case_reference}</span>
          </span>
          <span>Status: {OVERALL_STATUS_LABEL[trustCase.overall_status]}</span>
          <span>Activation: {trustCase.activation_blocked ? "blocked" : "cleared"}</span>
          <span>Generated {formatDate(generatedAt, true)}</span>
        </div>
      </header>

      <Section title="1. Trust and request">
        <Grid
          rows={[
            ["Client", trustCase.client_display_name],
            ["Insightly ID", trustCase.insightly_id],
            ["Trust type", trustCase.trust_type],
            ["Trust created", formatDate(trustCase.trust_creation_date)],
            ["Provider", `${trustCase.provider_name} (${trustCase.provider_country})`],
            ["Requesting WM team", trustCase.requesting_wm_team],
            ["Requested by", who(trustCase.requesting_wm_user_id)],
            ["AEP owner", who(trustCase.assigned_aep_user_id)],
            ["Priority", PRIORITY_LABEL[trustCase.business_priority]],
            ["Target provider date", formatDate(trustCase.target_provider_submission_date)],
            ["Raised", formatDate(trustCase.created_at, true)],
            ["Closed", formatDate(trustCase.closed_at, true)],
          ]}
        />
      </Section>

      <Section title="2. Registration requirements and outcomes">
        {trustCase.requirements.length === 0 && <p className="text-sm text-slate-500">No requirement decision recorded yet.</p>}
        {trustCase.requirements.map((r) => (
          <RequirementBlock key={r.id} r={r} docs={docs[r.id] ?? []} who={who} />
        ))}
      </Section>

      <Section title="3. Complete activity trail">
        <p className="mb-2 text-xs text-slate-500">
          {events.length} events, append-only (database trigger prevents edits or deletion). Oldest first.
        </p>
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1 pr-2">When</th>
              <th className="py-1 pr-2">Event</th>
              <th className="py-1 pr-2">From → to</th>
              <th className="py-1 pr-2">By</th>
              <th className="py-1">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {events.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="whitespace-nowrap py-1 pr-2 text-slate-600">{formatDate(e.performed_at, true)}</td>
                <td className="py-1 pr-2 font-medium">{EVENT_LABEL[e.event_type]}</td>
                <td className="py-1 pr-2 text-slate-600">{e.previous_status || e.new_status ? `${e.previous_status ?? "—"} → ${e.new_status ?? "—"}` : ""}</td>
                <td className="py-1 pr-2 text-slate-600">{who(e.performed_by)}</td>
                <td className="py-1 text-slate-700">{e.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <footer className="border-t border-slate-300 pt-3 text-[10px] text-slate-500">
        Records held in the AWM trust_reg schema (Supabase, EU region) with row-level security; certificate files in a private bucket
        with SHA-256 hashes recorded at upload. Retention: 7 years from case closure (FCA record-keeping). Pack generated by{" "}
        {user?.fullName ?? user?.email ?? "the Trust Registration Monitor"}.
      </footer>
    </div>
  );
}

function RequirementBlock({ r, docs, who }: { r: RequirementRow; docs: DocumentRow[]; who: (id: string | null | undefined) => string }) {
  return (
    <div className="mb-4 rounded-lg border border-slate-200 p-3 print:break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{AUTHORITY_LABEL[r.authority]}</h3>
        <span className="text-xs text-slate-600">
          {DECISION_LABEL[r.requirement_status]} · {REQUIREMENT_STATUS_LABEL[r.status]}
        </span>
      </div>
      <Grid
        rows={[
          ["Decision reason", r.requirement_reason ?? "—"],
          ["Decided by / at", `${who(r.requirement_decided_by)} · ${formatDate(r.requirement_decided_at, true)}`],
          ["Statutory deadline", formatDate(r.registration_deadline)],
          ["Submitted to authority", formatDate(r.submitted_at, true)],
          ["Registration completed", formatDate(r.completed_at, true)],
          ["Verified by / at", `${who(r.verified_by)} · ${formatDate(r.verified_at, true)}`],
          ["Authority reference", r.authority_reference ?? "—"],
          ["Completion notes", r.completion_notes ?? "—"],
        ]}
      />
      {r.checklist && r.checklist.length > 0 && (
        <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
          {r.checklist.map((i) => (
            <li key={i.key} className="flex items-center gap-1.5">
              <span className={`inline-block h-3 w-3 rounded-sm border ${i.completed ? "border-emerald-600 bg-emerald-600" : "border-slate-400"}`} aria-hidden />
              {i.label}
            </li>
          ))}
        </ul>
      )}
      <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</h4>
      {docs.length === 0 && <p className="text-xs text-slate-500">No documents.</p>}
      {docs.length > 0 && (
        <table className="mt-1 w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1 pr-2">Type</th>
              <th className="py-1 pr-2">File</th>
              <th className="py-1 pr-2">v</th>
              <th className="py-1 pr-2">Uploaded</th>
              <th className="py-1 pr-2">Verification</th>
              <th className="py-1">SHA-256</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {docs.map((d) => (
              <tr key={d.id} className="align-top">
                <td className="py-1 pr-2">{DOCUMENT_TYPE_LABEL[d.document_type]}</td>
                <td className="py-1 pr-2">
                  {d.file_name} <span className="text-slate-400">({Math.round(d.file_size / 1024)} KB)</span>
                </td>
                <td className="py-1 pr-2">{d.document_version}{d.is_current ? "" : " (superseded)"}</td>
                <td className="py-1 pr-2 text-slate-600">
                  {who(d.uploaded_by)} · {formatDate(d.uploaded_at, true)}
                </td>
                <td className="py-1 pr-2 text-slate-600">
                  {VERIFICATION_LABEL[d.verification_status]}
                  {d.verified_by ? ` · ${who(d.verified_by)} · ${formatDate(d.verified_at, true)}` : ""}
                  {d.rejection_reason ? ` · ${d.rejection_reason}` : ""}
                </td>
                <td className="break-all py-1 font-mono text-[10px] text-slate-500">{d.file_hash ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="print:break-inside-avoid">
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="w-40 shrink-0 text-slate-500">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
