"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session/SessionProvider";
import type { EventRow, TrustCaseWithRequirements } from "@/server/domain/types";
import { PRIORITY_LABEL, formatDate } from "@/lib/labels";
import { simpleCaseStatus } from "@/server/workflow/deriveSimpleStatus";
import { ActivationBadge, Alert, Card, DL, OverallStatusBadge, SimpleStatusBadge, Spinner } from "@/components/ui";
import { RequirementPanel } from "@/components/case/RequirementPanel";
import { ConfirmationPanel } from "@/components/case/ConfirmationPanel";
import { OwnerCard } from "@/components/case/OwnerCard";
import { Timeline } from "@/components/case/Timeline";

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { api, user } = useSession();
  const [trustCase, setTrustCase] = useState<TrustCaseWithRequirements | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([api.getCase(id), api.listEvents(id)])
        .then(([c, ev]) => {
          setTrustCase(c);
          setEvents(ev);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load case")),
    [api, id]
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getCase(id), api.listEvents(id)])
      .then(([c, ev]) => {
        if (cancelled) return;
        setTrustCase(c);
        setEvents(ev);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load case"));
    return () => {
      cancelled = true;
    };
  }, [api, id, user?.role]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!trustCase) return <Spinner label="Loading case" />;

  const req = (authority: "trs" | "crbot") => trustCase.requirements.find((r) => r.authority === authority);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-xs text-slate-500 hover:underline">
          ← All cases
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{trustCase.trust_name}</h1>
          <span className="font-mono text-sm text-slate-500">{trustCase.case_reference}</span>
          <SimpleStatusBadge
            status={simpleCaseStatus(
              trustCase.overall_status,
              trustCase.requirements.map((r) => ({ requirementStatus: r.requirement_status, status: r.status }))
            )}
          />
          <OverallStatusBadge status={trustCase.overall_status} />
          <ActivationBadge blocked={trustCase.activation_blocked} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">
            {trustCase.client_display_name} · {trustCase.provider_name} ({trustCase.provider_country})
          </p>
          <Link href={`/cases/${trustCase.id}/audit-pack`} className="text-xs font-medium text-slate-700 underline-offset-2 hover:underline">
            Audit pack (print / PDF)
          </Link>
        </div>
      </div>

      {trustCase.overall_status === "overdue" && <Alert tone="error">A required registration has passed its statutory deadline.</Alert>}
      {trustCase.overall_status === "requirement_review" && (
        <Alert tone="info">Awaiting AEP decision on whether TRS and/or CRBOT registration is required.</Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ConfirmationPanel trustCase={trustCase} onChanged={load} />
          <RequirementPanel caseId={trustCase.id} authority="trs" requirement={req("trs")} onChanged={load} />
          <RequirementPanel caseId={trustCase.id} authority="crbot" requirement={req("crbot")} onChanged={load} />
        </div>
        <div className="space-y-6">
          <OwnerCard trustCase={trustCase} onChanged={load} />
          <Card title="Request details">
            <DL
              items={[
                ["Insightly ID", <span key="i" className="font-mono">{trustCase.insightly_id}</span>],
                ["Trust type", trustCase.trust_type],
                ["Trust created", formatDate(trustCase.trust_creation_date)],
                ["Requesting team", trustCase.requesting_wm_team],
                ["Priority", PRIORITY_LABEL[trustCase.business_priority]],
                ["Target provider date", formatDate(trustCase.target_provider_submission_date)],
                ["Raised", formatDate(trustCase.created_at, true)],
                ["Last updated", formatDate(trustCase.updated_at, true)],
                ["Closed", formatDate(trustCase.closed_at, true)],
              ]}
            />
          </Card>
          <Card title="Timeline">
            <Timeline events={events} />
          </Card>
        </div>
      </div>
    </div>
  );
}
