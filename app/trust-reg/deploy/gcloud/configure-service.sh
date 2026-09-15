#!/usr/bin/env bash
# Configure an EXISTING Cloud Run service that was created by the console's
# "Continuously deploy from a repository" flow (Cloud Build builds the root Dockerfile on every push).
#
#   PROJECT_ID=myeventerimporter REGION=europe-west1 SERVICE=trsandcrbot-trustregistration \
#     bash app/trust-reg/deploy/gcloud/configure-service.sh
#
# Reads .env.local (never committed), stores the three secrets in Secret Manager, grants the service's
# runtime service account access, and sets every runtime environment variable the app needs. The build
# itself stays with the repository trigger; this only shapes the service the trigger deploys into.
# Re-running is safe: every step is create-or-update. Run `gcloud auth login` first.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-trsandcrbot-trustregistration}"
ENV_FILE="${ENV_FILE:-$(dirname "$0")/../../.env.local}"
SCHEDULE="${SCHEDULE:-0 6 * * 1-5}"
[[ -n "$PROJECT_ID" ]] || { echo "Set PROJECT_ID or gcloud config set project"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE"; exit 1; }

envval() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/^"//; s/"$//; s/^[[:space:]]+//; s/[[:space:]]+$//'; }
SUPABASE_URL="$(envval NEXT_PUBLIC_SUPABASE_URL)"
SUPABASE_ANON_KEY="$(envval NEXT_PUBLIC_SUPABASE_ANON_KEY)"
SERVICE_ROLE_KEY="$(envval SUPABASE_SERVICE_ROLE_KEY)"
CRON_SECRET="$(envval CRON_SECRET)"
RESEND_API_KEY="$(envval RESEND_API_KEY)"
AUTH_MODE_VALUE="${AUTH_MODE_OVERRIDE:-supabase}"   # production builds refuse AUTH_MODE=dev anyway
for v in SUPABASE_URL SUPABASE_ANON_KEY SERVICE_ROLE_KEY CRON_SECRET; do
  [[ -n "${!v}" && "${!v}" != *REPLACE_ME* ]] || { echo "$v is missing or still a placeholder in $ENV_FILE"; exit 1; }
done
NOTIFICATION_PROVIDER=console
[[ -n "$RESEND_API_KEY" && "$RESEND_API_KEY" != *REPLACE_ME* ]] && NOTIFICATION_PROVIDER=resend

echo "== project $PROJECT_ID, region $REGION, service $SERVICE, email provider $NOTIFICATION_PROVIDER"
gcloud config set project "$PROJECT_ID" >/dev/null
gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com >/dev/null

echo "== runtime service account of the service"
SA="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"
if [[ -z "$SA" ]]; then
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi
echo "   $SA"

upsert_secret() { # name value
  if gcloud secrets describe "$1" >/dev/null 2>&1; then
    printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- >/dev/null
  else
    printf '%s' "$2" | gcloud secrets create "$1" --replication-policy=automatic --data-file=- >/dev/null
  fi
  gcloud secrets add-iam-policy-binding "$1" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
}
echo "== secrets"
upsert_secret trust-reg-supabase-service-role-key "$SERVICE_ROLE_KEY"
upsert_secret trust-reg-cron-secret "$CRON_SECRET"
upsert_secret trust-reg-resend-api-key "${RESEND_API_KEY:-unset}"

echo "== service environment"
URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
# A value set by hand as a plain env var cannot also be mounted from Secret Manager under the same name,
# so drop any literal copies of the three secrets first (no-op when they are not present).
gcloud run services update "$SERVICE" --region="$REGION" \
  --remove-env-vars="SUPABASE_SERVICE_ROLE_KEY,CRON_SECRET,RESEND_API_KEY" >/dev/null 2>&1 || true
gcloud run services update "$SERVICE" --region="$REGION" \
  --port=3000 --cpu=1 --memory=512Mi --min-instances=0 --max-instances=3 --timeout=300 \
  --update-env-vars="^|^NODE_ENV=production|AUTH_MODE=${AUTH_MODE_VALUE}|NEXT_PUBLIC_AUTH_MODE=${AUTH_MODE_VALUE}|NEXT_PUBLIC_DATA_SOURCE=http|NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}|NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}|EVIDENCE_BUCKET=trust-registration-evidence|MAX_UPLOAD_BYTES=26214400|DEADLINE_WARNING_DAYS=14|STALE_AFTER_DAYS=14|WM_NOTIFY_ON=milestones|NOTIFICATION_FROM_EMAIL=trust-registration@ascotwm.com|NOTIFICATION_PROVIDER=${NOTIFICATION_PROVIDER}|APP_BASE_URL=${URL}" \
  --update-secrets="SUPABASE_SERVICE_ROLE_KEY=trust-reg-supabase-service-role-key:latest,CRON_SECRET=trust-reg-cron-secret:latest,RESEND_API_KEY=trust-reg-resend-api-key:latest" >/dev/null

echo "== cloud scheduler: daily job"
JOB="${SERVICE}-daily"
if gcloud scheduler jobs describe "$JOB" --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB" --location="$REGION" --schedule="$SCHEDULE" --time-zone=UTC \
    --uri="$URL/api/jobs/daily" --http-method=GET --update-headers="Authorization=Bearer $CRON_SECRET" >/dev/null
else
  gcloud scheduler jobs create http "$JOB" --location="$REGION" --schedule="$SCHEDULE" --time-zone=UTC \
    --uri="$URL/api/jobs/daily" --http-method=GET --headers="Authorization=Bearer $CRON_SECRET" >/dev/null
fi

echo
echo "Configured: $URL"
echo "Health:     $URL/api/health   (expect dataSource=http, authMode=$AUTH_MODE_VALUE, supabaseConfigured=true)"
echo "Next push to the connected branch rebuilds and deploys; the settings above persist across revisions."
echo "Supabase Auth -> URL Configuration: add $URL to Redirect URLs."
