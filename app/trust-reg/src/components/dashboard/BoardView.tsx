"use client";

import Link from "next/link";
import type { OverallStatus, RequirementStatus } from "@/server/domain/types";
import { OVERALL_STATUSES } from "@/server/domain/types";
import { simpleRequirementStatus } from "@/server/workflow/deriveSimpleStatus";
import { AUTHORITY_LABEL, OVERALL_STATUS_LABEL, PRIORITY_LABEL, formatDate } from "@/lib/labels";
import { isPastTarget, type DashboardRow } from "@/lib/dashboardRows";
import { daysSince, isStalled } from "@/lib/staleness";

// Asana-style board: one column ("section") per workflow status, one card per case.
// Status is derived from the workflow, so cards are not draggable; click a card to work the case.

const COLUMN_DOT: Record<OverallStatus, string> = {
  requirement_review: "bg-slate-400",
  blocked: "bg-amber-500",
  registration_in_progress: "bg-blue-500",
  overdue: "bg-red-500",
  ready_for_provider: "bg-emerald-500",
  handed_back_to_wm: "bg-violet-500",
  closed: "bg-zinc-400",
};

const REQ_DOT: Record<"not_started" | "in_progress" | "completed", string> = {
  not_started: "bg-slate-300",
  in_progress: "bg-blue-500",
  completed: "bg-emerald-500",
};

const PRIORITY_PILL: Record<DashboardRow["business_priority"], string | null> = {
  standard: null,
  urgent: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

const AUTHORITY_CHIP = {
  trs: "bg-sky-100 text-sky-800",
  crbot: "bg-green-100 text-green-800",
} as const;

export type OwnerNames = Record<string, string>;

export function BoardView({ rows, canCreate, owners = {} }: { rows: DashboardRow[]; canCreate: boolean; owners?: OwnerNames }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-6 md:px-6">
      <div className="flex min-w-max items-start gap-4">
        {OVERALL_STATUSES.map((status) => {
          const cards = rows.filter((r) => r.overall_status === status);
          return (
            <section key={status} className="flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/80 p-2" aria-label={OVERALL_STATUS_LABEL[status]}>
              <header className="flex items-center gap-2 px-2 py-2">
                <span className={`h-2.5 w-2.5 rounded-full ${COLUMN_DOT[status]}`} aria-hidden />
                <h2 className="text-sm font-semibold text-slate-800">{OVERALL_STATUS_LABEL[status]}</h2>
                <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">{cards.length}</span>
              </header>

              <div className="flex flex-col gap-2 px-0.5">
                {cards.map((c) => (
                  <BoardCard key={c.id} row={c} ownerName={c.assigned_aep_user_id ? owners[c.assigned_aep_user_id] : undefined} />
                ))}
                {cards.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400">No cases</p>}
              </div>

              {status === "requirement_review" && canCreate && (
                <Link href="/cases/new" className="mt-2 rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-white hover:text-slate-800">
                  + New request
                </Link>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardCard({ row, ownerName }: { row: DashboardRow; ownerName?: string }) {
  const late = isPastTarget(row);
  const stalled = isStalled(row);
  const idle = daysSince(row.updated_at);
  const priority = PRIORITY_PILL[row.business_priority];
  const required = row.requirements.filter((r) => r.requirement_status === "required");

  return (
    <Link
      href={`/cases/${row.id}`}
      className={`group block rounded-lg bg-white p-3 shadow-sm ring-1 transition hover:-translate-y-px hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${
        stalled ? "ring-amber-300 hover:ring-amber-400" : "ring-slate-200 hover:ring-slate-300"
      }`}
    >
      {(priority || required.length > 0 || stalled) && (
        <div className="mb-2 flex flex-wrap gap-1">
          {priority && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${priority}`}>{PRIORITY_LABEL[row.business_priority]}</span>}
          {required.map((r) => (
            <span key={r.id} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${AUTHORITY_CHIP[r.authority]}`}>
              {AUTHORITY_LABEL[r.authority]}
            </span>
          ))}
          {stalled && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">No activity {idle}d</span>}
        </div>
      )}

      <div className="text-sm font-medium leading-snug text-slate-900 group-hover:underline group-hover:underline-offset-2">{row.trust_name}</div>
      <div className="mt-0.5 truncate text-xs text-slate-500">
        {row.client_display_name} · {row.provider_name}
      </div>

      {required.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Registration progress">
          {required.map((r) => (
            <li key={r.id} className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <span className={`h-1.5 w-1.5 rounded-full ${REQ_DOT[simpleRequirementStatus(r.status)]}`} aria-hidden />
              <span className="w-10 shrink-0 uppercase tracking-wide text-slate-400">{r.authority}</span>
              <span className="truncate">{requirementShort(r.status)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Avatar name={row.assigned_aep_user_id ? ownerName ?? "AEP" : undefined} />
          <span className={`flex items-center gap-1 text-[11px] ${late ? "font-medium text-red-600" : "text-slate-500"}`}>
            <CalendarIcon />
            {row.target_provider_submission_date ? formatDate(row.target_provider_submission_date) : "No target"}
          </span>
        </div>
        <span className="font-mono text-[10px] text-slate-400">{row.case_reference}</span>
      </div>
    </Link>
  );
}

export function requirementShort(status: RequirementStatus): string {
  switch (status) {
    case "requirement_review":
      return "Decision pending";
    case "not_started":
      return "Not started";
    case "awaiting_information":
      return "Awaiting info";
    case "ready_to_register":
      return "Ready";
    case "registration_in_progress":
      return "Registering";
    case "submitted":
      return "Submitted";
    case "authority_query":
      return "Authority query";
    case "completed_pending_evidence":
      return "Awaiting verification";
    case "evidence_rejected":
      return "Evidence rejected";
    case "verified_completed":
      return "Verified";
    case "not_required":
      return "Not required";
    case "cancelled":
      return "Cancelled";
  }
}

export function initials(name: string): string {
  const parts = name.replace(/^Dev\s+/i, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name }: { name?: string }) {
  return name ? (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-white" title={name}>
      {initials(name)}
    </span>
  ) : (
    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-300" title="Unassigned" aria-label="Unassigned">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
      </svg>
    </span>
  );
}

function CalendarIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
