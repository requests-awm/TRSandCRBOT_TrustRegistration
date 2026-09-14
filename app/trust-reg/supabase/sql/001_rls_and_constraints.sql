-- DRAFT — apply AFTER the Prisma migration has created the trust_reg schema and tables.
-- Owner: Tumisang. Coordinate with Colin before running against the shared AWM Supabase project.
--
-- What this adds that Prisma cannot express:
--   1. RLS on every trust_reg table, service-role-only (the Next.js API is the only client)
--   2. FK from trust_reg.profiles.id to auth.users.id
--   3. Append-only guard on registration_events (no UPDATE / DELETE, even for service_role)
--   4. Read grant for the Insightly join (public.insightly_contacts is read-only for this app)

BEGIN;

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

COMMIT;
