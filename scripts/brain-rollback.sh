#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_REGION="${ENV_REGION:-us}"
source "$SCRIPT_DIR/lib/brain-image-retention.sh"

# 显式目标是恢复原语；构建版本表不能证明哪个版本曾健康运行。
[[ $# == 1 && -n "$1" ]] || { echo 'ROLLBACK_TARGET_REQUIRED：必须提供明确恢复目标' >&2; exit 1; }
TARGET="$1"

echo "=== Rolling back to cecelia-brain:${TARGET} ==="

# Verify image exists locally
if ! docker image inspect "cecelia-brain:${TARGET}" > /dev/null 2>&1; then
  echo "[ERROR] Image cecelia-brain:${TARGET} not found locally."
  echo "Available images:"
  docker images cecelia-brain --format "  {{.Tag}}  {{.Size}}  {{.CreatedSince}}"
  exit 1
fi

TARGET_SHA=$(docker image inspect "cecelia-brain:${TARGET}" --format '{{json .Config.Env}}' | node -e '
 const env=JSON.parse(require("fs").readFileSync(0,"utf8"));const sha=env.filter(x=>x.startsWith("GIT_SHA="));
 if(sha.length!==1)process.exit(1);process.stdout.write(sha[0].slice(8));' || true)
TARGET_IMAGE=$(docker image inspect "cecelia-brain:${TARGET}" --format '{{.Id}}')
[[ "$TARGET_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
retention_rollback "$TARGET" "$TARGET_SHA" "$TARGET_IMAGE"
trap 'retention_finish recovered || true' EXIT
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
if [[ "$(uname -s)" == Linux ]]; then COMPOSE_FILE="$ROOT_DIR/docker-compose.us-vps.yml"; fi

# Stop current + start target
BRAIN_VERSION="${TARGET}" ENV_REGION="${ENV_REGION}" \
  docker compose ${RETENTION_COMPOSE_ARGS[@]+"${RETENTION_COMPOSE_ARGS[@]}"} --env-file "$ROOT_DIR/.env.docker" \
    -f "$COMPOSE_FILE" -f "$ROOT_DIR/docker-compose.image-rollback.yml" up -d node-brain

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
    retention_finish "$CECELIA_ROLLBACK_OUTCOME"
    trap - EXIT
    echo "=== Rollback SUCCESS: cecelia-brain v${TARGET} is healthy ==="
    exit 0
  fi
  echo "  Attempt ${TRIES}/${MAX_TRIES}..."
done

echo ""
echo "[FAIL] Rollback health check timed out after 60s."
exit 1
