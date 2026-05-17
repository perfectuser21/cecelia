#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSIONS_FILE="$ROOT_DIR/.brain-versions"
ENV_REGION="${ENV_REGION:-us}"

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

# Stop current + start target
BRAIN_VERSION="${TARGET}" ENV_REGION="${ENV_REGION}" \
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d

# Wait for healthy (max 60s)
echo ""
echo "Waiting for health check..."
TRIES=0
MAX_TRIES=12
while [ $TRIES -lt $MAX_TRIES ]; do
  sleep 5
  TRIES=$((TRIES + 1))
  if curl -sf http://localhost:5221/api/brain/tick/status > /dev/null 2>&1; then
    echo ""
    echo "=== Rollback SUCCESS: cecelia-brain v${TARGET} is healthy ==="
    exit 0
  fi
  echo "  Attempt ${TRIES}/${MAX_TRIES}..."
done

echo ""
echo "[FAIL] Rollback health check timed out after 60s."
exit 1
