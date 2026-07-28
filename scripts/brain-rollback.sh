#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="${KERNEL_RELEASE_DEPLOY_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
IMMUTABLE_COMPOSE_FILE="$(cd "$SCRIPT_DIR/.." && pwd)/docker-compose.yml"
VERSIONS_FILE="$ROOT_DIR/.brain-versions"
ENV_REGION="${ENV_REGION:-us}"
BRAIN_HEALTH_URL="${BRAIN_URL:-http://localhost:5221}/api/brain/tick/status"

# Rollback has its own one-shot durable authority. A production deploy intent
# is deliberately insufficient.
bash "$SCRIPT_DIR/lib/release-run-rollback-guard.sh"

EXPECTED_CURRENT_DIGEST="${KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_DIGEST:-}"
ACTUAL_CURRENT_DIGEST=$(docker inspect cecelia-node-brain \
  --format '{{.Image}}' 2>/dev/null || true)
if [[ ! "$EXPECTED_CURRENT_DIGEST" =~ ^sha256:[0-9a-f]{64}$ \
   || "$ACTUAL_CURRENT_DIGEST" != "$EXPECTED_CURRENT_DIGEST" ]]; then
  echo "[ERROR] Current Brain image does not match durable authority." >&2
  exit 78
fi

# Determine target version
if [ $# -ge 1 ]; then
  TARGET="$1"
else
  # Auto: pick the second-to-last line in .brain-versions
  if [ ! -f "$VERSIONS_FILE" ] || [ "$(wc -l < "$VERSIONS_FILE")" -lt 2 ]; then
    echo "[ERROR] No previous version found in .brain-versions"
    echo "Usage: $0 [version]"
    exit 1
  fi
  TARGET=$(tail -2 "$VERSIONS_FILE" | head -1)
fi

echo "=== Rolling back to cecelia-brain:${TARGET} ==="

# Verify image exists locally
if ! docker image inspect "cecelia-brain:${TARGET}" > /dev/null 2>&1; then
  echo "[ERROR] Image cecelia-brain:${TARGET} not found locally."
  echo "Available images:"
  docker images cecelia-brain --format "  {{.Tag}}  {{.Size}}  {{.CreatedSince}}"
  exit 1
fi
EXPECTED_DIGEST="${KERNEL_RELEASE_ROLLBACK_EXPECTED_DIGEST:-}"
ACTUAL_DIGEST=$(docker image inspect "cecelia-brain:${TARGET}" --format '{{.Id}}' 2>/dev/null || true)
if [[ ! "$EXPECTED_DIGEST" =~ ^sha256:[0-9a-f]{64}$ \
   || "$ACTUAL_DIGEST" != "$EXPECTED_DIGEST" ]]; then
  echo "[ERROR] Rollback image digest does not match durable authority." >&2
  exit 78
fi

# Stop current + start target
BRAIN_VERSION="${TARGET}" ENV_REGION="${ENV_REGION}" \
  docker compose --env-file "$ROOT_DIR/.env.docker" \
    --project-directory "$ROOT_DIR" \
    -f "$IMMUTABLE_COMPOSE_FILE" up -d

# Wait for healthy (max 60s)
echo ""
echo "Waiting for health check..."
TRIES=0
MAX_TRIES=12
while [ $TRIES -lt $MAX_TRIES ]; do
  sleep 5
  TRIES=$((TRIES + 1))
  if curl -sf "$BRAIN_HEALTH_URL" > /dev/null 2>&1; then
    echo ""
    echo "=== Rollback SUCCESS: cecelia-brain v${TARGET} is healthy ==="
    exit 0
  fi
  echo "  Attempt ${TRIES}/${MAX_TRIES}..."
done

echo ""
echo "[FAIL] Rollback health check timed out after 60s."
exit 1
