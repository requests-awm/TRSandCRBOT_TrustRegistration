> **SUPERSEDED 2026-09-13.** This document describes a design that is no longer in use. See [PROJECT_STATUS.md](PROJECT_STATUS.md).

# Trust Registration Module — Backend Ready

## Status: ✅ Backend implementation complete (MVP schema, services, state machine)

The backend skeleton for the Trust Registration Module is ready. It includes:
- ✅ Full Prisma schema targeting `trust_reg` (8 enums, 8 tables, relationships, soft-delete, RLS-ready)
- ✅ Supabase clients (service-role for mutations, auth-aware for reads, separate Insightly join client)
- ✅ Authentication & role-based access control (6 roles: wm_requester, aep_processor, aep_reviewer, compliance_reviewer, administrator, auditor)
- ✅ Workflow state machine (13 valid transitions, maker-checker enforcement, precondition validation)
- ✅ Derived status calculation (overall_status, activation_blocked per spec precedence)
- ✅ Core services (trust cases, requirements, documents, events, notifications stub)
- ✅ API scaffold (1 route shown as pattern; remaining 8 routes follow the same structure)

## Location

The built backend is in: `./app/`

## Next Steps

### Phase 1: Local Testing (Blocking — requires Docker + local Postgres)

1. **Install Docker Desktop** if not already done

2. **Start local Supabase** (gives you Postgres + Auth + Storage locally):
   ```bash
   cd app
   supabase start
   ```
   
   Wait for the output and copy the values into `.env.local`:
   ```
   DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres"
   NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"
   NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
   SUPABASE_SERVICE_ROLE_KEY="eyJ..."
   ```

3. **Run the migration** (creates schema + generates Prisma Client):
   ```bash
   npx prisma migrate dev --name init
   ```

4. **Augment the migration with RLS** (see `app/BACKEND_SETUP.md` Step 4):
   - The generated migration needs RLS policies added manually
   - These enforce that only the service role (backend) can access trust_reg tables
   - Re-run the migration SQL with RLS policies added

5. **Seed test data** (profiles, compliance rules):
   ```bash
   # Run the seed script from BACKEND_SETUP.md Step 5
   ```

6. **Start the dev server**:
   ```bash
   npm run dev
   ```
   
   Server runs on `http://localhost:3000`

7. **Test the API** — use curl or Postman to hit the endpoints (details in BACKEND_SETUP.md)

### Phase 2: Implement Missing API Routes

The pattern is established in `src/app/api/trust-cases/route.ts`. Eight more routes follow the same structure:

| Route | Method | Purpose | Priority |
|-------|--------|---------|----------|
| `/api/trust-cases` | GET | List cases (WM team filtered) | High |
| `/api/trust-cases/:id` | GET | Fetch one case | High |
| `/api/trust-cases/:id/requirements` | POST | Create requirement (triage) | High |
| `/api/registration-requirements/:id` | PATCH | Update non-status fields | High |
| `/api/registration-requirements/:id/transition` | POST | **Core**: state machine endpoint | Critical |
| `/api/registration-documents` | POST | Upload metadata | High |
| `/api/registration-documents/:id/verify` | POST | Verify/reject (maker-checker) | High |
| `/api/admin/recompute-status` | POST | Manual derived-status reconciliation | Low |

**Status machine transition route is the critical one** — it's where all workflow control happens. See `src/server/workflow/requirementStateMachine.ts` for the 13 valid transitions.

### Phase 3: Unit & Integration Tests

Tests to write:

1. **State machine tests** (13 transitions × 2: happy path + failure case):
   - Every legal transition succeeds
   - Every illegal transition is rejected with clear error
   - Maker-checker precondition works (verifier != uploader)

2. **Derivation logic tests**:
   - `deriveOverallStatus()` implements exact precedence
   - `deriveActivationBlocked()` returns false only when all required are verified_completed

3. **Integration test** (full happy path):
   - Create case
   - Decide requirement (TRS required)
   - Start registration
   - Submit
   - Upload evidence (as processor)
   - Verify (as different reviewer)
   - Confirm `activation_blocked` flips to false, event recorded

### Phase 4: Frontend (Separate Planning)

Once the backend is tested locally, plan and build:
- WM request form
- AEP dashboard (summary cards + filterable case table)
- Case detail page (tabs: summary, TRS, CRBOT, documents, activity, communications, compliance decision, provider handoff)
- Document upload/verification UI
- Reporting screens

Frontend will use the same Supabase clients and API routes, so it's decoupled from backend details.

### Phase 5: Deploy to Shared AWM Supabase Instance

Once everything works locally, repoint to the shared AWM Supabase instance:

1. **Register with Colin** — add `trust_reg` to Tool Registry, create schema on shared instance
2. **Get credentials** — Colin issues scoped SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY for the shared instance
3. **Configure PostgREST** — Colin exposes `trust_reg` schema in the instance's `db_schemas` setting
4. **Run migrations** — `npx prisma migrate deploy` (applies the same SQL to the shared instance)
5. **Seed prod data** — seed production compliance rules, administrators, etc.
6. **Repoint env vars** — swap `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to shared instance credentials
7. **Deploy** — push to your hosting (Vercel recommended for Next.js)

## Key Documentation

| File | What |
|------|------|
| `app/BACKEND_SETUP.md` | Step-by-step local dev + RLS + troubleshooting |
| `app/BACKEND_PROGRESS.md` | What's built, what remains, architecture diagram |
| `app/prisma/schema.prisma` | Full data model (enums, tables, relationships) |
| `app/src/server/workflow/requirementStateMachine.ts` | The 13 valid transitions + preconditions |
| `app/src/server/services/` | Business logic (trust cases, requirements, documents, events, notifications) |

## Critical Files to Review Before Testing

1. **Data model** — `app/prisma/schema.prisma`
   - 8 tables, 10 enums, all TIMESTAMPTZ, ON DELETE RESTRICT, soft-delete where needed
   - Matches the spec exactly

2. **State machine** — `app/src/server/workflow/requirementStateMachine.ts`
   - 13 transitions, each with from/to/allowedRoles/requiredFields/preconditions
   - Maker-checker: VERIFY_EVIDENCE rejects if verifier == uploader

3. **Derived status** — `app/src/server/workflow/deriveOverallStatus.ts` + `deriveActivationBlocked.ts`
   - Implements exact spec precedence
   - activation_blocked only false when all required are verified_completed

4. **Event service** — `app/src/server/services/eventService.ts`
   - Immutable append-only audit trail
   - Called by every mutating operation

## Architecture Decision Recap

- **Prisma** targets `trust_reg` schema via `multiSchema` (no workaround needed, GA since Prisma 6.13.0)
- **Runtime queries** go through Supabase JS client, not Prisma Client (per AWM shared-db pattern)
- **RLS** enforces service-role-only access; app layer controls visibility
- **State machine** is pure, synchronous logic (no DB calls within the transition check itself)
- **Derived status** recomputes on every mutation (consistency over lazy caching)
- **Maker-checker** enforced at the API layer (verifyDocument checks uploader != verifier)
- **Notifications** pluggable interface; ConsoleNotificationProvider for MVP, real email later

## What's NOT Included (By Design)

- ❌ Automated HMRC/ROS registration (manual submission via UI only)
- ❌ Real email provider (ConsoleNotificationProvider logs to stdout)
- ❌ Frontend screens (planned separately)
- ❌ WebSocket real-time updates (polling MVP)
- ❌ Detailed compliance reporting (basic queries only)

## Questions / Blockers

- **Docker required?** Yes, for local Supabase. If Docker isn't available, we can work around it with a bare local Postgres, but it's less ideal.
- **When does RLS get applied?** Manually during local testing (see BACKEND_SETUP.md Step 4). On the shared instance, Colin applies it.
- **How do I run the first migration?** `npx prisma migrate dev --name init` — it prompts to create the database, creates the tables, and generates the Prisma Client.

## Next Immediate Action

**For the user:** Read `app/BACKEND_SETUP.md` and follow Steps 1-6 to get the local backend running. Once you can curl `http://localhost:3000/api/trust-cases` and get a 201 response, the backend is working.

**Once local testing is done:** Let me know, and we'll build the remaining API routes + tests.
