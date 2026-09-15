import type { OverallStatus } from "@/server/domain/types";
import { publicConfig } from "@/lib/publicConfig";

// "How long is too long before someone is nudged" is a business decision (7, 14 or 28 days).
// Until it is confirmed the threshold is configuration (STALE_AFTER_DAYS), resolved at runtime.
export const STALE_AFTER_DAYS = publicConfig().staleAfterDays;

export const OPEN_STATUSES: OverallStatus[] = ["requirement_review", "blocked", "registration_in_progress", "overdue", "ready_for_provider"];

export function daysSince(iso: string | null | undefined, now: Date = new Date()): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000));
}

export function isOpen(status: OverallStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

// A case is stalled when it is still open and nothing has changed on it for the threshold period.
export function isStalled(row: { overall_status: OverallStatus; updated_at: string }, now: Date = new Date(), threshold = STALE_AFTER_DAYS): boolean {
  return isOpen(row.overall_status) && daysSince(row.updated_at, now) >= threshold;
}

export function agingBucket(days: number): "0-7" | "8-14" | "15-28" | "29+" {
  if (days <= 7) return "0-7";
  if (days <= 14) return "8-14";
  if (days <= 28) return "15-28";
  return "29+";
}
