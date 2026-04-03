#!/bin/bash
# Register this AnyDev container with as-enterprise (tas.woa.com)
# Called after pm2 starts ClawStudio

TAS_URL="${TAS_URL:-https://tas.woa.com}"
REGISTER_KEY="${ANYDEV_REGISTER_KEY:-}"
MAX_RETRIES=30
RETRY_INTERVAL=2

if [ -z "$REGISTER_KEY" ]; then
  echo "[anydev-register] ANYDEV_REGISTER_KEY not set, skipping registration"
  exit 0
fi

if [ -z "$ANY_LOGIN_USER" ] || [ -z "$ANY_ENVID" ] || [ -z "$ANY_HOST" ]; then
  echo "[anydev-register] AnyDev env vars not found (ANY_LOGIN_USER, ANY_ENVID, ANY_HOST)"
  echo "[anydev-register] Running outside AnyDev? Skipping registration"
  exit 0
fi

echo "[anydev-register] Waiting for ClawStudio to be ready..."
for i in $(seq 1 $MAX_RETRIES); do
  if curl -sf http://localhost:80/api/health > /dev/null 2>&1; then
    echo "[anydev-register] ClawStudio is ready (attempt $i)"
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo "[anydev-register] ClawStudio not ready after ${MAX_RETRIES} attempts, registering anyway"
  fi
  sleep $RETRY_INTERVAL
done

echo "[anydev-register] Registering with $TAS_URL ..."
RESPONSE=$(curl -sf -X POST "${TAS_URL}/api/v1/anydev/register" \
  -H "Content-Type: application/json" \
  -H "X-Register-Key: ${REGISTER_KEY}" \
  -d "{
    \"anydev_username\": \"${ANY_LOGIN_USER}\",
    \"anydev_envid\": \"${ANY_ENVID}\",
    \"anydev_host\": \"${ANY_HOST}\",
    \"anydev_envname\": \"${ANY_ENVNAME:-}\"
  }" 2>&1)

if [ $? -eq 0 ]; then
  echo "[anydev-register] Registration successful:"
  echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

  WORKSPACE_KEY=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['unified_url'])" 2>/dev/null)
  if [ -n "$WORKSPACE_KEY" ]; then
    echo "[anydev-register] Unified URL: $WORKSPACE_KEY"
  fi
else
  echo "[anydev-register] Registration failed: $RESPONSE"
  echo "[anydev-register] ClawStudio still works locally via AnyDev domain"
fi
