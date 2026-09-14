# Provisioning `trust_reg` on the shared AWM Supabase project

**For:** Colin (shared database owner)
**From:** Tumisang (tool owner)
**Tool:** TRS / CRBOT Non-AEP Provider Trust Registration Monitor
**Schema:** `trust_reg` (new, owned by this tool; reads `public` only)

Everything the app needs from the shared project, in the order to run it. Each SQL file is idempotent where
Postgres allows it. Nothing here touches `public` or another tool's schema.

## 1. Register the tool
- Add `trust_reg` to the Tool Registry.
- Confirm the schema name is free.

All four SQL files have been applied to a real Postgres 17 behind PostgREST 16 and the application's full lifecycle
test passed against them (see `npm run stack:app` in the README), plus 25 schema checks via `npm run db:validate`.
They should apply to the shared project without edits. Note `001` also installs a `set_updated_at` trigger; the
migration gives every `updated_at` a `DEFAULT now()`.

## 2. Create the schema and tables
Run `prisma/migrations/20260913000000_init/migration.sql`. It:
- creates schema `trust_reg`
- creates 11 enums and 8 tables (`trust_cases`, `trust_registration_requirements`, `registration_documents`,
  `registration_events`, `notifications`, `compliance_rules`, `case_reference_counters`, `profiles`)
- uses `TIMESTAMPTZ` everywhere and `ON DELETE RESTRICT` on every foreign key

Alternative, if you prefer Prisma to track the migration history: from `app/trust-reg` with `DATABASE_URL` set,
run `npm run db:migrate -- --name init` (dev) or `node node_modules/prisma/build/index.js migrate deploy` (prod).

## 3. Apply the constraints Prisma cannot express
Run `supabase/sql/001_rls_and_constraints.sql`. It:
- enables RLS on every `trust_reg` table with **service-role-only** policies (the Next.js API is the only client)
- adds `profiles.id → auth.users.id` (`ON DELETE RESTRICT`)
- makes `registration_events` append-only with a trigger that raises on UPDATE / DELETE
- creates `trust_reg.next_case_reference()` and grants EXECUTE to `service_role`
- grants `SELECT ON trust_reg.profiles TO authenticated` so a signed-in user can read their own role

## 4. Create the evidence bucket
Run `supabase/sql/003_storage.sql`. It creates the private bucket `trust-registration-evidence`
(25 MiB, PDF / PNG / JPEG / Word) and adds a `storage.objects` policy that denies anon and authenticated roles
access to that bucket. Only the service role reads and writes it; users receive 5-minute signed URLs from the API.

## 5. Expose the schema to PostgREST  ✅ done 2026-09-14
Add `trust_reg` to the project's exposed schemas (Dashboard → Settings → API → Exposed schemas), or in SQL:

```sql
-- append, never replace: other AWM tools' schemas live in the same setting
ALTER ROLE authenticator SET pgrst.db_schemas = '<existing list>, trust_reg';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';   -- without this PostgREST keeps the old table cache
```

The app calls `.schema("trust_reg")` on every query and `rpc("next_case_reference")`.

## 6. Issue credentials
The app needs, scoped as tightly as the project allows:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser sign-in only)
- `SUPABASE_SERVICE_ROLE_KEY` (server only; never shipped to the browser)
- `DATABASE_URL` for Prisma migrations, only if Tumisang is to run them

## 7. Users
Each user of the tool needs an `auth.users` row (email + password, or the org SSO) and a matching
`trust_reg.profiles` row with one of: `wm_requester`, `aep_processor`, `aep_reviewer`, `compliance_reviewer`,
`administrator`, `auditor`. WM requesters also need `wm_team` set; the app filters their view by it.

Do **not** run `supabase/sql/002_seed_dev.sql` on the shared project. It inserts fake `auth.users` with a known
password and is for local Supabase only.

## 8. Optional read of Insightly data
The request form will later look up clients in `public.insightly_contacts`. When that is wanted:
`GRANT SELECT ON public.insightly_contacts TO service_role;` (commented out at the end of `001`).

## What the app will then do
- Store every registration case, requirement decision and status change in `trust_reg`.
- Store certificate files in the bucket, with SHA-256 hashes and versions in `registration_documents`.
- Keep an append-only audit trail in `registration_events`.
- Record every email attempt in `notifications`.
- Run a daily job (`/api/jobs/daily`) that recomputes overdue cases and sends deadline reminders.

## Verification after provisioning
From `app/trust-reg` with real keys in `.env.local`, `AUTH_MODE=dev`, `NEXT_PUBLIC_DATA_SOURCE=http`:

```bash
npm run dev
# second terminal
INTEGRATION_BASE_URL=http://localhost:3000 npm test -- integration
```

The integration test walks the full lifecycle: create → decide → register → upload → verify (maker-checker) →
activation released → WM download → hand back → close, and checks the CSV audit export.
