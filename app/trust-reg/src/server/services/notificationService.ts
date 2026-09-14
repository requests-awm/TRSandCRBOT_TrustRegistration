import { createServiceClient } from "@/lib/supabase/service";
import { recordEvent } from "./eventService";

export type NotificationTemplate =
  | "ready_for_provider"
  | "handed_back_to_wm"
  | "authority_query"
  | "evidence_rejected"
  | "evidence_verified"
  | "deadline_approaching";

export interface NotificationPayload {
  trustCaseId: string;
  registrationRequirementId?: string;
  recipient: string;
  templateType: NotificationTemplate;
  payload: Record<string, unknown>;
}

export interface NotificationSendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface RenderedMessage {
  subject: string;
  text: string;
  html: string;
}

export interface NotificationProvider {
  readonly name: string;
  deliver(to: string, message: RenderedMessage): Promise<NotificationSendResult>;
}

const APP_BASE_URL = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const FROM_EMAIL = process.env.NOTIFICATION_FROM_EMAIL ?? "trust-registration@ascotwm.com";

const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

// ---- Templates --------------------------------------------------------------------------------

export function renderNotification(template: NotificationTemplate, p: Record<string, unknown>): RenderedMessage {
  const ref = String(p.caseReference ?? "");
  const trust = String(p.trustName ?? "");
  const link = `${APP_BASE_URL}/cases/${String(p.trustCaseId ?? "")}`;
  const footer = `\n\nOpen the case: ${link}\n\nAWM Trust Registration (TRS / CRBOT)`;
  const wrap = (title: string, body: string[]) => ({
    subject: `[${ref}] ${title}`,
    text: `${title}\n\n${body.join("\n")}${footer}`,
    html:
      `<p><strong>${escapeHtml(title)}</strong></p>` +
      body.map((l) => `<p>${escapeHtml(l)}</p>`).join("") +
      `<p><a href="${escapeHtml(link)}">Open the case</a></p><p style="color:#64748b;font-size:12px">AWM Trust Registration (TRS / CRBOT)</p>`,
  });

  switch (template) {
    case "ready_for_provider":
      return wrap(`${trust}: registrations verified, ready for provider`, [
        `All required trust registrations for ${trust} (${ref}) are complete and verified by AEP.`,
        `Provider: ${String(p.provider ?? "")}.`,
        "The registration certificates can be downloaded from the case page and submitted to the provider as part of the trust setup.",
      ]);
    case "handed_back_to_wm":
      return wrap(`${trust}: registration pack handed back to WM`, [
        `AEP has handed ${trust} (${ref}) back to the WM team.`,
        ...(Array.isArray(p.certificates) ? (p.certificates as string[]).map((c) => `Certificate: ${c}`) : []),
        p.comment ? `Note from AEP: ${String(p.comment)}` : "",
        "Download the certificates from the case page and submit them to the provider. Close the case once the provider has accepted the trust.",
      ].filter(Boolean));
    case "authority_query":
      return wrap(`${trust}: query raised by ${String(p.authority ?? "the registration authority")}`, [
        `The registration authority has raised a query on ${trust} (${ref}).`,
        p.comment ? `Details: ${String(p.comment)}` : "",
        "AEP may need information from the WM team to resolve it.",
      ].filter(Boolean));
    case "evidence_rejected":
      return wrap(`${trust}: evidence rejected`, [
        `A registration document for ${trust} (${ref}) was rejected at review.`,
        p.reason ? `Reason: ${String(p.reason)}` : "",
      ].filter(Boolean));
    case "evidence_verified":
      return wrap(`${trust}: evidence verified`, [`A registration document for ${trust} (${ref}) has been verified.`]);
    case "deadline_approaching":
      return wrap(`${trust}: ${String(p.authority ?? "")} registration deadline in ${String(p.daysRemaining ?? "?")} days`, [
        `The statutory registration deadline for ${trust} (${ref}) is ${String(p.deadline ?? "")}.`,
        `Current status: ${String(p.status ?? "")}.`,
      ]);
  }
}

// ---- Providers --------------------------------------------------------------------------------

// MVP provider: prints the message. Still records the attempt in trust_reg.notifications.
export class ConsoleNotificationProvider implements NotificationProvider {
  readonly name = "console";
  async deliver(to: string, message: RenderedMessage): Promise<NotificationSendResult> {
    console.log("[NOTIFICATION]", JSON.stringify({ to, subject: message.subject, text: message.text }, null, 2));
    return { success: true, providerMessageId: `console-${Date.now()}` };
  }
}

// Resend (https://resend.com). Set NOTIFICATION_PROVIDER=resend and RESEND_API_KEY.
export class ResendNotificationProvider implements NotificationProvider {
  readonly name = "resend";
  async deliver(to: string, message: RenderedMessage): Promise<NotificationSendResult> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { success: false, error: "RESEND_API_KEY is not set" };
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject: message.subject, text: message.text, html: message.html }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { success: false, error: body.message ?? `Resend responded ${res.status}` };
    return { success: true, providerMessageId: body.id };
  }
}

// SendGrid. Set NOTIFICATION_PROVIDER=sendgrid and SENDGRID_API_KEY.
export class SendGridNotificationProvider implements NotificationProvider {
  readonly name = "sendgrid";
  async deliver(to: string, message: RenderedMessage): Promise<NotificationSendResult> {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) return { success: false, error: "SENDGRID_API_KEY is not set" };
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: FROM_EMAIL },
        subject: message.subject,
        content: [
          { type: "text/plain", value: message.text },
          { type: "text/html", value: message.html },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, error: `SendGrid responded ${res.status}: ${text.slice(0, 200)}` };
    }
    return { success: true, providerMessageId: res.headers.get("x-message-id") ?? undefined };
  }
}

export function getNotificationProvider(): NotificationProvider {
  switch ((process.env.NOTIFICATION_PROVIDER || "console").toLowerCase()) {
    case "resend":
      return new ResendNotificationProvider();
    case "sendgrid":
      return new SendGridNotificationProvider();
    case "console":
      return new ConsoleNotificationProvider();
    default:
      console.warn(`Unknown NOTIFICATION_PROVIDER "${process.env.NOTIFICATION_PROVIDER}", falling back to console`);
      return new ConsoleNotificationProvider();
  }
}

// ---- Sending ----------------------------------------------------------------------------------

// Writes the notifications row first (pending), delivers, then marks it sent or failed so a
// delivery failure is visible in the database rather than lost in a log.
export async function sendNotification(input: NotificationPayload): Promise<NotificationSendResult> {
  const client = createServiceClient();
  const provider = getNotificationProvider();
  const message = renderNotification(input.templateType, { ...input.payload, trustCaseId: input.trustCaseId });

  const { data: row, error: insertError } = await client
    .from("notifications")
    .insert({
      trust_case_id: input.trustCaseId,
      registration_requirement_id: input.registrationRequirementId ?? null,
      notification_type: input.templateType,
      recipient: input.recipient,
      delivery_status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !row) {
    console.error("Failed to write notification record:", insertError);
    return { success: false, error: insertError?.message ?? "notification insert failed" };
  }

  let result: NotificationSendResult;
  try {
    result = await provider.deliver(input.recipient, message);
  } catch (err) {
    result = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  await client
    .from("notifications")
    .update({
      delivery_status: result.success ? "sent" : "failed",
      sent_at: result.success ? new Date().toISOString() : null,
      provider_message_id: result.providerMessageId ?? null,
      error_message: result.error ?? null,
    })
    .eq("id", row.id);

  return result;
}

// Email lives in auth.users, not in trust_reg.profiles. The service role can read it via the admin API.
export async function resolveUserEmail(userId: string): Promise<string | null> {
  try {
    const client = createServiceClient();
    const { data, error } = await client.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) return null;
    return data.user.email;
  } catch {
    return null;
  }
}

// Recent duplicate guard for scheduled notifications (deadline reminders run daily).
export async function wasNotifiedRecently(input: {
  trustCaseId: string;
  registrationRequirementId?: string;
  templateType: NotificationTemplate;
  withinHours: number;
}): Promise<boolean> {
  const client = createServiceClient();
  const since = new Date(Date.now() - input.withinHours * 3600 * 1000).toISOString();
  let query = client
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("trust_case_id", input.trustCaseId)
    .eq("notification_type", input.templateType)
    .in("delivery_status", ["sent", "pending"])
    .gte("created_at", since);
  if (input.registrationRequirementId) query = query.eq("registration_requirement_id", input.registrationRequirementId);
  const { count } = await query;
  return (count ?? 0) > 0;
}

// ---- Business notifications -------------------------------------------------------------------

export interface WmNotificationContext {
  trustCaseId: string;
  caseReference: string;
  trustName: string;
  providerName: string;
  requestingWmUserId: string;
  actorId: string;
}

async function wmRecipient(ctx: WmNotificationContext): Promise<string> {
  const email = await resolveUserEmail(ctx.requestingWmUserId);
  if (email) return email;
  const fallback = process.env.WM_FALLBACK_EMAIL;
  if (fallback) return fallback;
  return ctx.requestingWmUserId;
}

export async function notifyWmReadyForProvider(ctx: WmNotificationContext): Promise<NotificationSendResult> {
  const recipient = await wmRecipient(ctx);
  const result = await sendNotification({
    trustCaseId: ctx.trustCaseId,
    recipient,
    templateType: "ready_for_provider",
    payload: { caseReference: ctx.caseReference, trustName: ctx.trustName, provider: ctx.providerName },
  });

  await recordEvent({
    trustCaseId: ctx.trustCaseId,
    eventType: "wm_notified",
    comment: result.success
      ? "WM team notified: trust ready for provider submission"
      : `WM notification failed: ${result.error ?? "unknown error"}`,
    performedBy: ctx.actorId,
    metadataJson: { recipient, notificationType: "ready_for_provider", success: result.success },
  });

  return result;
}

export async function notifyWmHandedBack(
  ctx: WmNotificationContext & { comment?: string; certificates: string[] }
): Promise<NotificationSendResult> {
  const recipient = await wmRecipient(ctx);
  const result = await sendNotification({
    trustCaseId: ctx.trustCaseId,
    recipient,
    templateType: "handed_back_to_wm",
    payload: {
      caseReference: ctx.caseReference,
      trustName: ctx.trustName,
      provider: ctx.providerName,
      comment: ctx.comment,
      certificates: ctx.certificates,
    },
  });

  await recordEvent({
    trustCaseId: ctx.trustCaseId,
    eventType: "wm_notified",
    comment: result.success ? "WM team notified: registration pack handed back" : `WM notification failed: ${result.error ?? "unknown error"}`,
    performedBy: ctx.actorId,
    metadataJson: { recipient, notificationType: "handed_back_to_wm", success: result.success },
  });

  return result;
}

export async function notifyDeadlineApproaching(input: {
  trustCaseId: string;
  registrationRequirementId: string;
  caseReference: string;
  trustName: string;
  authority: string;
  deadline: string;
  daysRemaining: number;
  status: string;
  recipient: string;
}): Promise<NotificationSendResult> {
  return sendNotification({
    trustCaseId: input.trustCaseId,
    registrationRequirementId: input.registrationRequirementId,
    recipient: input.recipient,
    templateType: "deadline_approaching",
    payload: {
      caseReference: input.caseReference,
      trustName: input.trustName,
      authority: input.authority,
      deadline: input.deadline,
      daysRemaining: input.daysRemaining,
      status: input.status,
    },
  });
}
