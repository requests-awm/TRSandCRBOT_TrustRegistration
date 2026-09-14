# Trust Registration Module — Backend Setup Guide

## Overview

This is a Next.js TypeScript backend for the Trust Registration Module. It implements:
- Supabase Auth + role-based access control
- PostgreSQL schema (via Prisma + `multiSchema` targeting `trust_reg`)
- Workflow state machine for registration requirements
- Maker-checker document verification
- Audit trail (immutable event log)
- Activation gate to prevent provider activation until registrations verified

## Prerequisites

- Node.js 20+ (`node --version`)
- Docker Desktop (for local Supabase CLI stack)
- PostgreSQL (via Supabase CLI locally)

## Step 1: Start Local Supabase (Docker)

This gives you Postgres + Auth + Storage locally, matching production behavior.

```bash
cd app
supabase start
```

Wait for the output:
```
Started supabase local development server.
API URL: http://localhost:54321
DB URL: postgresql://postgres:postgres@localhost:54322/postgres
ANON_KEY: eyJ...
SERVICE_ROLE_KEY: eyJ...
```

Copy those values into `.env.local`:

```bash
# From supabase start output:
DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres"
NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..." # from output
SUPABASE_SERVICE_ROLE_KEY="eyJ..." # from output
```

## Step 2: Configure PostgREST Schema Exposure

The Supabase local instance needs to expose the `trust_reg` schema to PostgREST (so `.schema('trust_reg')` works). In the local setup, you may need to:

1. Connect to the local Postgres:
```bash
psql postgresql://postgres:postgres@localhost:54322/postgres
```

2. Run:
```sql
ALTER ROLE authenticator SET search_path TO public, trust_reg;
ALTER ROLE service_role SET search_path TO public, trust_reg;
```

Then restart Supabase: `supabase stop && supabase start`

## Step 3: Run Prisma Migrations

```bash
cd app
npx prisma migrate dev --name init
```

This will:
1. Generate the Prisma Client
2. Create the SQL migration in `prisma/migrations/`
3. Apply it to your local Postgres

**Important:** After the migration runs, you must manually apply RLS and other SQL enhancements. See `Step 4` below.

## Step 4: Hand-Augment the Migration for RLS

Open `prisma/migrations/[timestamp]_init/migration.sql` and add RLS policies at the end:

```sql
-- Enable RLS on all trust_reg tables
ALTER TABLE trust_reg.trust_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.trust_registration_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.registration_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.registration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.compliance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_reg.case_reference_counters ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by backend via service_role_key)
CREATE POLICY "service_role_full_access_trust_cases"
  ON trust_reg.trust_cases FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_requirements"
  ON trust_reg.trust_registration_requirements FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_documents"
  ON trust_reg.registration_documents FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_events"
  ON trust_reg.registration_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_notifications"
  ON trust_reg.notifications FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_compliance_rules"
  ON trust_reg.compliance_rules FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_profiles"
  ON trust_reg.profiles FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_counters"
  ON trust_reg.case_reference_counters FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Foreign key: profiles.id -> auth.users.id
-- (Prisma can't define this, so add it manually)
ALTER TABLE trust_reg.profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT;

-- registration_events: insert-only (no updates/deletes after creation)
-- This is enforced at the app layer, but the policy ensures DB-level immutability
REVOKE UPDATE, DELETE ON trust_reg.registration_events FROM authenticated, anon, service_role;
GRANT INSERT, SELECT ON trust_reg.registration_events TO service_role;
```

Re-apply the migration:
```bash
psql postgresql://postgres:postgres@localhost:54322/postgres -f prisma/migrations/[timestamp]_init/migration.sql
```

## Step 5: Seed Data

Create seed profiles and compliance rules for local testing:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const client = createClient(
  'http://localhost:54321',
  'eyJ...' // SERVICE_ROLE_KEY from .env.local
);

(async () => {
  // Create test profiles
  const users = [
    { id: '00000000-0000-0000-0000-000000000001', role: 'wm_requester', fullName: 'John (WM)', wmTeam: 'WM Team A' },
    { id: '00000000-0000-0000-0000-000000000002', role: 'aep_processor', fullName: 'Jane (AEP)', wmTeam: null },
    { id: '00000000-0000-0000-0000-000000000003', role: 'aep_reviewer', fullName: 'Bob (Reviewer)', wmTeam: null },
  ];

  for (const user of users) {
    await client.from('profiles').insert(user);
  }

  // Create test compliance rules
  await client.from('compliance_rules').insert([
    {
      authority: 'trs',
      rule_name: 'TRS 90-day rule',
      effective_from: '2026-01-01',
      deadline_days: 90,
      approved_by: '00000000-0000-0000-0000-000000000003',
      approved_at: new Date().toISOString(),
      is_active: true,
    },
    {
      authority: 'crbot',
      rule_name: 'CRBOT 6-month rule',
      effective_from: '2026-01-01',
      deadline_days: 180,
      approved_by: '00000000-0000-0000-0000-000000000003',
      approved_at: new Date().toISOString(),
      is_active: true,
    },
  ]);

  console.log('Seed data created');
})();
"
```

## Step 6: Start the Dev Server

```bash
npm run dev
```

The server runs on `http://localhost:3000`. The API is available at `http://localhost:3000/api/`.

## Testing the Backend

### Create a Trust Case

```bash
curl -X POST http://localhost:3000/api/trust-cases \
  -H "Content-Type: application/json" \
  -d '{
    "insightlyId": "12345",
    "clientDisplayName": "Acme Corp",
    "trustName": "Acme Family Trust",
    "providerName": "Some Provider",
    "providerCountry": "GB",
    "trustType": "Discretionary",
    "requestingWmTeam": "WM Team A",
    "businessPriority": "standard"
  }'
```

**Note:** This requires authentication. For now, the API routes are scaffolded but auth enforcement will be added in the frontend integration phase.

## Local Development Workflow

1. **Schema changes:** Edit `prisma/schema.prisma`, then `npx prisma migrate dev`
2. **New API routes:** Add files under `src/app/api/*/route.ts`
3. **Service logic:** Add to `src/server/services/` or `src/server/workflow/`
4. **Type generation:** `npx prisma generate` after schema changes

## Next Steps

1. **Migrations to the shared AWM Supabase instance** — Contact Colin to:
   - Register `trust_reg` in the Notion Tool Registry
   - Create the schema on the shared instance
   - Issue scoped credentials (SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY)
   - Expose the schema in PostgREST (`db_schemas` config)

2. **Frontend integration** — Build the WM and AEP dashboards in `src/app/(wm)/` and `src/app/(aep)/` route groups

3. **Real email provider** — Swap `ConsoleNotificationProvider` for SendGrid/Resend/SES in `src/server/services/notificationService.ts`

## Troubleshooting

### Prisma Client not generated
```bash
npx prisma generate
```

### RLS policies blocking queries
Verify the service role has access:
```sql
SELECT * FROM information_schema.role_table_grants
WHERE table_schema = 'trust_reg' AND grantee = 'service_role';
```

### PostgREST not exposing trust_reg schema
```bash
supabase status
# Check the output; you should see trust_reg in the exposed schemas
```

If not, manually set:
```sql
ALTER ROLE authenticator SET search_path TO public, trust_reg;
```

## Project Structure

```
app/
  src/
    app/
      api/                    # API routes
      (auth)/                 # Auth flows
      (wm)/                   # WM-facing screens (future)
      (aep)/                  # AEP-facing screens (future)
    lib/supabase/             # Supabase clients
    server/
      auth/                   # Session, roles
      workflow/               # State machine, derivations
      services/               # Business logic (cases, requirements, documents, events, notifications)
  prisma/
    schema.prisma             # Data model
    migrations/               # SQL migrations
  .env.local.example          # Credentials template
```

## Contact

For schema provisioning on the shared AWM Supabase instance, contact Colin.
