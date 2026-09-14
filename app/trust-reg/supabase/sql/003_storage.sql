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

BEGIN;

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
