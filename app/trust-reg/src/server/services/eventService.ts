import { createServiceClient } from "@/lib/supabase/service";
import type { EventType, EventRow } from "@/server/domain/types";

export interface RecordEventInput {
  trustCaseId: string;
  registrationRequirementId?: string;
  eventType: EventType;
  previousStatus?: string;
  newStatus?: string;
  comment?: string;
  metadataJson?: Record<string, unknown>;
  performedBy: string;
}

// The only write path into the append-only registration_events table.
export async function recordEvent(input: RecordEventInput): Promise<{ success: boolean; error?: string }> {
  const client = createServiceClient();

  const { error } = await client.from("registration_events").insert({
    trust_case_id: input.trustCaseId,
    registration_requirement_id: input.registrationRequirementId,
    event_type: input.eventType,
    previous_status: input.previousStatus,
    new_status: input.newStatus,
    comment: input.comment,
    metadata_json: input.metadataJson,
    performed_by: input.performedBy,
  });

  if (error) {
    console.error("Failed to record event:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function listEventsForCase(trustCaseId: string): Promise<EventRow[]> {
  const client = createServiceClient();

  const { data, error } = await client
    .from("registration_events")
    .select("*")
    .eq("trust_case_id", trustCaseId)
    .order("performed_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch events: ${error.message}`);
  }

  return (data ?? []) as EventRow[];
}

// Cross-case audit row: the event plus the case reference and trust name it belongs to.
export interface AuditEventRow extends EventRow {
  case_reference: string;
  trust_name: string;
}

export interface ListEventsFilter {
  eventType?: EventType;
  trustCaseId?: string;
  from?: Date;
  to?: Date;
  wmTeam?: string;
  limit?: number;
}

export async function listEvents(filter: ListEventsFilter = {}): Promise<AuditEventRow[]> {
  const client = createServiceClient();

  let query = client
    .from("registration_events")
    .select("*, trust_cases!inner(case_reference, trust_name, requesting_wm_team)")
    .order("performed_at", { ascending: false })
    .limit(filter.limit ?? 2000);

  if (filter.eventType) query = query.eq("event_type", filter.eventType);
  if (filter.trustCaseId) query = query.eq("trust_case_id", filter.trustCaseId);
  if (filter.from) query = query.gte("performed_at", filter.from.toISOString());
  if (filter.to) query = query.lte("performed_at", filter.to.toISOString());
  if (filter.wmTeam) query = query.eq("trust_cases.requesting_wm_team", filter.wmTeam);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch audit events: ${error.message}`);

  return (data ?? []).map((row) => {
    const { trust_cases, ...event } = row as EventRow & {
      trust_cases: { case_reference: string; trust_name: string } | { case_reference: string; trust_name: string }[];
    };
    const tc = Array.isArray(trust_cases) ? trust_cases[0] : trust_cases;
    return { ...event, case_reference: tc?.case_reference ?? "", trust_name: tc?.trust_name ?? "" } as AuditEventRow;
  });
}

// Compliance export. Pure so the browser can produce the same file from the mock data.
export const AUDIT_CSV_COLUMNS = [
  "performed_at",
  "case_reference",
  "trust_name",
  "event_type",
  "previous_status",
  "new_status",
  "comment",
  "performed_by",
  "trust_case_id",
  "registration_requirement_id",
  "id",
] as const;

export function auditEventsToCsv(rows: AuditEventRow[]): string {
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [AUDIT_CSV_COLUMNS.join(",")];
  for (const r of rows) lines.push(AUDIT_CSV_COLUMNS.map((c) => cell(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}
