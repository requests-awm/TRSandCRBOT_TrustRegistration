// Mirrors the enums and row shapes in prisma/schema.prisma.
// The runtime talks to Postgres through supabase-js, so the app does not depend on a
// generated Prisma client. Keep this file in sync with the schema when enums change.

export const AUTHORITIES = ["trs", "crbot"] as const;
export type Authority = (typeof AUTHORITIES)[number];

export const REQUIREMENT_DECISION_STATUSES = ["required", "not_required", "under_review"] as const;
export type RequirementDecisionStatus = (typeof REQUIREMENT_DECISION_STATUSES)[number];

export const REQUIREMENT_STATUSES = [
  "requirement_review",
  "not_started",
  "awaiting_information",
  "ready_to_register",
  "registration_in_progress",
  "submitted",
  "authority_query",
  "completed_pending_evidence",
  "evidence_rejected",
  "verified_completed",
  "not_required",
  "cancelled",
] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const OVERALL_STATUSES = [
  "requirement_review",
  "overdue",
  "blocked",
  "registration_in_progress",
  "ready_for_provider",
  "handed_back_to_wm",
  "closed",
] as const;
export type OverallStatus = (typeof OVERALL_STATUSES)[number];

export const DOCUMENT_TYPES = [
  "trs_proof_of_registration",
  "trs_urn_confirmation",
  "trs_utr_confirmation",
  "crbot_registration_confirmation",
  "crbot_trust_register_number",
  "authority_correspondence",
  "supporting_document",
  "provider_submission_copy",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const VERIFICATION_STATUSES = ["pending", "verified", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const MALWARE_SCAN_STATUSES = ["pending", "clean", "infected", "failed"] as const;
export type MalwareScanStatus = (typeof MALWARE_SCAN_STATUSES)[number];

export const EVENT_TYPES = [
  "case_created",
  "requirement_added",
  "owner_assigned",
  "information_requested",
  "document_uploaded",
  "submitted_to_authority",
  "authority_query_received",
  "registration_completed",
  "evidence_verified",
  "wm_notified",
  "activation_unblocked",
  "case_reopened",
  "status_changed",
  "evidence_rejected",
  "requirement_cancelled",
  "case_handed_back",
  "case_closed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// The three-state view the WM team asked for. Derived, never stored.
export const SIMPLE_STATUSES = ["not_started", "in_progress", "completed"] as const;
export type SimpleStatus = (typeof SIMPLE_STATUSES)[number];

export const NOTIFICATION_DELIVERY_STATUSES = ["pending", "sent", "failed"] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export const USER_ROLES = [
  "wm_requester",
  "aep_processor",
  "aep_reviewer",
  "compliance_reviewer",
  "administrator",
  "auditor",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const BUSINESS_PRIORITIES = ["standard", "urgent", "critical"] as const;
export type BusinessPriority = (typeof BUSINESS_PRIORITIES)[number];

// ---- Row shapes (snake_case, as returned by supabase-js from trust_reg) ----

export interface TrustCaseRow {
  id: string;
  case_reference: string;
  insightly_id: string;
  client_display_name: string;
  trust_name: string;
  provider_name: string;
  provider_country: string;
  trust_type: string;
  trust_creation_date: string | null;
  requesting_wm_user_id: string;
  requesting_wm_team: string;
  assigned_aep_user_id: string | null;
  business_priority: BusinessPriority;
  overall_status: OverallStatus;
  activation_blocked: boolean;
  target_provider_submission_date: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  deletion_reason: string | null;
}

export interface ChecklistItem {
  key: string;
  label: string;
  completed: boolean;
}

export interface RequirementRow {
  id: string;
  trust_case_id: string;
  authority: Authority;
  requirement_status: RequirementDecisionStatus;
  requirement_reason: string | null;
  requirement_decided_by: string | null;
  requirement_decided_at: string | null;
  compliance_rule_id: string | null;
  registration_deadline: string | null;
  internal_target_date: string | null;
  status: RequirementStatus;
  assigned_to: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  authority_reference: string | null;
  completion_notes: string | null;
  checklist: ChecklistItem[] | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  registration_requirement_id: string;
  document_type: DocumentType;
  file_name: string;
  storage_key: string;
  mime_type: string;
  file_size: number;
  document_version: number;
  uploaded_by: string;
  uploaded_at: string;
  is_current: boolean;
  verification_status: VerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  malware_scan_status: MalwareScanStatus;
  file_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: string;
  trust_case_id: string;
  registration_requirement_id: string | null;
  event_type: EventType;
  previous_status: string | null;
  new_status: string | null;
  comment: string | null;
  metadata_json: Record<string, unknown> | null;
  performed_by: string;
  performed_at: string;
  created_at: string;
  updated_at: string;
}

export interface ProfileRow {
  id: string;
  role: UserRole;
  full_name: string | null;
  wm_team: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ComplianceRuleRow {
  id: string;
  authority: Authority;
  rule_name: string;
  effective_from: string;
  effective_to: string | null;
  deadline_days: number;
  rule_configuration_json: Record<string, unknown> | null;
  approved_by: string;
  approved_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TrustCaseWithRequirements extends TrustCaseRow {
  requirements: RequirementRow[];
}
