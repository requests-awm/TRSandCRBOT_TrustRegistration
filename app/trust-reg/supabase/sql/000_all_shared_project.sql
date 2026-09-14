-- trust_reg: everything the shared AWM Supabase project needs, in order. Generated 2026-09-14.
-- Equivalent to running: prisma/migrations/20260913000000_init/migration.sql, 001_rls_and_constraints.sql, 003_storage.sql.
-- Do NOT include 002_seed_dev.sql (local dev users only).
-- Safe to paste into the Supabase SQL editor as the postgres role. Idempotent where Postgres allows.

BEGIN;

-- ===== 1/3 schema, enums, tables (Prisma migration) =====
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


-- ===== 2/3 RLS, constraints, triggers, RPC (001) =====
-- DRAFT — apply AFTER the Prisma migration has created the trust_reg schema and tables.
-- Owner: Tumisang. Coordinate with Colin before running against the shared AWM Supabase project.
--
-- What this adds that Prisma cannot express:
--   1. RLS on every trust_reg table, service-role-only (the Next.js API is the only client)
--   2. FK from trust_reg.profiles.id to auth.users.id
--   3. Append-only guard on registration_events (no UPDATE / DELETE, even for service_role)
--   4. Read grant for the Insightly join (public.insightly_contacts is read-only for this app)


-- 1. RLS ---------------------------------------------------------------------
ALTER TABLE trust_reg.trust_cases                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.trust_registration_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.registration_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.registration_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.notifications                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.compliance_rules               ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.profiles                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.case_reference_counters        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trust_cases', 'trust_registration_requirements', 'registration_documents',
    'registration_events', 'notifications', 'compliance_rules', 'profiles', 'case_reference_counters'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_full_access ON trust_reg.%I', t);
    EXECUTE format(
      'CREATE POLICY service_role_full_access ON trust_reg.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t
    );
  END LOOP;
END $$;

-- A signed-in user may read only their own profile row (used by the login flow to learn their role).
DROP POLICY IF EXISTS profiles_read_own ON trust_reg.profiles;
CREATE POLICY profiles_read_own ON trust_reg.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

GRANT USAGE ON SCHEMA trust_reg TO service_role, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA trust_reg TO service_role;
GRANT SELECT ON trust_reg.profiles TO authenticated;

-- 2. profiles -> auth.users ---------------------------------------------------
ALTER TABLE trust_reg.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey,
  ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT;

-- 3. Append-only audit trail ---------------------------------------------------
CREATE OR REPLACE FUNCTION trust_reg.prevent_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'registration_events is append-only (% not permitted)', TG_OP;
END $$;

DROP TRIGGER IF EXISTS registration_events_append_only ON trust_reg.registration_events;
CREATE TRIGGER registration_events_append_only
  BEFORE UPDATE OR DELETE ON trust_reg.registration_events
  FOR EACH ROW EXECUTE FUNCTION trust_reg.prevent_event_mutation();

-- 3b. updated_at maintenance ----------------------------------------------------
-- Prisma's @updatedAt is client-side only; the runtime writes through supabase-js, so the database
-- must own this. Every table gets DEFAULT now() (in the migration) and this BEFORE UPDATE trigger.
-- registration_events is excluded: it is append-only and never updated.
CREATE OR REPLACE FUNCTION trust_reg.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trust_cases', 'trust_registration_requirements', 'registration_documents',
    'notifications', 'compliance_rules', 'case_reference_counters', 'profiles'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON trust_reg.%I', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON trust_reg.%I FOR EACH ROW EXECUTE FUNCTION trust_reg.set_updated_at()', t);
  END LOOP;
END $$;

-- 4. Atomic case reference allocation ---------------------------------------
-- Replaces the read-then-write in caseReference.ts once the DB exists (call via rpc('next_case_reference')).
CREATE OR REPLACE FUNCTION trust_reg.next_case_reference()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  y int := EXTRACT(YEAR FROM now())::int;
  seq int;
BEGIN
  INSERT INTO trust_reg.case_reference_counters (year, next_seq, created_at, updated_at)
  VALUES (y, 2, now(), now())
  ON CONFLICT (year) DO UPDATE
    SET next_seq = trust_reg.case_reference_counters.next_seq + 1,
        updated_at = now()
  RETURNING next_seq - 1 INTO seq;
  RETURN format('NTR-%s-%s', y, lpad(seq::text, 6, '0'));
END $$;

GRANT EXECUTE ON FUNCTION trust_reg.next_case_reference() TO service_role;

-- 5. Insightly join (read-only) --------------------------------------------
-- PLACEHOLDER: confirm the exact table/columns with the owner of the public schema.
-- GRANT SELECT ON public.insightly_contacts TO service_role;


-- ===== 3/3 evidence bucket (003) =====
-- DRAFT — evidence bucket for registration certificates and confirmations.
-- Apply after 001_rls_and_constraints.sql. Coordinate with Colin on the shared AWM project.
--
-- Design:
--   * One private bucket. The Next.js API (service role) is the only reader and writer; the browser
--     receives 5-minute signed URLs from /api/registration-documents/:id/download.
--   * storage.objects already has RLS on. No policies are added for anon/authenticated, so only the
--     service role (which bypasses RLS) can touch objects.
--   * Object path: {trust_case_id}/{requirement_id}/{document_type}/{timestamp}-{file}.
--   * Retention: FCA record-keeping needs 7 years from case closure. Nothing here deletes objects;
--     registration_documents rows keep the storage_key and sha256 hash for as long as the row exists.


INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'trust-registration-evidence',
  'trust-registration-evidence',
  false,
  26214400, -- 25 MiB, matches MAX_UPLOAD_BYTES
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Belt and braces: make the intent explicit even though no permissive policy exists.
DROP POLICY IF EXISTS "trust_reg_evidence_no_direct_access" ON storage.objects;
CREATE POLICY "trust_reg_evidence_no_direct_access"
  ON storage.objects
  FOR ALL
  TO anon, authenticated
  USING (bucket_id <> 'trust-registration-evidence')
  WITH CHECK (bucket_id <> 'trust-registration-evidence');


COMMIT;
