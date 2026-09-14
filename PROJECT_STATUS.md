# TRS / CRBOT Trust Registration Monitor — Project Status

**Updated:** 2026-09-14
**Live code:** `app/trust-reg/` (Next.js 16, App Router, Tailwind v4, supabase-js, Prisma 7 for migrations only)

## Operational proof (2026-09-14)

The full lifecycle has now run end to end against a **real Postgres 17 + PostgREST 16** stack on this machine
(`npm run stack:app`, no Docker: embedded Postgres binaries + PostgREST Windows build + a small gateway that emulates
Supabase Storage and the auth-admin user lookup). The same four SQL files the shared project will receive were applied.

| Step | Evidence in the database / on disk |
|---|---|
| WM logs a trust | `trust_cases` row `NTR-2026-000001`, `activation_blocked = true` |
| AEP records jurisdiction | TRS `required`, CRBOT `not_required` in `trust_registration_requirements` |
| AEP registers | status walked `not_started → ready → in progress → submitted`, 19 append-only events |
| Certificate captured | file bytes stored under the bucket path; `registration_documents.file_hash` equals the SHA-256 of the file on disk |
| Maker-checker | uploader's verify attempt refused (403); reviewer's accepted; `authority_reference` recorded |
| Activation gate | `activation_blocked` flipped to `false`, `activation_unblocked` + `wm_notified` events |
| WM confirmation | `notifications` rows `ready_for_provider` and `handed_back_to_wm` to `wm_requester@dev.local` (email resolved from `auth.users`) |
| WM download | signed URL issued and fetched (200) |
| Close + audit | `overall_status = closed`, `closed_at` set; CSV export contains `case_closed` |
| Daily job | `/api/jobs/daily` ran with the cron secret |

`INTEGRATION_BASE_URL=http://localhost:3000 npm test -- integration` → 10/10 pass.

**Bug found and fixed by this run:** Prisma's `@updatedAt` is client-side only, so `updated_at` had no database
default and every insert through supabase-js failed. Fixed with `@default(now())` on all eight tables (migration
regenerated) and a `set_updated_at` BEFORE UPDATE trigger in `001_rls_and_constraints.sql`. `npm run db:validate`
now checks both.

What is still not the real thing: the shared AWM Supabase project (Colin), a real email provider key, Supabase Auth
sign-in (the stack runs `AUTH_MODE=dev`), and a Docker build on a machine that has Docker.

The earlier duplicate skeleton and the four superseded design documents now live under `_archive/` and are not
part of the build. `app/node_modules` (from the old skeleton, ~500 MB) could not be removed automatically; delete it
by hand. Handover for the database owner: `app/trust-reg/PROVISIONING.md`.

---

## Requirement coverage

| Requirement | Status | Where |
|---|---|---|
| Log non-AEP provider trusts needing TRS / CRBOT registration | Built | `/cases/new`, `POST /api/trust-cases` |
| Track registration status: not started / in progress / completed | Built | `deriveSimpleStatus.ts`; dashboard tiles, Progress column and filter; detailed 12-state workflow underneath |
| Record jurisdiction (UK TRS, Irish CRBOT, or both) | Built | one requirement row per authority; Jurisdiction column and filter |
| Capture and store registration confirmation / certificates | Built, needs bucket | multipart upload to private Storage bucket, SHA-256 hash, versioning, maker-checker verify, signed-URL download |
| Visibility and confirmation back to the WM team | Built, needs email keys | WM sees own team's cases; "Registration confirmation for WM" panel with certificate downloads; hand-back email; close case |
| Regulatory compliance and auditability | Built | append-only events, cross-case audit page with date filters and CSV export, `GET /api/events?format=csv` |

Everything above runs today on placeholder data. Nothing has run against a real database yet.

---

## What runs today (no database needed)

```bash
cd app/trust-reg
npm install
npm run dev        # http://localhost:3000
```

`.env.local` ships with `NEXT_PUBLIC_DATA_SOURCE=mock`, so the whole UI runs on seeded placeholder data held in the
browser (localStorage). The sidebar has a **dev role switcher** to act as any of the six roles, and a
**Reset placeholder data** link. Uploaded files (up to 4 MB) are kept in the browser so download can be tried too.

Verified on 2026-09-13:

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 220 unit tests pass; 10 integration tests skipped until `INTEGRATION_BASE_URL` is set |
| `npm run db:validate` | 25 schema/RLS/trigger/RPC checks pass on an in-process Postgres |
| `npm run stack:app` + integration test | 10/10 lifecycle steps pass on real Postgres 17 + PostgREST 16 |
| `npm run build` | 22 routes + proxy compile |

---

## What is built

### Backend (`src/server`, `src/app/api`, `src/proxy.ts`)
- Domain types mirror the Prisma schema (`src/server/domain/types.ts`). The runtime does **not** need a generated Prisma client.
- Workflow engine: 13-transition state machine with role, required-field and precondition checks; overall-status and
  activation-gate derivation; three-state roll-up; manual hand-back / close reconciliation. Pure functions, unit-tested.
- Services: trust cases (create, list, assign, **hand back**, **close**, soft delete), requirements (decision, field
  edits, transition, derived-state recompute), documents (**file storage**, hashing, versioning, maker-checker
  verify/reject, **access-checked download links**), append-only events with **cross-case listing and CSV**,
  notifications (**console / Resend / SendGrid**, delivery recorded in `notifications`, WM email resolved from
  `auth.users`), **daily job** (overdue recompute + deadline reminders).
- `src/proxy.ts`: redirects anonymous visitors to `/login` and signed-in visitors away from it. Active only when
  `NEXT_PUBLIC_DATA_SOURCE=http` and `AUTH_MODE` is not `dev`.
- API routes (zod-validated, role-guarded, consistent error mapping 400/401/403/404/409/500):

| Method | Route | Purpose |
|---|---|---|
| GET/POST | `/api/trust-cases` | list (WM sees own team) / create |
| GET/PATCH/DELETE | `/api/trust-cases/:id` | fetch / assign AEP owner / soft delete |
| POST | `/api/trust-cases/:id/hand-back` | AEP returns verified pack to WM, emails requester |
| POST | `/api/trust-cases/:id/close` | WM (or reviewer/admin) confirms provider accepted the trust |
| POST | `/api/trust-cases/:id/requirements` | TRS or CRBOT requirement decision |
| GET | `/api/trust-cases/:id/events` | audit trail for one case |
| GET/PATCH | `/api/registration-requirements/:id` | fetch / owner, dates, checklist, references |
| POST | `/api/registration-requirements/:id/transition` | state machine endpoint |
| GET | `/api/registration-requirements/:id/documents` | document versions |
| POST | `/api/registration-documents` | **multipart** upload: file to Storage, metadata row |
| GET | `/api/registration-documents/:id/download` | 5-minute signed URL (WM: verified certificates only) |
| POST | `/api/registration-documents/:id/verify` | verify / reject (maker-checker) |
| GET | `/api/events` | cross-case audit, filters, `?format=csv` |
| GET/POST | `/api/jobs/daily` | scheduler entry point, `Authorization: Bearer $CRON_SECRET` |
| GET | `/api/me` | current user + role |

### Frontend (`src/app`, `src/components`, `src/lib`)
- `/dashboard` — Not started / In progress / Completed tiles (click to filter), operational tiles, case table with
  Jurisdiction and Progress columns, filters by progress, jurisdiction, detailed status and free text.
- `/cases/new` — WM request form.
- `/cases/[id]` — case header with progress badge, **Registration confirmation for WM** panel (registrations, authority
  references, verified certificates with download, hand-back and close actions), TRS and CRBOT panels (decision,
  checklist, workflow actions, documents with real upload, download, verify/reject), request details, timeline.
- `/audit` — cross-case audit log with event type and date filters, **Export CSV**.
- `/login` — Supabase email/password sign-in, honours `?next=`.
- Single `TrustRegApi` interface with two implementations: `mockClient` (browser, placeholder) and `httpClient`
  (real routes). Switch with one env var.

### Database and storage (`prisma/schema.prisma`, `supabase/`)
- Prisma 7 schema for `trust_reg` (8 tables, 11 enums; event enum now includes `case_handed_back`, `case_closed`).
  Not yet migrated anywhere.
- `prisma/migrations/20260913000000_init/migration.sql` — the generated DDL (schema, enums, tables, RESTRICT FKs),
  ready to hand to Colin or to apply with `prisma migrate deploy`.
- `npm run db:validate` (`scripts/validate-sql.mjs`) — applies the migration, `001`, `003` and `002` to an
  in-process Postgres (PGlite, real Postgres engine, no Docker) and runs 23 checks: 8 tables, 11 enums, every
  timestamp TIMESTAMPTZ, every FK RESTRICT, RLS on all tables, service-role policies, profiles→auth.users FK,
  private bucket + deny policy, seed rows, `next_case_reference()` sequencing, append-only trigger blocks UPDATE and
  DELETE, unique (case, authority), enum rejection, and `authenticated` denied on `trust_cases`. **All pass on
  2026-09-14.** This is the schema-level proof; the shared Supabase project still has to be provisioned for the
  app itself to run against it.
- `src/server/integration.test.ts` — end-to-end lifecycle test against a running dev server with a real database
  (create → decide → register → upload → maker-checker verify → gate open → WM download → hand back → close → CSV).
- `supabase/sql/001_rls_and_constraints.sql` — RLS (service-role only), profiles→auth.users FK, append-only trigger
  on events, atomic `next_case_reference()` (now the only allocation path in code). **Draft, unapplied.**
- `supabase/sql/002_seed_dev.sql` — six dev users/profiles and two compliance rules. **Local only.**
- `supabase/sql/003_storage.sql` — private `trust-registration-evidence` bucket, 25 MiB, PDF/PNG/JPEG/Word; no
  anon/authenticated access. Mirrored in `supabase/config.toml` for `supabase start`. **Draft, unapplied.**
- `vercel.json` — weekday 06:00 cron for `/api/jobs/daily`. Any other scheduler can call the same URL with the secret.

### Docker (`Dockerfile`, `docker-compose.yml`, `.env.docker.example`)
- Multi-stage image on `node:22-alpine` using Next standalone output (`output: "standalone"`), non-root, healthcheck
  on `GET /api/health`. `NEXT_PUBLIC_*` are build args; secrets are runtime env from `.env.docker`, never in a layer.
- Compose: `app`, `migrator` (prisma migrate deploy, profile `tools`), optional `cron` curl loop (profile `jobs`).
- Verified locally by running `.next/standalone/server.js` the way the container does (health, pages, static assets
  all 200). Docker itself is not installed on this machine, so `docker build` has not been executed yet.

---

## Placeholders to replace (search the code for `PLACEHOLDER`)

| Where | What is placeholder | Replace with |
|---|---|---|
| `.env.local` | `REPLACE_ME` Supabase keys, `AUTH_MODE=dev`, `NEXT_PUBLIC_DATA_SOURCE=mock` | real keys, `supabase`, `http` |
| `.env.local` | no `CRON_SECRET`, `NOTIFICATION_PROVIDER=console` | random secret; `resend` or `sendgrid` + API key, `APP_BASE_URL`, `WM_FALLBACK_EMAIL`, `AEP_TEAM_EMAIL` |
| `src/server/auth/session.ts` | `AUTH_MODE=dev` header-based role | Supabase session (already coded, needs profiles table) |
| `src/lib/api/mockClient.ts` | entire in-browser data layer | nothing — flip `NEXT_PUBLIC_DATA_SOURCE=http` |
| `src/server/services/requirementService.ts` `defaultChecklist` | sample checklist items | agreed AEP checklist per authority |
| `src/app/(app)/cases/new/page.tsx` | hard-coded provider countries / trust types | Insightly / reference data |
| `supabase/sql/002_seed_dev.sql` | statutory deadline days | confirmed by Compliance |
| `registration_documents.malware_scan_status` | always `pending` | scanning hook if Compliance requires one |

---

## Remaining work, in order

The app is proven against a real Postgres locally (see "Operational proof" above). What is left needs the shared
Supabase project (Colin), email and scheduler secrets, and a Docker host.

1. **Database** — send Colin `app/trust-reg/PROVISIONING.md`. It lists the migration file, the two SQL files, the
   PostgREST exposure and the keys to issue.
2. **Wire the API to the DB** — set real keys, `AUTH_MODE=dev` for the test run, `NEXT_PUBLIC_DATA_SOURCE=http`,
   then `INTEGRATION_BASE_URL=http://localhost:3000 npm test -- integration`. Switch to `AUTH_MODE=supabase` after.
3. **Email** — choose Resend or SendGrid, set the key and `APP_BASE_URL`, confirm a WM address resolves from
   `auth.users`.
4. **Scheduler** — set `CRON_SECRET`; on Vercel the cron is already declared, elsewhere point a scheduler at
   `/api/jobs/daily`.
5. **Compliance sign-off** — statutory deadline days in the seed and the per-authority checklist.
6. **Housekeeping** — delete `app/node_modules` (old skeleton) by hand; `_archive/` can go once nobody needs the
   history. Consider `git init` so future changes are tracked.
7. **Deployment and handover.**

Estimated remaining effort: about 1 week once database access is available.
