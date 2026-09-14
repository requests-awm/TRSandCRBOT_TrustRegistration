import { createServiceClient } from "@/lib/supabase/service";
import type { RequirementRow, TrustCaseRow } from "@/server/domain/types";
import { recomputeCaseDerivedState } from "./requirementService";
import { notifyDeadlineApproaching, resolveUserEmail, wasNotifiedRecently } from "./notificationService";
import type { AuthUser } from "@/server/auth/roles";

// Runs once a day (see /api/jobs/daily). Two jobs:
// 1. Recompute every open case so a passed deadline flips the case to "overdue" without anyone
//    having to touch it.
// 2. Warn the assigned AEP owner (or the fallback mailbox) when a required registration is within
//    DEADLINE_WARNING_DAYS of its statutory deadline and still unfinished.

export const SYSTEM_ACTOR: AuthUser = {
  id: process.env.SYSTEM_USER_ID ?? "00000000-0000-4000-8000-000000000000",
  email: "system@trust-registration",
  role: "administrator",
  fullName: "Scheduled job",
  isActive: true,
};

const OPEN_STATUSES = ["requirement_review", "overdue", "blocked", "registration_in_progress", "ready_for_provider"];
const UNFINISHED = ["not_started", "awaiting_information", "ready_to_register", "registration_in_progress", "submitted", "authority_query", "completed_pending_evidence", "evidence_rejected"];

export interface DailyJobReport {
  ranAt: string;
  casesRecomputed: number;
  recomputeErrors: string[];
  remindersSent: number;
  remindersSkipped: number;
  reminderErrors: string[];
}

export async function runDailyJobs(now: Date = new Date()): Promise<DailyJobReport> {
  const report: DailyJobReport = {
    ranAt: now.toISOString(),
    casesRecomputed: 0,
    recomputeErrors: [],
    remindersSent: 0,
    remindersSkipped: 0,
    reminderErrors: [],
  };
  const client = createServiceClient();

  const { data: cases, error } = await client
    .from("trust_cases")
    .select("*")
    .eq("is_deleted", false)
    .in("overall_status", OPEN_STATUSES);
  if (error) throw new Error(`Daily job: failed to list open cases: ${error.message}`);

  for (const c of (cases ?? []) as TrustCaseRow[]) {
    try {
      await recomputeCaseDerivedState(c.id, SYSTEM_ACTOR);
      report.casesRecomputed++;
    } catch (err) {
      report.recomputeErrors.push(`${c.case_reference}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const warningDays = Number(process.env.DEADLINE_WARNING_DAYS ?? 14);
  const horizon = new Date(now.getTime() + warningDays * 86400 * 1000).toISOString().slice(0, 10);

  const { data: requirements, error: reqError } = await client
    .from("trust_registration_requirements")
    .select("*, trust_cases!inner(case_reference, trust_name, assigned_aep_user_id, is_deleted)")
    .eq("requirement_status", "required")
    .in("status", UNFINISHED)
    .not("registration_deadline", "is", null)
    .lte("registration_deadline", horizon);
  if (reqError) throw new Error(`Daily job: failed to list requirements near deadline: ${reqError.message}`);

  for (const raw of requirements ?? []) {
    const r = raw as RequirementRow & {
      trust_cases: { case_reference: string; trust_name: string; assigned_aep_user_id: string | null; is_deleted: boolean };
    };
    const tc = Array.isArray(r.trust_cases) ? r.trust_cases[0] : r.trust_cases;
    if (!tc || tc.is_deleted) continue;

    try {
      if (await wasNotifiedRecently({ trustCaseId: r.trust_case_id, registrationRequirementId: r.id, templateType: "deadline_approaching", withinHours: 20 })) {
        report.remindersSkipped++;
        continue;
      }
      const ownerId = r.assigned_to ?? tc.assigned_aep_user_id;
      const recipient = (ownerId && (await resolveUserEmail(ownerId))) || process.env.AEP_TEAM_EMAIL;
      if (!recipient) {
        report.reminderErrors.push(`${tc.case_reference} ${r.authority}: no recipient (set AEP_TEAM_EMAIL)`);
        continue;
      }
      const daysRemaining = Math.ceil((new Date(r.registration_deadline as string).getTime() - now.getTime()) / 86400000);
      const result = await notifyDeadlineApproaching({
        trustCaseId: r.trust_case_id,
        registrationRequirementId: r.id,
        caseReference: tc.case_reference,
        trustName: tc.trust_name,
        authority: r.authority.toUpperCase(),
        deadline: r.registration_deadline as string,
        daysRemaining,
        status: r.status,
        recipient,
      });
      if (result.success) report.remindersSent++;
      else report.reminderErrors.push(`${tc.case_reference} ${r.authority}: ${result.error}`);
    } catch (err) {
      report.reminderErrors.push(`${tc.case_reference} ${r.authority}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return report;
}
