"use client";

import type { EventRow } from "@/server/domain/types";
import { EVENT_LABEL, formatDate } from "@/lib/labels";
import { Empty } from "../ui";

const DOT: Partial<Record<EventRow["event_type"], string>> = {
  case_created: "bg-slate-400",
  activation_unblocked: "bg-emerald-500",
  evidence_verified: "bg-emerald-500",
  evidence_rejected: "bg-red-500",
  requirement_cancelled: "bg-red-500",
  authority_query_received: "bg-orange-500",
  information_requested: "bg-amber-500",
  submitted_to_authority: "bg-indigo-500",
  wm_notified: "bg-violet-500",
  case_handed_back: "bg-violet-600",
  case_closed: "bg-zinc-500",
};

export function Timeline({ events }: { events: EventRow[] }) {
  if (events.length === 0) return <Empty>No events recorded.</Empty>;
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${DOT[e.event_type] ?? "bg-blue-400"}`} />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-sm font-medium text-slate-900">{EVENT_LABEL[e.event_type]}</span>
            <time className="text-xs text-slate-500">{formatDate(e.performed_at, true)}</time>
          </div>
          {(e.previous_status || e.new_status) && (
            <div className="text-xs text-slate-600">
              {e.previous_status ?? "—"} → {e.new_status ?? "—"}
            </div>
          )}
          {e.comment && <p className="mt-0.5 text-sm text-slate-700">{e.comment}</p>}
          <div className="mt-0.5 font-mono text-[11px] text-slate-400">by …{e.performed_by.slice(-6)}</div>
        </li>
      ))}
    </ol>
  );
}
