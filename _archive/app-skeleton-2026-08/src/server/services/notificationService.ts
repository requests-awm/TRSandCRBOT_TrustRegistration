import { createServiceClient } from "@/lib/supabase/service";
import { recordEvent } from "./eventService";

export interface NotificationPayload {
  recipient: string;
  templateType:
    | "ready_for_provider"
    | "authority_query"
    | "evidence_rejected"
    | "evidence_verified"
    | "deadline_approaching";
  payload: Record<string, unknown>;
}

export interface NotificationProvider {
  send(
    input: NotificationPayload
  ): Promise<{ success: boolean; providerMessageId?: string; error?: string }>;
}

// Console provider: logs to stdout and writes to notifications table.
// For MVP. Later: swap in SendGrid, Resend, or AWS SES.
export class ConsoleNotificationProvider implements NotificationProvider {
  async send(input: NotificationPayload): Promise<{ success: boolean; providerMessageId?: string }> {
    const client = createServiceClient();

    // Log to console
    console.log("[NOTIFICATION]", JSON.stringify(input, null, 2));

    // Write to notifications table
    const { data: notification, error } = await client
      .from("notifications")
      .insert({
        // TODO: need trustCaseId and registrationRequirementId — pass them in the payload
        notification_type: input.templateType,
        recipient: input.recipient,
        delivery_status: "sent",
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to write notification record:", error);
      return { success: false, error: error.message };
    }

    return { success: true, providerMessageId: notification?.id };
  }
}

// Factory: create the configured provider
function getNotificationProvider(): NotificationProvider {
  const providerName = process.env.NOTIFICATION_PROVIDER || "console";

  switch (providerName) {
    case "console":
      return new ConsoleNotificationProvider();
    // Future: case "sendgrid": return new SendGridNotificationProvider();
    default:
      console.warn(`Unknown notification provider: ${providerName}, falling back to console`);
      return new ConsoleNotificationProvider();
  }
}

// Public: notify WM that the trust is ready for provider submission
export async function notifyWmReadyForProvider(
  trustCaseId: string,
  caseReference: string,
  trustName: string,
  provider: string,
  wmEmail: string
): Promise<{ success: boolean; error?: string }> {
  const provider_ = getNotificationProvider();

  const result = await provider_.send({
    recipient: wmEmail,
    templateType: "ready_for_provider",
    payload: {
      caseReference,
      trustName,
      provider,
      message: "All required registrations are complete and verified. The trust is ready for provider submission.",
    },
  });

  if (result.success) {
    // Record the notification event
    await recordEvent({
      trustCaseId,
      eventType: "wm_notified",
      comment: `WM team notified: trust ready for provider submission`,
      performedBy: "system", // System-generated notification
      metadataJson: {
        recipient: wmEmail,
        notificationType: "ready_for_provider",
      },
    });
  }

  return result;
}
