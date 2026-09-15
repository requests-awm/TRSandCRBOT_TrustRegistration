"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/session/SessionProvider";
import type { Authority, OverallStatus, SimpleStatus } from "@/server/domain/types";
import { OVERALL_STATUSES, SIMPLE_STATUSES } from "@/server/domain/types";
import { AUTHORITY_LABEL, OVERALL_STATUS_LABEL, PRIORITY_LABEL, SIMPLE_STATUS_LABEL, formatDate } from "@/lib/labels";
import { jurisdictionLabel, toDashboardRow, type DashboardRow } from "@/lib/dashboardRows";
import { useStoredView, type DashboardView } from "@/lib/useStoredView";
import { STALE_AFTER_DAYS, daysSince, isStalled } from "@/lib/staleness";
import { Avatar, BoardView, type OwnerNames } from "@/components/dashboard/BoardView";
import {
  ActivationBadge,
  Alert,
  Empty,
  Input,
  LinkButton,
  OverallStatusBadge,
  RequirementStatusBadge,
  Select,
  SimpleStatusBadge,
  Spinner,
} from "@/components/ui";

export default function DashboardPage() {
  const { api, user } = useSession();
  const [cases, setCases] = useState<DashboardRow[] | null>(null);
  const [owners, setOwners] = useState<OwnerNames>({});
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useStoredView();
  const [simple, setSimple] = useState<SimpleStatus | "">("");
  const [status, setStatus] = useState<OverallStatus | "">("");
  const [jurisdiction, setJurisdiction] = useState<"" | Authority | "both">("");
  const [onlyStalled, setOnlyStalled] = useState(false);
  const [search, setSearch] = useState("");
  const canCreate = user?.role === "wm_requester" || user?.role === "administrator";

  // Load everything once; filter in the browser so the KPI tiles always describe the whole book.
  useEffect(() => {
    let cancelled = false;
    api
      .listCases()
      .then((rows) => {
        if (cancelled) return;
        setCases(rows.map(toDashboardRow));
        setError(null);
      })
      .catch((e) => !cancelled && setError(e.message));
    api
      .listProfiles()
      .then((people) => !cancelled && setOwners(Object.fromEntries(people.map((p) => [p.id, p.fullName]))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, user?.role]);

  const stats = useMemo(() => {
    const all = cases ?? [];
    const by = (s: OverallStatus) => all.filter((c) => c.overall_status === s).length;
    const bySimple = (s: SimpleStatus) => all.filter((c) => c.simple === s && c.overall_status !== "closed").length;
    return {
      notStarted: bySimple("not_started"),
      inProgress: bySimple("in_progress"),
      completed: bySimple("completed"),
      overdue: by("overdue"),
      blocked: by("blocked"),
      stalled: all.filter((c) => isStalled(c)).length,
      pendingVerification: all.reduce((n, c) => n + c.requirements.filter((r) => r.status === "completed_pending_evidence").length, 0),
      awaitingHandBack: by("ready_for_provider"),
      withWm: by("handed_back_to_wm"),
      closed: by("closed"),
    };
  }, [cases]);

  const filtered = useMemo(() => {
    if (!cases) return null;
    const q = search.trim().toLowerCase();
    return cases.filter(
      (c) =>
        (!simple || c.simple === simple) &&
        (!status || c.overall_status === status) &&
        (!onlyStalled || isStalled(c)) &&
        (!jurisdiction || (jurisdiction === "both" ? c.jurisdictions.length === 2 : c.jurisdictions.includes(jurisdiction))) &&
        (!q || [c.trust_name, c.client_display_name, c.case_reference, c.provider_name].some((v) => v.toLowerCase().includes(q)))
    );
  }, [cases, simple, status, jurisdiction, onlyStalled, search]);

  return (
    <div className="space-y-5">
      {/* Project header, Asana style: coloured tile, title, subtitle, primary action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-sm" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="5" height="16" rx="1" />
              <rect x="10" y="4" width="5" height="10" rx="1" />
              <rect x="17" y="4" width="4" height="13" rx="1" />
            </svg>
          </span>
          <div>
            <h1 className="text-xl font-semibold leading-tight">Trust registration cases</h1>
            <p className="text-sm text-slate-600">
              {user?.role === "wm_requester" ? `Requests raised by ${user.wmTeam}` : "Non-AEP provider trusts awaiting TRS / CRBOT registration"}
            </p>
          </div>
        </div>
        {canCreate && <LinkButton href="/cases/new">New request</LinkButton>}
      </div>

      {/* View tabs + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <ViewTabs view={view} onChange={setView} />
        <div className="flex flex-wrap gap-2 pb-2">
          <Input placeholder="Search trust, client, provider or reference" value={search} onChange={(e) => setSearch(e.target.value)} className="w-60" />
          <Select value={simple} onChange={(e) => setSimple(e.target.value as SimpleStatus | "")} className="w-36">
            <option value="">Any progress</option>
            {SIMPLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SIMPLE_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value as "" | Authority | "both")} className="w-44">
            <option value="">Any jurisdiction</option>
            <option value="trs">UK TRS</option>
            <option value="crbot">Ireland CRBOT</option>
            <option value="both">Both</option>
          </Select>
          {view === "list" && (
            <Select value={status} onChange={(e) => setStatus(e.target.value as OverallStatus | "")} className="w-48">
              <option value="">All detailed statuses</option>
              {OVERALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {OVERALL_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Not started" value={stats.notStarted} onClick={() => setSimple(simple === "not_started" ? "" : "not_started")} active={simple === "not_started"} />
        <Stat label="In progress" value={stats.inProgress} tone="text-blue-700" onClick={() => setSimple(simple === "in_progress" ? "" : "in_progress")} active={simple === "in_progress"} />
        <Stat label="Completed" value={stats.completed} tone="text-emerald-700" onClick={() => setSimple(simple === "completed" ? "" : "completed")} active={simple === "completed"} hint="Verified, awaiting or with WM" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Overdue" value={stats.overdue} tone="text-red-700" small />
        <Stat label="Blocked" value={stats.blocked} tone="text-amber-700" small />
        <Stat label="Stalled" value={stats.stalled} tone="text-amber-700" small hint={`No activity ${STALE_AFTER_DAYS}d+`} onClick={() => setOnlyStalled((v) => !v)} active={onlyStalled} />
        <Stat label="Pending verification" value={stats.pendingVerification} tone="text-teal-700" small />
        <Stat label="Ready to hand back" value={stats.awaitingHandBack} tone="text-emerald-700" small />
        <Stat label="With WM" value={stats.withWm} tone="text-violet-700" small />
        <Stat label="Closed" value={stats.closed} tone="text-zinc-600" small />
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {!filtered && !error && <Spinner />}
      {filtered && view === "board" && <BoardView rows={filtered} canCreate={canCreate} owners={owners} />}
      {filtered && view === "list" && (
        <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold">
              {filtered.length} case{filtered.length === 1 ? "" : "s"}
            </h2>
          </div>
          <div className="p-4">
            {filtered.length === 0 && <Empty>No cases match these filters.</Empty>}
            {filtered.length > 0 && <ListTable rows={filtered} owners={owners} />}
          </div>
        </div>
      )}
    </div>
  );
}

function ViewTabs({ view, onChange }: { view: DashboardView; onChange: (v: DashboardView) => void }) {
  const tab = (v: DashboardView, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      aria-pressed={view === v}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
        view === v ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
      }`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="flex" role="tablist" aria-label="Dashboard view">
      {tab(
        "list",
        "List",
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      )}
      {tab(
        "board",
        "Board",
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="3" y="4" width="5" height="16" rx="1" />
          <rect x="10" y="4" width="5" height="10" rx="1" />
          <rect x="17" y="4" width="4" height="13" rx="1" />
        </svg>
      )}
    </div>
  );
}

function ListTable({ rows, owners }: { rows: DashboardRow[]; owners: OwnerNames }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-2 py-2">Reference</th>
            <th className="px-2 py-2">Trust / client</th>
            <th className="px-2 py-2">Provider</th>
            <th className="px-2 py-2">Jurisdiction</th>
            <th className="px-2 py-2">Progress</th>
            <th className="px-2 py-2">Detail</th>
            <th className="px-2 py-2">Owner</th>
            <th className="px-2 py-2">Priority</th>
            <th className="px-2 py-2">Target date</th>
            <th className="px-2 py-2">Last activity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((c) => {
            const stalled = isStalled(c);
            const ownerName = c.assigned_aep_user_id ? owners[c.assigned_aep_user_id] ?? "AEP" : undefined;
            return (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-2 py-2 font-mono text-xs">
                  <Link href={`/cases/${c.id}`} className="text-slate-900 underline-offset-2 hover:underline">
                    {c.case_reference}
                  </Link>
                </td>
                <td className="px-2 py-2">
                  <div className="font-medium">{c.trust_name}</div>
                  <div className="text-xs text-slate-500">{c.client_display_name}</div>
                </td>
                <td className="px-2 py-2">
                  <div>{c.provider_name}</div>
                  <div className="text-xs text-slate-500">{c.provider_country}</div>
                </td>
                <td className="px-2 py-2">
                  <div className="text-xs font-medium text-slate-700">{jurisdictionLabel(c.jurisdictions)}</div>
                  <div className="mt-1 flex flex-col gap-1">
                    {c.requirements
                      .filter((r) => r.requirement_status === "required")
                      .map((r) => (
                        <div key={r.id} className="flex items-center gap-1.5 text-xs">
                          <span className="w-24 text-slate-600">{AUTHORITY_LABEL[r.authority]}</span>
                          <RequirementStatusBadge status={r.status} />
                        </div>
                      ))}
                  </div>
                </td>
                <td className="px-2 py-2">
                  <SimpleStatusBadge status={c.simple} />
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-col items-start gap-1">
                    <OverallStatusBadge status={c.overall_status} />
                    <ActivationBadge blocked={c.activation_blocked} />
                  </div>
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Avatar name={ownerName} />
                    <span className="text-slate-600">{ownerName ?? "Unassigned"}</span>
                  </div>
                </td>
                <td className="px-2 py-2 text-xs">{PRIORITY_LABEL[c.business_priority]}</td>
                <td className="px-2 py-2 text-xs">{formatDate(c.target_provider_submission_date)}</td>
                <td className={`px-2 py-2 text-xs ${stalled ? "font-medium text-amber-700" : "text-slate-600"}`}>
                  {daysSince(c.updated_at)}d ago{stalled ? " · stalled" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "text-slate-900",
  hint,
  small,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: string;
  hint?: string;
  small?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 font-semibold ${small ? "text-xl" : "text-3xl"} ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </>
  );
  const cls = `rounded-lg bg-white px-4 py-3 text-left shadow-sm ring-1 ${active ? "ring-2 ring-slate-900" : "ring-slate-200"}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} hover:bg-slate-50`} aria-pressed={active}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
