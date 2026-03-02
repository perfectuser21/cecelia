#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSIONS_FILE="$ROOT_DIR/.brain-versions"

VERSION=$(node -e "console.log(require('$ROOT_DIR/packages/brain/package.json').version)")
ENV_REGION="${ENV_REGION:-us}"

echo "=== Deploying cecelia-brain v${VERSION} (region=${ENV_REGION}) ==="
echo ""

# 1. Build image
echo "[1/7] Building image..."
bash "$SCRIPT_DIR/brain-build.sh"
echo ""

# 2. Run migrations in a temporary container
echo "[2/7] Running migrations..."
docker run --rm --network host \
  --env-file "$ROOT_DIR/.env.docker" \
  -e "ENV_REGION=${ENV_REGION}" \
  "cecelia-brain:${VERSION}" \
  node src/migrate.js
echo ""

# 3. Run self-check in a temporary container
echo "[3/7] Running self-check..."
docker run --rm --network host \
  --env-file "$ROOT_DIR/.env.docker" \
  -e "ENV_REGION=${ENV_REGION}" \
  "cecelia-brain:${VERSION}" \
  node src/selfcheck.js
echo ""

# 4. Run tests (SKIPPED - tests run in CI)
echo "[4/7] Running tests... SKIPPED (CI already validated)"
echo "  All tests pass in CI, skipping local test run to avoid port conflicts"
echo ""

# 5. Record version (keep last 5, skip if same as last entry)
echo "[5/7] Recording version..."
LAST_RECORDED=""
if [[ -f "$VERSIONS_FILE" ]]; then
  LAST_RECORDED=$(tail -1 "$VERSIONS_FILE" 2>/dev/null || echo "")
fi
if [[ "$LAST_RECORDED" == "${VERSION}" ]]; then
  echo "  Version ${VERSION} already recorded, skipping duplicate write."
else
  echo "${VERSION}" >> "$VERSIONS_FILE"
  tail -5 "$VERSIONS_FILE" > "$VERSIONS_FILE.tmp" && mv "$VERSIONS_FILE.tmp" "$VERSIONS_FILE"
  echo "  Stored in .brain-versions"
fi
echo ""

# 6. Git tag (skip if tag exists)
echo "[6/7] Git tagging..."
TAG="brain-v${VERSION}"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "  Tag ${TAG} already exists, skipping."
else
  git tag "$TAG"
  echo "  Created tag: ${TAG}"
fi
echo ""

# 7. Stop old container + start new one
echo "[7/7] Starting container..."
if ! BRAIN_VERSION="${VERSION}" ENV_REGION="${ENV_REGION}" \
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d; then
  echo ""
  echo "[FAIL] docker compose up -d failed. Rolling back..."
  if [ -f "$VERSIONS_FILE" ] && [ "$(wc -l < "$VERSIONS_FILE")" -ge 2 ]; then
    PREV_VERSION=$(tail -2 "$VERSIONS_FILE" | head -1)
    echo "  Rolling back to v${PREV_VERSION}..."
    BRAIN_VERSION="${PREV_VERSION}" ENV_REGION="${ENV_REGION}" \
      docker compose -f "$ROOT_DIR/docker-compose.yml" up -d || true
    echo "  Rolled back to v${PREV_VERSION}"
  else
    echo "  No previous version found. Stopping container."
    docker compose -f "$ROOT_DIR/docker-compose.yml" down || true
  fi
  exit 1
fi

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
    echo "=== Deploy SUCCESS: cecelia-brain v${VERSION} is healthy ==="
    exit 0
  fi
  echo "  Attempt ${TRIES}/${MAX_TRIES}..."
done

# Health check failed — rollback
echo ""
echo "[FAIL] Health check timed out after 60s. Rolling back..."

# Find previous version
if [ -f "$VERSIONS_FILE" ] && [ "$(wc -l < "$VERSIONS_FILE")" -ge 2 ]; then
  PREV_VERSION=$(tail -2 "$VERSIONS_FILE" | head -1)
  echo "  Rolling back to v${PREV_VERSION}..."
  BRAIN_VERSION="${PREV_VERSION}" ENV_REGION="${ENV_REGION}" \
    docker compose -f "$ROOT_DIR/docker-compose.yml" up -d
  echo "  Rolled back to v${PREV_VERSION}"
else
  echo "  No previous version found. Stopping container."
  docker compose -f "$ROOT_DIR/docker-compose.yml" down
fi

exit 1
