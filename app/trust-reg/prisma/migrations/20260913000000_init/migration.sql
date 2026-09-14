-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "trust_reg";

-- CreateEnum
CREATE TYPE "trust_reg"."authority" AS ENUM ('trs', 'crbot');

-- CreateEnum
CREATE TYPE "trust_reg"."requirement_status_decision" AS ENUM ('required', 'not_required', 'under_review');

-- CreateEnum
CREATE TYPE "trust_reg"."requirement_status" AS ENUM ('requirement_review', 'not_started', 'awaiting_information', 'ready_to_register', 'registration_in_progress', 'submitted', 'authority_query', 'completed_pending_evidence', 'evidence_rejected', 'verified_completed', 'not_required', 'cancelled');

-- CreateEnum
CREATE TYPE "trust_reg"."overall_status" AS ENUM ('requirement_review', 'overdue', 'blocked', 'registration_in_progress', 'ready_for_provider', 'handed_back_to_wm', 'closed');

-- CreateEnum
CREATE TYPE "trust_reg"."document_type" AS ENUM ('trs_proof_of_registration', 'trs_urn_confirmation', 'trs_utr_confirmation', 'crbot_registration_confirmation', 'crbot_trust_register_number', 'authority_correspondence', 'supporting_document', 'provider_submission_copy');

-- CreateEnum
CREATE TYPE "trust_reg"."verification_status" AS ENUM ('pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "trust_reg"."malware_scan_status" AS ENUM ('pending', 'clean', 'infected', 'failed');

-- CreateEnum
CREATE TYPE "trust_reg"."event_type" AS ENUM ('case_created', 'requirement_added', 'owner_assigned', 'information_requested', 'document_uploaded', 'submitted_to_authority', 'authority_query_received', 'registration_completed', 'evidence_verified', 'wm_notified', 'activation_unblocked', 'case_reopened', 'status_changed', 'evidence_rejected', 'requirement_cancelled', 'case_handed_back', 'case_closed');

-- CreateEnum
CREATE TYPE "trust_reg"."notification_delivery_status" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "trust_reg"."user_role" AS ENUM ('wm_requester', 'aep_processor', 'aep_reviewer', 'compliance_reviewer', 'administrator', 'auditor');

-- CreateEnum
CREATE TYPE "trust_reg"."business_priority" AS ENUM ('standard', 'urgent', 'critical');

-- CreateTable
CREATE TABLE "trust_reg"."trust_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_reference" TEXT NOT NULL,
    "insightly_id" TEXT NOT NULL,
    "client_display_name" TEXT NOT NULL,
    "trust_name" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL,
    "provider_country" TEXT NOT NULL,
    "trust_type" TEXT NOT NULL,
    "trust_creation_date" DATE,
    "requesting_wm_user_id" UUID NOT NULL,
    "requesting_wm_team" TEXT NOT NULL,
    "assigned_aep_user_id" UUID,
    "business_priority" "trust_reg"."business_priority" NOT NULL DEFAULT 'standard',
    "overall_status" "trust_reg"."overall_status" NOT NULL DEFAULT 'requirement_review',
    "activation_blocked" BOOLEAN NOT NULL DEFAULT true,
    "target_provider_submission_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ,
    "deletion_reason" TEXT,

    CONSTRAINT "trust_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_reg"."trust_registration_requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trust_case_id" UUID NOT NULL,
    "authority" "trust_reg"."authority" NOT NULL,
    "requirement_status" "trust_reg"."requirement_status_decision" NOT NULL DEFAULT 'under_review',
    "requirement_reason" TEXT,
    "requirement_decided_by" UUID,
    "requirement_decided_at" TIMESTAMPTZ,
    "compliance_rule_id" UUID,
    "registration_deadline" DATE,
    "internal_target_date" DATE,
    "status" "trust_reg"."requirement_status" NOT NULL DEFAULT 'requirement_review',
    "assigned_to" UUID,
    "submitted_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "verified_at" TIMESTAMPTZ,
    "verified_by" UUID,
    "authority_reference" TEXT,
    "completion_notes" TEXT,
    "checklist" JSONB DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_registration_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_reg"."registration_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "registration_requirement_id" UUID NOT NULL,
    "document_type" "trust_reg"."document_type" NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "document_version" INTEGER NOT NULL DEFAULT 1,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "verification_status" "trust_reg"."verification_status" NOT NULL DEFAULT 'pending',
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "malware_scan_status" "trust_reg"."malware_scan_status" NOT NULL DEFAULT 'pending',
    "file_hash" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_reg"."registration_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trust_case_id" UUID NOT NULL,
    "registration_requirement_id" UUID,
    "event_type" "trust_reg"."event_type" NOT NULL,
    "previous_status" TEXT,
    "new_status" TEXT,
    "comment" TEXT,
    "metadata_json" JSONB,
    "performed_by" UUID NOT NULL,
    "performed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_reg"."notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trust_case_id" UUID NOT NULL,
    "registration_requirement_id" UUID,
    "notification_type" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "scheduled_for" TIMESTAMPTZ,
    "sent_at" TIMESTAMPTZ,
    "delivery_status" "trust_reg"."notification_delivery_status" NOT NULL DEFAULT 'pending',
    "provider_message_id" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_reg"."compliance_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "authority" "trust_reg"."authority" NOT NULL,
    "rule_name" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "deadline_days" INTEGER NOT NULL,
    "rule_configuration_json" JSONB,
    "approved_by" UUID NOT NULL,
    "approved_at" TIMESTAMPTZ NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_reg"."case_reference_counters" (
    "year" INTEGER NOT NULL,
    "next_seq" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_reference_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "trust_reg"."profiles" (
    "id" UUID NOT NULL,
    "role" "trust_reg"."user_role" NOT NULL,
    "full_name" TEXT,
    "wm_team" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trust_cases_case_reference_key" ON "trust_reg"."trust_cases"("case_reference");

-- CreateIndex
CREATE UNIQUE INDEX "trust_registration_requirements_trust_case_id_authority_key" ON "trust_reg"."trust_registration_requirements"("trust_case_id", "authority");

-- AddForeignKey
ALTER TABLE "trust_reg"."trust_registration_requirements" ADD CONSTRAINT "trust_registration_requirements_trust_case_id_fkey" FOREIGN KEY ("trust_case_id") REFERENCES "trust_reg"."trust_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_reg"."trust_registration_requirements" ADD CONSTRAINT "trust_registration_requirements_compliance_rule_id_fkey" FOREIGN KEY ("compliance_rule_id") REFERENCES "trust_reg"."compliance_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_reg"."registration_documents" ADD CONSTRAINT "registration_documents_registration_requirement_id_fkey" FOREIGN KEY ("registration_requirement_id") REFERENCES "trust_reg"."trust_registration_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_reg"."registration_events" ADD CONSTRAINT "registration_events_trust_case_id_fkey" FOREIGN KEY ("trust_case_id") REFERENCES "trust_reg"."trust_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_reg"."registration_events" ADD CONSTRAINT "registration_events_registration_requirement_id_fkey" FOREIGN KEY ("registration_requirement_id") REFERENCES "trust_reg"."trust_registration_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_reg"."notifications" ADD CONSTRAINT "notifications_trust_case_id_fkey" FOREIGN KEY ("trust_case_id") REFERENCES "trust_reg"."trust_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_reg"."notifications" ADD CONSTRAINT "notifications_registration_requirement_id_fkey" FOREIGN KEY ("registration_requirement_id") REFERENCES "trust_reg"."trust_registration_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

