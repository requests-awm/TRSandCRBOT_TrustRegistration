-- DRAFT dev seed. Local Supabase only. Never run against the shared project.
-- Creates one auth user per role (password: Password123!) and matching trust_reg.profiles rows,
-- plus the two compliance rules the requirement decisions reference.
--
-- The dev user ids match src/lib/session/devRole.ts (DEV_USER_IDS) so AUTH_MODE=dev and real
-- sign-in resolve to the same people.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH users(id, email, role, wm_team) AS (
  VALUES
    ('00000000-0000-4000-8000-000000000001'::uuid, 'wm_requester@dev.local',        'wm_requester',        'WM Team A'),
    ('00000000-0000-4000-8000-000000000002'::uuid, 'aep_processor@dev.local',       'aep_processor',       NULL),
    ('00000000-0000-4000-8000-000000000003'::uuid, 'aep_reviewer@dev.local',        'aep_reviewer',        NULL),
    ('00000000-0000-4000-8000-000000000004'::uuid, 'compliance_reviewer@dev.local', 'compliance_reviewer', NULL),
    ('00000000-0000-4000-8000-000000000005'::uuid, 'administrator@dev.local',       'administrator',       NULL),
    ('00000000-0000-4000-8000-000000000006'::uuid, 'auditor@dev.local',             'auditor',             NULL)
),
ins_auth AS (
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  SELECT
    id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
    crypt('Password123!', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  FROM users
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO trust_reg.profiles (id, role, full_name, wm_team, is_active, created_at, updated_at)
SELECT id, role::trust_reg.user_role, initcap(replace(role, '_', ' ')), wm_team, true, now(), now()
FROM users
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, wm_team = EXCLUDED.wm_team, is_active = true;

-- PLACEHOLDER deadlines: confirm statutory windows with Compliance before go-live.
INSERT INTO trust_reg.compliance_rules
  (id, authority, rule_name, effective_from, effective_to, deadline_days, rule_configuration_json, approved_by, approved_at, is_active, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'trs',   'UK TRS: register within 90 days of creation or becoming liable', '2022-09-01', NULL, 90,
   '{"basis":"trust_creation_date","source":"HMRC TRS guidance"}'::jsonb,
   '00000000-0000-4000-8000-000000000004', now(), true, now(), now()),
  (gen_random_uuid(), 'crbot', 'Ireland CRBOT: register within 6 months of creation', '2021-10-23', NULL, 180,
   '{"basis":"trust_creation_date","source":"Revenue CRBOT guidance"}'::jsonb,
   '00000000-0000-4000-8000-000000000004', now(), true, now(), now())
ON CONFLICT DO NOTHING;

COMMIT;
