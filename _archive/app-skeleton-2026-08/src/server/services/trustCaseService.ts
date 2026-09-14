import { createServiceClient } from "@/lib/supabase/service";
import { generateCaseReference } from "@/server/workflow/caseReference";
import { recordEvent } from "./eventService";
import { AuthUser } from "@/server/auth/roles";

export interface CreateTrustCaseInput {
  insightlyId: string;
  clientDisplayName: string;
  trustName: string;
  providerName: string;
  providerCountry: string;
  trustType: string;
  trustCreationDate?: Date;
  requestingWmTeam: string;
  businessPriority: "standard" | "urgent" | "critical";
  targetProviderSubmissionDate?: Date;
}

// Create a new trust case.
// Generates a unique case reference (NTR-YYYY-######).
// Emits a case_created event.
export async function createTrustCase(input: CreateTrustCaseInput, actor: AuthUser) {
  const client = createServiceClient();
  const caseReference = await generateCaseReference();

  const { data: caseData, error: insertError } = await client
    .from("trust_cases")
    .insert({
      case_reference: caseReference,
      insightly_id: input.insightlyId,
      client_display_name: input.clientDisplayName,
      trust_name: input.trustName,
      provider_name: input.providerName,
      provider_country: input.providerCountry,
      trust_type: input.trustType,
      trust_creation_date: input.trustCreationDate?.toISOString().split("T")[0],
      requesting_wm_user_id: actor.id,
      requesting_wm_team: input.requestingWmTeam,
      business_priority: input.businessPriority,
      target_provider_submission_date: input.targetProviderSubmissionDate?.toISOString().split("T")[0],
    })
    .select()
    .single();

  if (insertError || !caseData) {
    throw new Error(`Failed to create trust case: ${insertError?.message}`);
  }

  // Record the creation event
  await recordEvent({
    trustCaseId: caseData.id,
    eventType: "case_created",
    comment: `Case created by ${actor.email}`,
    performedBy: actor.id,
    metadataJson: {
      caseReference,
      trustName: input.trustName,
    },
  });

  return caseData;
}

// Get a single trust case by ID.
export async function getTrustCase(caseId: string) {
  const client = createServiceClient();

  const { data, error } = await client
    .from("trust_cases")
    .select("*, requirements:trust_registration_requirements(*)")
    .eq("id", caseId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch trust case: ${error.message}`);
  }

  return data;
}

// List trust cases, optionally filtered by WM team.
export async function listTrustCases(filter?: { wmTeam?: string; status?: string; isDeleted?: boolean }) {
  const client = createServiceClient();

  let query = client
    .from("trust_cases")
    .select("*, requirements:trust_registration_requirements(count)");

  if (filter?.wmTeam) {
    query = query.eq("requesting_wm_team", filter.wmTeam);
  }

  if (filter?.status) {
    query = query.eq("overall_status", filter.status);
  }

  if (filter?.isDeleted !== undefined) {
    query = query.eq("is_deleted", filter.isDeleted);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list trust cases: ${error.message}`);
  }

  return data;
}
