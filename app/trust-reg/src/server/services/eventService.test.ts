import { describe, expect, it } from "vitest";
import { AUDIT_CSV_COLUMNS, auditEventsToCsv, type AuditEventRow } from "./eventService";

const row = (over: Partial<AuditEventRow> = {}): AuditEventRow => ({
  id: "e1",
  trust_case_id: "c1",
  registration_requirement_id: null,
  event_type: "case_created",
  previous_status: null,
  new_status: null,
  comment: null,
  metadata_json: null,
  performed_by: "u1",
  performed_at: "2026-09-13T10:00:00.000Z",
  created_at: "2026-09-13T10:00:00.000Z",
  updated_at: "2026-09-13T10:00:00.000Z",
  case_reference: "NTR-2026-000001",
  trust_name: "Hartley Family Settlement",
  ...over,
});

describe("auditEventsToCsv", () => {
  it("writes a header row even with no events", () => {
    expect(auditEventsToCsv([])).toBe(AUDIT_CSV_COLUMNS.join(",") + "\r\n");
  });

  it("quotes commas, quotes and newlines", () => {
    const csv = auditEventsToCsv([row({ comment: 'Said "no", twice\nthen left', trust_name: "Smith, John" })]);
    const line = csv.split("\r\n")[1];
    expect(line).toContain('"Said ""no"", twice\nthen left"');
    expect(line).toContain('"Smith, John"');
  });

  it("renders nulls as empty cells and keeps column order", () => {
    const csv = auditEventsToCsv([row({ previous_status: "a", new_status: "b" })]);
    const cells = csv.split("\r\n")[1].split(",");
    expect(cells[0]).toBe("2026-09-13T10:00:00.000Z");
    expect(cells[1]).toBe("NTR-2026-000001");
    expect(cells[4]).toBe("a");
    expect(cells[5]).toBe("b");
    expect(cells[6]).toBe("");
  });
});
