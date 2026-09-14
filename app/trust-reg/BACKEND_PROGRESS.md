# Backend and Frontend Progress

**Status (2026-09-13, late):** Every dashboard requirement has code behind it, verified by typecheck, lint,
220 unit tests and a production build. No Docker, Supabase CLI or psql on this machine, so nothing can run against
a database until Colin provisions the shared project. Nothing has run against a real database, Storage bucket or email provider yet.

See `../../PROJECT_STATUS.md` for the requirement coverage table and the placeholder list. This file tracks the
developer checklist.

## Done
- [x] Prisma 7 schema + `prisma.config.ts` (connection URL moved out of the schema as Prisma 7 requires)
- [x] Domain types independent of the Prisma client (`src/server/domain/types.ts`)
- [x] State machine (13 transitions) with role / required-field / precondition checks — 172 tests
- [x] `deriveOverallStatus`, `deriveActivationBlocked`, `reconcileOverallStatus` — 15 tests
- [x] `deriveSimpleStatus` (not started / in progress / completed roll-up) — 9 tests
- [x] Audit CSV export (`auditEventsToCsv`) — 3 tests
- [x] Storage key / upload validation, notification templates and provider selection, document access rules — 21 tests
- [x] Generated initial migration `prisma/migrations/20260913000000_init/migration.sql` + `migration_lock.toml`
- [x] DB-gated end-to-end test `src/server/integration.test.ts` (skipped unless `INTEGRATION_BASE_URL` is set)
- [x] `PROVISIONING.md` handover for Colin; `README.md` rewritten as the runbook
- [x] Old skeleton and superseded docs moved to `../../_archive/`; empty `frontend/` removed
- [x] Dockerised: `Dockerfile` (runner + migrator targets), `.dockerignore`, `docker-compose.yml`,
      `.env.docker.example`, `/api/health`, `npm run docker:*` scripts; standalone server verified locally
- [ ] `docker build` / `docker compose up` on a machine with Docker (none here)
- [x] `npm run db:validate` — migration + 001 + 003 + 002 applied to PGlite (real Postgres, in-process); 23 checks
      pass incl. RLS, append-only trigger, `next_case_reference()`, RESTRICT FKs, TIMESTAMPTZ everywhere
- [x] Services: trust cases (incl. `handBackToWm`, `closeCase`), requirements (incl. `transitionRequirement`),
      documents (Storage upload, SHA-256, versioning, verify, access-checked download), events (cross-case list),
      notifications (console / Resend / SendGrid, delivery recorded), jobs (overdue recompute, deadline reminders)
- [x] 15 API route files, zod validation, HTTP error mapping
- [x] `src/proxy.ts` session guard (active only in `http` mode with Supabase auth)
- [x] `caseReference.ts` uses `rpc("next_case_reference")` from `001_rls_and_constraints.sql`
- [x] `AUTH_MODE=dev` header-based role placeholder (refused in production)
- [x] Frontend: dashboard (three-state tiles, jurisdiction + progress filters), new request, case detail (confirmation
      panel with certificate download, hand back, close; requirements; checklist; transitions; real file upload),
      audit (date filters, CSV export), login (`?next=`)
- [x] `TrustRegApi` abstraction with `mockClient` (files kept in browser) and `httpClient` (multipart upload)
- [x] SQL drafts: 001 RLS/constraints, 002 dev seed, 003 evidence bucket; `config.toml` bucket for `supabase start`
- [x] `vercel.json` cron for `/api/jobs/daily`
- [x] npm scripts: `typecheck`, `lint`, `test`, `build`, `db:migrate`, `db:generate`

## Proven on a real database locally (2026-09-14)
- [x] `scripts/local-stack/start.mjs` — embedded Postgres 17 + PostgREST 16 + Storage/auth-admin gateway, no Docker
- [x] All four SQL files applied; `next dev` in `http` mode; **integration test 10/10**
- [x] Bug fixed: `updated_at` NOT NULL without default → `@default(now())` in schema + `set_updated_at` trigger in 001
- [x] `npm run db:validate` — 25 checks incl. updated_at default + trigger

## Blocked on the shared project
- [ ] `npm run db:migrate` against local or shared Supabase
- [ ] Apply `supabase/sql/001_rls_and_constraints.sql` and `003_storage.sql`
- [ ] Apply `supabase/sql/002_seed_dev.sql` (local only)
- [ ] Integration test: create → decide → submit → upload → verify → activation unblocked → hand back → download → close
- [ ] `AUTH_MODE=supabase`, `NEXT_PUBLIC_DATA_SOURCE=http`, confirm the proxy redirect
- [ ] Set `CRON_SECRET`, `NOTIFICATION_PROVIDER` + key, `APP_BASE_URL`; send one real email

## Design decisions still in force
1. Runtime uses supabase-js; Prisma is for migrations only.
2. State machine is pure and synchronous; preconditions receive pre-fetched documents and checklist.
3. Derived status is recomputed after every requirement mutation and once a day by the job, not by triggers.
   `handed_back_to_wm` and `closed` are set by people and survive recompute while the activation gate is open.
4. Maker-checker is enforced in `documentService.verifyDocument` and again in the `VERIFY_EVIDENCE` precondition.
5. RLS grants are service-role only; the app decides visibility (WM requesters see their own team, and may download
   only verified certificates).
6. Files never pass through the browser to Storage. The API receives multipart, writes to the private bucket, and
   hands out 5-minute signed URLs.
7. Checklist is jsonb on the requirement.
8. Notification provider is pluggable via `NOTIFICATION_PROVIDER`; every attempt is a row in `notifications`.

## Local commands
```bash
npm run dev          # mock data, role switcher in sidebar
npm run typecheck
npm run lint
npm test
npm run build
```

On this machine `npx` fails because of the parentheses in the folder path. Use the npm scripts above, or call the
binaries directly, e.g. `node node_modules/typescript/bin/tsc --noEmit`.
