# Trust Registration Monitor (TRS / CRBOT)

Dashboard and workflow for AWM's AEP team to log non-AEP provider trusts, track their UK TRS and Irish CRBOT
registration to completion, store the registration certificates, and hand them back to the Wealth Management team
for provider submission. Without a verified certificate the trust cannot be activated; the app enforces that gate.

- Project status and requirement coverage: [`../../PROJECT_STATUS.md`](../../PROJECT_STATUS.md)
- Database provisioning for the shared Supabase project: [`PROVISIONING.md`](PROVISIONING.md)
- Google Cloud deployment: [`deploy/gcloud/README.md`](deploy/gcloud/README.md)

## Run it now (placeholder data, no database)

```bash
npm install
npm run dev          # http://localhost:3000
```

`.env.local` defaults to `NEXT_PUBLIC_DATA_SOURCE=mock`. Seven seeded cases live in your browser's localStorage.
Use the **dev role switcher** in the sidebar to act as WM requester, AEP processor, AEP reviewer, compliance
reviewer, administrator or auditor. **Reset placeholder data** puts the seed back.

## Run it against a real database (no Docker)

```bash
npm run stack:app    # embedded Postgres 17 + PostgREST 16 + storage gateway, then next dev on :3000 in http mode
# second terminal
INTEGRATION_BASE_URL=http://localhost:3000 npm test -- integration
```

`scripts/local-stack/start.mjs` applies the same four SQL files the shared project receives, seeds the six dev
users, and emulates the Storage upload / signed-URL / auth-admin endpoints the app calls. Data lives in
`.local-stack/` (`npm run stack:reset` wipes it). The PostgREST binary is expected at `.local-stack/bin/postgrest.exe`
(download `postgrest-v16.3-windows-x86-64.zip` from GitHub and unzip it there; `.local-stack` is git-ignored).

## Checks

```bash
npm run typecheck
npm run lint
npm test             # unit tests (pure workflow, access rules, CSV, templates)
npm run db:validate  # applies all SQL to an in-process Postgres and checks RLS, triggers, RPC (no Docker needed)
npm run build
```

`npx` fails on paths containing parentheses; the npm scripts call the binaries directly.

## Modes

| Variable | Values | Meaning |
|---|---|---|
| `NEXT_PUBLIC_DATA_SOURCE` | `mock` / `http` | in-browser placeholder data, or the `/api` routes backed by Supabase |
| `AUTH_MODE` + `NEXT_PUBLIC_AUTH_MODE` | `dev` / `supabase` | `dev` picks the role from an `x-dev-role` header (refused in production builds); `supabase` uses the session cookie and `trust_reg.profiles` |
| `NOTIFICATION_PROVIDER` | `console` / `resend` / `sendgrid` | where WM and AEP emails go |

One template, `.env.example`, documents every variable and four presets (placeholder demo, local real database,
shared AWM project, Docker). Copy it to `.env.local`; that single file is read by Next, the integration test and
Docker Compose alike.

## How the workflow works

1. **WM raises a request** (`/cases/new`): client, trust, provider, priority, target date.
2. **AEP decides** per jurisdiction whether TRS and/or CRBOT registration is required, with the reason and statutory
   deadline. The case is *blocked* until required registrations move.
3. **AEP registers**: ready → in progress → submitted, with a pre-submission checklist and authority queries.
4. **AEP uploads the certificate** (PDF, image or Word). It is stored in a private bucket, hashed and versioned.
5. **A different person verifies** the document and the requirement (maker-checker), entering the URN / UTR /
   register number. When every required registration is verified the **activation gate opens** and the requesting
   WM user is emailed.
6. **AEP hands the pack back**; WM downloads the certificates from the case page (5-minute signed URLs) and submits
   them to the provider.
7. **WM closes the case** once the provider accepts the trust.

Every step is an append-only event. The audit page filters by event type and date and exports CSV. A daily job
flips cases to *overdue* when a deadline passes and emails reminders as deadlines approach.

## Layout

```
src/
  app/(app)/          dashboard, cases/new, cases/[id], audit   (client pages)
  app/api/            route handlers (zod-validated, role-guarded)
  app/login/          Supabase email/password sign-in
  proxy.ts            session redirect to /login (http + supabase mode only)
  components/         UI primitives, case panels (requirements, documents, confirmation, timeline)
  lib/api/            TrustRegApi interface, httpClient, mockClient
  lib/session/        SessionProvider, dev role
  server/domain/      enums and row types (mirror prisma/schema.prisma)
  server/workflow/    state machine, status derivations (pure, tested)
  server/services/    trust cases, requirements, documents, storage, events, notifications, jobs
  server/auth/        session resolution, role guards
prisma/               schema + generated initial migration
supabase/sql/         001 RLS & constraints, 002 dev seed, 003 evidence bucket
```

## Docker

The image is a multi-stage build on `node:22-alpine` using Next's standalone output. It runs as a non-root user,
exposes port 3000 and answers `GET /api/health` for the container healthcheck.

```bash
cp .env.example .env.local               # preset D: http + supabase, fill in keys and cron secret
npm run docker:up                        # build + start, http://localhost:3000
npm run docker:logs
npm run docker:migrate                   # prisma migrate deploy against DATABASE_URL (once Colin has created trust_reg)
npm run docker:down
```

What goes where:

| Value | Where it is read | Why |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_DATA_SOURCE`, `NEXT_PUBLIC_AUTH_MODE` | build args (compiled into the browser bundle) | change them → rebuild the image |
| `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_MODE`, email, storage, `CRON_SECRET` | runtime env (`env_file: .env.local`) | one image can be promoted between environments |
| `DATABASE_URL` | `migrator` service only | the app itself never opens a Postgres connection |

`.env*` files are excluded from the build context by `.dockerignore`, so no secret is baked into a layer.

Compose services:

- `app` — the Next.js server (read-only root filesystem, tmpfs for `/tmp` and the Next cache).
- `migrator` (profile `tools`) — `prisma migrate deploy`; override the command for `migrate status` etc.
- `cron` (profile `jobs`) — tiny curl loop that calls `/api/jobs/daily` once a day at `DAILY_JOB_UTC`. Use it only
  where the host has no scheduler; on Google Cloud the deploy script creates a Cloud Scheduler job instead.

Build the image by hand:

```bash
docker build -t awm/trust-reg:1.0.0 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  --build-arg NEXT_PUBLIC_DATA_SOURCE=http \
  --build-arg NEXT_PUBLIC_AUTH_MODE=supabase .
docker run --rm -p 3000:3000 --env-file .env.local awm/trust-reg:1.0.0
```

For a placeholder-mode demo container (no database at all), build with `NEXT_PUBLIC_DATA_SOURCE=mock` and any
non-empty values for the two Supabase build args.

## Deploy to Google Cloud (Cloud Run)

```bash
gcloud auth login
PROJECT_ID=<gcp-project> REGION=europe-west2 bash deploy/gcloud/deploy.sh
```

Builds with Cloud Build (no local Docker), stores the service role key, cron secret and Resend key in Secret
Manager, deploys Cloud Run, and creates the Cloud Scheduler job for `/api/jobs/daily`. Details, email setup and
custom domains: [`deploy/gcloud/README.md`](deploy/gcloud/README.md).

## Going live

Follow `PROVISIONING.md` with Colin, set the real keys, switch to `http` + `supabase`, then run the integration
test described there. Hosting is Google Cloud Run via `deploy/gcloud/deploy.sh`; the same image runs anywhere
containers run.
