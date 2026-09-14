import { NextRequest, NextResponse } from "next/server";
import { runDailyJobs } from "@/server/services/jobService";
import { toErrorResponse } from "@/server/http/errors";

// GET or POST /api/jobs/daily — recompute open cases (overdue detection) and send deadline reminders.
// Called by a scheduler (vercel.json cron, or any cron hitting the URL) with
//   Authorization: Bearer $CRON_SECRET
// Vercel cron sends that header automatically when CRON_SECRET is set on the project.
async function handle(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "CRON_SECRET is not configured; the daily job is disabled" }, { status: 503 });
    }
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const report = await runDailyJobs();
    return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const GET = handle;
export const POST = handle;
