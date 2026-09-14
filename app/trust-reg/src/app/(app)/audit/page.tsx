"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/session/SessionProvider";
import type { EventType } from "@/server/domain/types";
import { EVENT_TYPES } from "@/server/domain/types";
import { auditEventsToCsv } from "@/server/services/eventService";
import type { AuditEventRow } from "@/lib/api";
import { EVENT_LABEL, formatDate } from "@/lib/labels";
import { Alert, Button, Card, Empty, Input, Select, Spinner } from "@/components/ui";

// Cross-case audit view backed by /api/events. Filters are applied server-side (or in the mock
// data layer) and the CSV export contains exactly what is on screen.
export default function AuditPage() {
  const { api, user } = useSession();
  const [rows, setRows] = useState<AuditEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<EventType | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .listAllEvents({
        type: type || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
      })
      .then((all) => {
        if (cancelled) return;
        setRows(all);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load audit log"));
    return () => {
      cancelled = true;
    };
  }, [api, user?.role, type, from, to]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const needle = q.toLowerCase();
    return rows.filter((r) => !needle || [r.case_reference, r.trust_name, r.comment ?? "", r.performed_by].some((v) => v.toLowerCase().includes(needle)));
  }, [rows, q]);

  const exportCsv = () => {
    if (!filtered) return;
    const blob = new Blob([auditEventsToCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trust-registration-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Audit log</h1>
          <p className="text-sm text-slate-600">Append-only record of every action across all cases.</p>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={!filtered || filtered.length === 0}>
          Export CSV
        </Button>
      </div>
      <Card
        title={filtered ? `${filtered.length} events` : "Events"}
        actions={
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Search reference, trust, comment or user" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
            <Select value={type} onChange={(e) => setType(e.target.value as EventType | "")} className="w-52">
              <option value="">All event types</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_LABEL[t]}
                </option>
              ))}
            </Select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From date" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To date" />
          </div>
        }
      >
        {error && <Alert tone="error">{error}</Alert>}
        {!filtered && !error && <Spinner />}
        {filtered && filtered.length === 0 && <Empty>No events match.</Empty>}
        {filtered && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-2">When</th>
                  <th className="px-2 py-2">Case</th>
                  <th className="px-2 py-2">Event</th>
                  <th className="px-2 py-2">Change</th>
                  <th className="px-2 py-2">Comment</th>
                  <th className="px-2 py-2">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-600">{formatDate(r.performed_at, true)}</td>
                    <td className="px-2 py-2">
                      <Link href={`/cases/${r.trust_case_id}`} className="font-mono text-xs underline-offset-2 hover:underline">
                        {r.case_reference}
                      </Link>
                      <div className="text-xs text-slate-500">{r.trust_name}</div>
                    </td>
                    <td className="px-2 py-2 text-xs font-medium">{EVENT_LABEL[r.event_type]}</td>
                    <td className="px-2 py-2 text-xs text-slate-600">
                      {r.previous_status || r.new_status ? `${r.previous_status ?? "—"} → ${r.new_status ?? "—"}` : ""}
                    </td>
                    <td className="max-w-md px-2 py-2 text-xs text-slate-700">{r.comment}</td>
                    <td className="px-2 py-2 font-mono text-[11px] text-slate-500">{r.performed_by.slice(-6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
