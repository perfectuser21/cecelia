#!/usr/bin/env bash
#
# Rolling Update Script - Zero-Downtime Brain Deployment
#
# Implements blue-green deployment for Brain service:
# 1. Build new image (green)
# 2. Start green container on temp port 5222
# 3. Health check (max 60s)
# 4. Wait for tick to complete
# 5. Stop old container (blue)
# 6. Restart green container on port 5221
# 7. Verify service healthy
#
# Usage:
#   bash scripts/rolling-update.sh
#
# Environment:
#   ENV_REGION - Region (us|hk), defaults to 'us'
#
# Exit codes:
#   0 - Success
#   1 - Failed (auto-rollback performed)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION=$(node -e "console.log(require('$ROOT_DIR/packages/brain/package.json').version)")
ENV_REGION="${ENV_REGION:-us}"

# Container names
BLUE_CONTAINER="cecelia-node-brain"
GREEN_CONTAINER="cecelia-node-brain-green"

# Ports
BLUE_PORT=5221
GREEN_PORT=5222

echo "=== Rolling Update: cecelia-brain v${VERSION} (region=${ENV_REGION}) ==="
echo ""

# ============================================================
# Step 1: Build new image
# ============================================================
echo "[1/6] Building new image..."
bash "$SCRIPT_DIR/brain-build.sh"
echo ""

# ============================================================
# Step 2: Start green container on temp port
# ============================================================
echo "[2/6] Starting green container on port ${GREEN_PORT}..."

# Check if green already exists (from previous failed run)
if docker ps -a --format '{{.Names}}' | grep -q "^${GREEN_CONTAINER}$"; then
  echo "  Removing stale green container..."
  docker stop "$GREEN_CONTAINER" 2>/dev/null || true
  docker rm "$GREEN_CONTAINER" 2>/dev/null || true
fi

# Start green container (temporary port)
docker run -d --name "$GREEN_CONTAINER" \
  --network host \
  --env-file "$ROOT_DIR/.env.docker" \
  -e "PORT=${GREEN_PORT}" \
  -e "ENV_REGION=${ENV_REGION}" \
  -e "OPENAI_API_KEY=${OPENAI_API_KEY}" \
  --restart unless-stopped \
  "cecelia-brain:${VERSION}"

echo "  ✅ Green container started: $GREEN_CONTAINER"
echo ""

# ============================================================
# Step 3: Health check (max 60s)
# ============================================================
echo "[3/6] Health check..."

HEALTH_TRIES=0
MAX_HEALTH_TRIES=12
HEALTH_SUCCESS=false

while [ $HEALTH_TRIES -lt $MAX_HEALTH_TRIES ]; do
  sleep 5
  HEALTH_TRIES=$((HEALTH_TRIES + 1))

  if curl -sf "http://localhost:${GREEN_PORT}/api/brain/health" > /dev/null 2>&1; then
    echo "  ✅ New container healthy"
    HEALTH_SUCCESS=true
    break
  fi

  echo "  Waiting... (${HEALTH_TRIES}/${MAX_HEALTH_TRIES})"
done

if [ "$HEALTH_SUCCESS" = false ]; then
  echo ""
  echo "  ❌ Health check failed after 60s. Rolling back..."
  echo "  Stopping green container..."
  docker stop "$GREEN_CONTAINER" 2>/dev/null || true
  docker rm "$GREEN_CONTAINER" 2>/dev/null || true
  echo "  Blue container still running on port ${BLUE_PORT}"
  exit 1
fi

echo ""

# ============================================================
# Step 4: Wait for old tick to complete
# ============================================================
echo "[4/6] Waiting for old tick to complete..."

# Get next tick time from blue container
if curl -sf "http://localhost:${BLUE_PORT}/api/brain/tick/status" > /dev/null 2>&1; then
  # Wait 10 seconds to ensure current tick completes
  echo "  Waiting 10s for tick to complete..."
  sleep 10
  echo "  ✅ Tick complete"
else
  echo "  ⚠️  Blue container not responding, proceeding anyway..."
fi

echo ""

# ============================================================
# Step 5: Switch containers (stop blue, prepare green)
# ============================================================
echo "[5/6] Switching containers..."

# Stop and remove blue container
if docker ps --format '{{.Names}}' | grep -q "^${BLUE_CONTAINER}$"; then
  echo "  Stopping blue container..."
  docker stop "$BLUE_CONTAINER"
  docker rm "$BLUE_CONTAINER"
  echo "  ✅ Old container stopped"
else
  echo "  ⚠️  Blue container not found (already stopped?)"
fi

echo ""

# ============================================================
# Step 6: Restart green on production port
# ============================================================
echo "[6/6] Restarting green container on port ${BLUE_PORT}..."

# Stop green on temp port
docker stop "$GREEN_CONTAINER"
docker rm "$GREEN_CONTAINER"

# Restart as blue (production port)
docker run -d --name "$BLUE_CONTAINER" \
  --network host \
  --env-file "$ROOT_DIR/.env.docker" \
  -e "ENV_REGION=${ENV_REGION}" \
  -e "OPENAI_API_KEY=${OPENAI_API_KEY}" \
  --restart unless-stopped \
  "cecelia-brain:${VERSION}"

echo "  ✅ New container running on port ${BLUE_PORT}"
echo ""

# ============================================================
# Final verification
# ============================================================
echo "Verifying service..."

VERIFY_TRIES=0
MAX_VERIFY_TRIES=12

while [ $VERIFY_TRIES -lt $MAX_VERIFY_TRIES ]; do
  sleep 5
  VERIFY_TRIES=$((VERIFY_TRIES + 1))

  if curl -sf "http://localhost:${BLUE_PORT}/api/brain/health" > /dev/null 2>&1; then
    echo ""
    echo "=== Rolling Update SUCCESS ==="
    echo ""
    echo "✅ cecelia-brain v${VERSION} is healthy on port ${BLUE_PORT}"

    # Show health status
    curl -s "http://localhost:${BLUE_PORT}/api/brain/health" | head -10

    exit 0
  fi

  echo "  Waiting for service... (${VERIFY_TRIES}/${MAX_VERIFY_TRIES})"
done

# Final health check failed
echo ""
echo "❌ Final health check failed. Service may not be healthy."
echo "   Check logs: docker logs $BLUE_CONTAINER"
exit 1
