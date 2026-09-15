# Deploying to Google Cloud

Cloud Run hosts the container, Cloud Build builds it (no Docker on your laptop), Secret Manager holds the keys,
Cloud Scheduler calls the daily job. Cost at AWM's volume: effectively the Cloud Run free tier.

## Path A: continuous deployment from GitHub (what is set up today)

Service `trsandcrbot-trustregistration`, region `europe-west1`, project `myeventerimporter`, connected to
`requests-awm/TRSandCRBOT_TrustRegistration` (branch `main`). Every push builds the **repository-root `Dockerfile`**
and deploys the image. Until the first successful build Cloud Run serves its "sad unicorn" placeholder page.

Why the first builds failed, and what changed:

1. The Dockerfile used to live in `app/trust-reg/`; the trigger's default source location is `/Dockerfile` at the
   repository root. It now lives at the root and copies `app/trust-reg` into the image.
2. The repository trigger passes no `--build-arg`s, and Next.js bakes `NEXT_PUBLIC_*` values in at build time. The
   app now reads all configuration at request time (`src/lib/publicConfig.ts`, `src/server/env.ts`), so the same
   image works with whatever environment variables the Cloud Run service carries.

Steps, once, after `gcloud auth login` (needs a browser, so run it in your own terminal):

```bash
# 1. configure the existing service: secrets, env vars, port, scheduler job (reads app/trust-reg/.env.local)
PROJECT_ID=myeventerimporter REGION=europe-west1 SERVICE=trsandcrbot-trustregistration \
  bash app/trust-reg/deploy/gcloud/configure-service.sh

# 2. commit and push; the trigger builds the root Dockerfile and deploys a real revision
git add -A && git commit -m "Root Dockerfile and runtime config for Cloud Run" && git push

# 3. watch the build, then check the service
gcloud builds list --region=europe-west1 --limit=3
curl https://<service-url>/api/health      # dataSource=http, authMode=supabase, supabaseConfigured=true
```

`configure-service.sh` needs real values in `.env.local` for `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable /
anon key from Supabase → Project Settings → API), `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET`. It refuses to run
while any of them is still `REPLACE_ME`. If the trigger's "Source location" was changed from `/Dockerfile`, set it
back to `/Dockerfile` in Cloud Build → Triggers.

Production images refuse `AUTH_MODE=dev`, so sign-in on Cloud Run is always Supabase Auth: users must exist in
`auth.users` with a matching `trust_reg.profiles` row, and the service URL must be in Supabase Auth → URL
Configuration → Redirect URLs.

## Path B: one-command deploy from this laptop (`deploy.sh`)

## Prerequisites
- `gcloud auth login` as an account with Owner or Editor on the target project, and billing enabled on the project.
- `.env.local` filled in: Supabase URL, publishable/anon key, service role key, `CRON_SECRET`, optionally
  `RESEND_API_KEY`.
- Supabase Auth: add the Cloud Run URL to Authentication → URL Configuration → Redirect URLs once known.

## One command

```bash
PROJECT_ID=<gcp-project> REGION=europe-west2 bash deploy/gcloud/deploy.sh
```

What it does, all idempotent:

1. Enables Run, Cloud Build, Artifact Registry, Secret Manager, Scheduler, IAM.
2. Creates Artifact Registry repo `awm` and service account `trust-reg-run`.
3. Writes three secrets: `trust-reg-supabase-service-role-key`, `trust-reg-cron-secret`, `trust-reg-resend-api-key`,
   and grants the service account access.
4. Runs `cloudbuild.yaml`: builds the `runner` image with the `NEXT_PUBLIC_*` build args, pushes it, deploys Cloud Run
   on port 3000, 512 MiB, 0 to 3 instances, secrets mounted as env vars.
5. Sets `APP_BASE_URL` to the service URL and `NOTIFICATION_PROVIDER` to `resend` if a key is present.
6. Creates Cloud Scheduler job `trust-reg-daily` (weekdays 06:00 UTC) that GETs `/api/jobs/daily` with the bearer secret.

## After deploying
- Open `<url>/api/health`, then `<url>/login`.
- Custom domain: Cloud Run → Manage custom domains, or put it behind the AWM load balancer; then re-run with
  `APP_BASE_URL` updated (`gcloud run services update trust-reg --update-env-vars APP_BASE_URL=https://...`).
- Rotate a secret: change it in `.env.local` and re-run the script; Cloud Run picks up `:latest` on the next revision.

## Email: Resend
1. Create a Resend account, add and verify the `ascotwm.com` sending domain (SPF + DKIM records).
2. Create an API key with send permission, put it in `.env.local` as `RESEND_API_KEY`.
3. Re-run the deploy script. The provider switches from `console` to `resend` automatically.
SendGrid works the same way with `SENDGRID_API_KEY` and `NOTIFICATION_PROVIDER=sendgrid` (edit the script's provider
line or set it with `gcloud run services update`).

## Notes
- Cloud Run injects `PORT`; the image honours it (`--port=3000` keeps it at 3000).
- The container filesystem is read-only apart from `/tmp`; the app writes nothing locally.
- `AUTH_MODE=dev` is refused by production builds, so the deployed service always uses Supabase sign-in.
