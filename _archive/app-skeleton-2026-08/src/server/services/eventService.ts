import { createServiceClient } from "@/lib/supabase/service";
import { EventType, RequirementStatus } from "@prisma/client";

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

// Record an event in the immutable registration_events table.
// This is the ONLY way to write to registration_events.
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

// Helper: record a status transition event
export async function recordStatusTransition(
  trustCaseId: string,
  requirementId: string,
  previousStatus: RequirementStatus,
  newStatus: RequirementStatus,
  actor: string,
  comment?: string
): Promise<{ success: boolean; error?: string }> {
  return recordEvent({
    trustCaseId,
    registrationRequirementId: requirementId,
    eventType: "case_created", // Will be overridden; this is just a placeholder
    previousStatus,
    newStatus,
    comment,
    performedBy: actor,
  });
}
