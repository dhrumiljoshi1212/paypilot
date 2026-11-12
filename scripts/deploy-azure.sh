#!/usr/bin/env bash
# Deploy PayPilot to Azure App Service (Linux, Node 22, single instance).
# Secrets are read from .env and set as App Settings; they are never committed.
#
# Usage: scripts/deploy-azure.sh [app-name] [resource-group] [location]
set -euo pipefail

APP_NAME="${1:-paypilot-$(openssl rand -hex 3)}"
RG="${2:-paypilot-rg}"
LOCATION="${3:-eastus}"
PLAN="${APP_NAME}-plan"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ -f .env ] || { echo "Missing .env"; exit 1; }
set -a; . ./.env; set +a

az group create -n "$RG" -l "$LOCATION" -o none
az appservice plan create -g "$RG" -n "$PLAN" --is-linux --sku B1 -o none
az webapp create -g "$RG" -p "$PLAN" -n "$APP_NAME" --runtime "NODE:22-lts" -o none

HOST="$(az webapp show -g "$RG" -n "$APP_NAME" --query defaultHostName -o tsv)"
APP_URL="https://${HOST}"

az webapp config set -g "$RG" -n "$APP_NAME" \
  --startup-file "npm start" --always-on true --http20-enabled true -o none
az webapp update -g "$RG" -n "$APP_NAME" --https-only true -o none

az webapp config appsettings set -g "$RG" -n "$APP_NAME" -o none --settings \
  SCM_DO_BUILD_DURING_DEPLOYMENT=true \
  WEBSITES_ENABLE_APP_SERVICE_STORAGE=true \
  WEBSITES_CONTAINER_START_TIME_LIMIT=600 \
  NODE_ENV=production \
  APP_URL="$APP_URL" \
  PAYPAL_BASE_URL="${PAYPAL_BASE_URL:-https://api-m.sandbox.paypal.com}" \
  PAYPAL_CLIENT_ID="${PAYPAL_CLIENT_ID:-}" \
  PAYPAL_CLIENT_SECRET="${PAYPAL_CLIENT_SECRET:-}" \
  PAYPAL_WEBHOOK_ID="${PAYPAL_WEBHOOK_ID:-}" \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
  ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-claude-sonnet-5-5}" \
  DATABASE_PATH=/home/data/paypilot.db \
  SQLITE_JOURNAL_MODE=DELETE \
  DEMO_MODE="${DEMO_MODE:-false}" \
  ALLOW_LIVE_PAYPAL=false

# Package source from git (excludes .env, data/, node_modules, .next); Oryx builds on Linux
ZIP="$(mktemp -d)/paypilot.zip"
git archive --format=zip -o "$ZIP" HEAD
az webapp deploy -g "$RG" -n "$APP_NAME" --src-path "$ZIP" --type zip --async false --timeout 900000

echo "Deployed: $APP_URL"
echo "Health:   $APP_URL/api/health"
