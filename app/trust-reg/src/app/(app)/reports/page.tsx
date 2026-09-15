"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/session/SessionProvider";
import type { AuditEventRow } from "@/lib/api";
import { toDashboardRow, type DashboardRow } from "@/lib/dashboardRows";
import { STALE_AFTER_DAYS, agingBucket, daysSince, isOpen, isStalled } from "@/lib/staleness";
import { OVERALL_STATUS_LABEL, formatDate } from "@/lib/labels";
import { Alert, Button, Card, Spinner } from "@/components/ui";

// Answers the "how do you measure it today" questions from the data the tool already holds:
// volume per month, time to registration, where cases sit, which providers, how old the open book is.

const MONTHS_BACK = 6;
const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

function lastMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    out.unshift(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const dayDiff = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));

export default function ReportsPage() {
  const { api, user } = useSession();
  const [cases, setCases] = useState<DashboardRow[] | null>(null);
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listCases(), api.listAllEvents()])
      .then(([c, e]) => {
        if (cancelled) return;
        setCases(c.map(toDashboardRow));
        setEvents(e);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [api, user?.role]);

  const report = useMemo(() => {
    if (!cases) return null;
    const months = lastMonths(MONTHS_BACK);
    const firstEvent = (caseId: string, type: AuditEventRow["event_type"]) =>
      events.filter((e) => e.trust_case_id === caseId && e.event_type === type).sort((a, b) => a.performed_at.localeCompare(b.performed_at))[0];

    const monthly = months.map((m) => ({
      key: m,
      raised: cases.filter((c) => monthKey(c.created_at) === m).length,
      verified: cases.filter((c) => {
        const ev = firstEvent(c.id, "activation_unblocked");
        return ev && monthKey(ev.performed_at) === m;
      }).length,
      closed: cases.filter((c) => c.closed_at && monthKey(c.closed_at) === m).length,
    }));

    const toVerified = cases.map((c) => firstEvent(c.id, "activation_unblocked")).filter(Boolean).map((ev, i) => dayDiff(cases.filter((c) => firstEvent(c.id, "activation_unblocked"))[i].created_at, ev!.performed_at));
    const toHandBack = cases.map((c) => firstEvent(c.id, "case_handed_back")).filter(Boolean).map((ev, i) => dayDiff(cases.filter((c) => firstEvent(c.id, "case_handed_back"))[i].created_at, ev!.performed_at));
    const toClose = cases.filter((c) => c.closed_at).map((c) => dayDiff(c.created_at, c.closed_at as string));

    const open = cases.filter((c) => isOpen(c.overall_status));
    const byProvider = Object.values(
      cases.reduce<Record<string, { provider: string; open: number; overdue: number; completed: number; total: number }>>((acc, c) => {
        const p = (acc[c.provider_name] ??= { provider: c.provider_name, open: 0, overdue: 0, completed: 0, total: 0 });
        p.total++;
        if (isOpen(c.overall_status)) p.open++;
        if (c.overall_status === "overdue") p.overdue++;
        if (c.simple === "completed") p.completed++;
        return acc;
      }, {})
    ).sort((a, b) => b.total - a.total);

    const jurisdiction = {
      trsOnly: cases.filter((c) => c.jurisdictions.length === 1 && c.jurisdictions[0] === "trs").length,
      crbotOnly: cases.filter((c) => c.jurisdictions.length === 1 && c.jurisdictions[0] === "crbot").length,
      both: cases.filter((c) => c.jurisdictions.length === 2).length,
      undecided: cases.filter((c) => c.jurisdictions.length === 0 && c.overall_status !== "closed").length,
    };

    const aging = { "0-7": 0, "8-14": 0, "15-28": 0, "29+": 0 };
    for (const c of open) aging[agingBucket(daysSince(c.created_at))]++;

    const byStatus = Object.entries(
      cases.reduce<Record<string, number>>((acc, c) => ((acc[c.overall_status] = (acc[c.overall_status] ?? 0) + 1), acc), {})
    );

    const attention = [...open]
      .filter((c) => c.overall_status === "overdue" || isStalled(c))
      .sort((a, b) => daysSince(b.updated_at) - daysSince(a.updated_at));

    return { months, monthly, cycle: { toVerified, toHandBack, toClose }, open, byProvider, jurisdiction, aging, byStatus, attention, stalled: open.filter((c) => isStalled(c)).length };
  }, [cases, events]);

  const exportCsv = () => {
    if (!cases) return;
    const header = ["case_reference", "trust_name", "client", "provider", "country", "jurisdictions", "overall_status", "progress", "activation_blocked", "priority", "owner_id", "raised", "target_provider_date", "closed", "days_open", "days_since_activity"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = cases.map((c) =>
      [
        c.case_reference,
        c.trust_name,
        c.client_display_name,
        c.provider_name,
        c.provider_country,
        c.jurisdictions.join("+") || "undecided",
        c.overall_status,
        c.simple,
        c.activation_blocked,
        c.business_priority,
        c.assigned_aep_user_id ?? "",
        c.created_at,
        c.target_provider_submission_date ?? "",
        c.closed_at ?? "",
        daysSince(c.created_at),
        daysSince(c.updated_at),
      ]
        .map(esc)
        .join(",")
    );
    const blob = new Blob([[header.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trust-registration-cases-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!report || !cases) return <Spinner label="Building reports" />;

  const maxMonthly = Math.max(1, ...report.monthly.flatMap((m) => [m.raised, m.verified, m.closed]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="text-sm text-slate-600">
            {cases.length} cases in total · {report.open.length} open · {report.stalled} stalled ({STALE_AFTER_DAYS}d+ without activity)
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv}>
          Export cases (CSV)
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Volume by month (last ${MONTHS_BACK})`}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1">Month</th>
                <th className="py-1">Raised</th>
                <th className="py-1">Verified</th>
                <th className="py-1">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.monthly.map((m) => (
                <tr key={m.key}>
                  <td className="py-1.5 text-slate-700">{monthLabel(m.key)}</td>
                  <td className="py-1.5">
                    <Bar value={m.raised} max={maxMonthly} tone="bg-slate-400" />
                  </td>
                  <td className="py-1.5">
                    <Bar value={m.verified} max={maxMonthly} tone="bg-emerald-500" />
                  </td>
                  <td className="py-1.5">
                    <Bar value={m.closed} max={maxMonthly} tone="bg-violet-500" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Use this to answer &ldquo;how many a month, and is it growing&rdquo; with data rather than recollection.</p>
        </Card>

        <Card title="Time to registration (days from request)">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Metric label="To all verified" value={median(report.cycle.toVerified)} sub={`avg ${mean(report.cycle.toVerified) ?? "—"} · n=${report.cycle.toVerified.length}`} />
            <Metric label="To hand-back" value={median(report.cycle.toHandBack)} sub={`avg ${mean(report.cycle.toHandBack) ?? "—"} · n=${report.cycle.toHandBack.length}`} />
            <Metric label="To close" value={median(report.cycle.toClose)} sub={`avg ${mean(report.cycle.toClose) ?? "—"} · n=${report.cycle.toClose.length}`} />
          </div>
          <p className="mt-3 text-xs text-slate-500">Median days. &ldquo;No trusts delayed&rdquo; becomes measurable once a target is agreed.</p>
        </Card>

        <Card title="Open cases by age">
          <div className="grid grid-cols-4 gap-3 text-center">
            {(Object.keys(report.aging) as Array<keyof typeof report.aging>).map((k) => (
              <Metric key={k} label={`${k} days`} value={report.aging[k]} />
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">Days since the request was raised. Compare against &ldquo;how long is too long&rdquo; (7 / 14 / 28).</p>
        </Card>

        <Card title="Jurisdiction mix">
          <div className="grid grid-cols-4 gap-3 text-center">
            <Metric label="UK TRS only" value={report.jurisdiction.trsOnly} />
            <Metric label="CRBOT only" value={report.jurisdiction.crbotOnly} />
            <Metric label="Both" value={report.jurisdiction.both} />
            <Metric label="Undecided" value={report.jurisdiction.undecided} />
          </div>
          <p className="mt-3 text-xs text-slate-500">Shows whether &ldquo;both&rdquo; is a recurring case or an edge case.</p>
        </Card>

        <Card title="By provider">
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1">Provider</th>
                <th className="py-1 text-right">Total</th>
                <th className="py-1 text-right">Open</th>
                <th className="py-1 text-right">Overdue</th>
                <th className="py-1 text-right">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.byProvider.map((p) => (
                <tr key={p.provider}>
                  <td className="py-1.5">{p.provider}</td>
                  <td className="py-1.5 text-right">{p.total}</td>
                  <td className="py-1.5 text-right">{p.open}</td>
                  <td className={`py-1.5 text-right ${p.overdue ? "font-medium text-red-700" : ""}`}>{p.overdue}</td>
                  <td className="py-1.5 text-right">{p.completed}</td>
                </tr>
              ))}
              {report.byProvider.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-slate-500">
                    No cases yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card title="Where cases sit now">
          <ul className="space-y-1.5 text-sm">
            {report.byStatus.map(([s, n]) => (
              <li key={s} className="flex items-center gap-3">
                <span className="w-40 text-slate-700">{OVERALL_STATUS_LABEL[s as keyof typeof OVERALL_STATUS_LABEL]}</span>
                <Bar value={n} max={Math.max(1, cases.length)} tone="bg-sky-500" />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={`Needs attention (${report.attention.length})`}>
        {report.attention.length === 0 && <p className="text-sm text-slate-500">Nothing overdue or stalled.</p>}
        {report.attention.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1">Case</th>
                <th className="py-1">Trust</th>
                <th className="py-1">Status</th>
                <th className="py-1">Target</th>
                <th className="py-1 text-right">Idle days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.attention.map((c) => (
                <tr key={c.id}>
                  <td className="py-1.5 font-mono text-xs">
                    <Link href={`/cases/${c.id}`} className="underline-offset-2 hover:underline">
                      {c.case_reference}
                    </Link>
                  </td>
                  <td className="py-1.5">{c.trust_name}</td>
                  <td className={`py-1.5 ${c.overall_status === "overdue" ? "font-medium text-red-700" : "text-amber-700"}`}>{OVERALL_STATUS_LABEL[c.overall_status]}</td>
                  <td className="py-1.5 text-xs">{formatDate(c.target_provider_submission_date)}</td>
                  <td className="py-1.5 text-right">{daysSince(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 flex-1 rounded bg-slate-100">
        <div className={`h-2.5 rounded ${tone}`} style={{ width: `${Math.round((value / max) * 100)}%` }} />
      </div>
      <span className="w-6 text-right text-xs text-slate-600">{value}</span>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-2xl font-semibold text-slate-900">{value ?? "—"}</div>
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}
