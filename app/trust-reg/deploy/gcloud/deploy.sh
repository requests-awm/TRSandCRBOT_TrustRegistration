#!/usr/bin/env bash
# One-shot Google Cloud deployment for the Trust Registration Monitor.
#
#   PROJECT_ID=my-gcp-project REGION=europe-west2 ./deploy/gcloud/deploy.sh
#
# Reads the Supabase URL/keys, CRON_SECRET and RESEND_API_KEY from ../../.env.local (never committed), stores the
# secrets in Secret Manager, builds the image with Cloud Build (no local Docker), deploys Cloud Run, and creates a
# Cloud Scheduler job that calls /api/jobs/daily every weekday at 06:00 UTC with the cron secret.
# Re-running is safe: every step is create-or-update.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-europe-west2}"
SERVICE="${SERVICE:-trust-reg}"
REPO="${REPO:-awm}"
ENV_FILE="${ENV_FILE:-$(dirname "$0")/../../.env.local}"
SCHEDULE="${SCHEDULE:-0 6 * * 1-5}"
[[ -n "$PROJECT_ID" ]] || { echo "Set PROJECT_ID or gcloud config set project"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE"; exit 1; }

envval() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -E 's/^"//; s/"$//'; }
SUPABASE_URL="$(envval NEXT_PUBLIC_SUPABASE_URL)"
SUPABASE_ANON_KEY="$(envval NEXT_PUBLIC_SUPABASE_ANON_KEY)"
SERVICE_ROLE_KEY="$(envval SUPABASE_SERVICE_ROLE_KEY)"
CRON_SECRET="$(envval CRON_SECRET)"
RESEND_API_KEY="$(envval RESEND_API_KEY)"
for v in SUPABASE_URL SUPABASE_ANON_KEY SERVICE_ROLE_KEY CRON_SECRET; do
  [[ -n "${!v}" && "${!v}" != *REPLACE_ME* ]] || { echo "$v is missing or still a placeholder in $ENV_FILE"; exit 1; }
done
NOTIFICATION_PROVIDER=console
[[ -n "$RESEND_API_KEY" && "$RESEND_API_KEY" != *REPLACE_ME* ]] && NOTIFICATION_PROVIDER=resend

echo "== project $PROJECT_ID, region $REGION, service $SERVICE, email provider $NOTIFICATION_PROVIDER"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "== enabling APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com iam.googleapis.com >/dev/null

echo "== artifact registry"
gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create "$REPO" --location="$REGION" --repository-format=docker >/dev/null

echo "== runtime service account"
SA="${SERVICE}-run@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "${SERVICE}-run" --display-name="Trust Registration Cloud Run runtime" >/dev/null

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

echo "== cloud build + deploy (this takes a few minutes)"
# Build context is the repository root, where the Dockerfile lives (app/trust-reg is copied from there).
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
gcloud builds submit "$REPO_ROOT" --config="$APP_DIR/deploy/gcloud/cloudbuild.yaml" \
  --substitutions="_REGION=$REGION,_SERVICE=$SERVICE,_REPO=$REPO,_SUPABASE_URL=$SUPABASE_URL,_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY,SHORT_SHA=$(date -u +%Y%m%d%H%M%S)"

URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
echo "== setting APP_BASE_URL and email provider"
gcloud run services update "$SERVICE" --region="$REGION" \
  --update-env-vars="APP_BASE_URL=$URL,NOTIFICATION_PROVIDER=$NOTIFICATION_PROVIDER" >/dev/null

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
echo "Deployed: $URL"
echo "Health:   $URL/api/health"
echo "Daily job: Cloud Scheduler '$JOB' ($SCHEDULE UTC)"
