#!/bin/bash
# Heartbeat - Self-monitoring and auto-enqueue
# Checks system health and triggers worker if needed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_FILE="$PROJECT_ROOT/state/state.json"
GATEWAY="$PROJECT_ROOT/gateway/gateway.sh"
WORKER="$PROJECT_ROOT/worker/worker.sh"

# Ensure state file exists
if [[ ! -f "$STATE_FILE" ]]; then
  mkdir -p "$(dirname "$STATE_FILE")"
  echo '{"lastRun": null, "queueLength": 0, "health": "ok"}' > "$STATE_FILE"
fi

# Function: Check system health
check_health() {
  echo "🩺 Health Check"

  # Check 1: State file readable
  if ! jq empty "$STATE_FILE" 2>/dev/null; then
    echo "  ❌ State file corrupted"
    return 1
  fi

  # Check 2: Gateway script exists and executable
  if [[ ! -x "$GATEWAY" ]]; then
    echo "  ❌ Gateway not executable"
    return 1
  fi

  # Check 3: Worker script exists and executable
  if [[ ! -x "$WORKER" ]]; then
    echo "  ❌ Worker not executable"
    return 1
  fi

  echo "  ✅ All systems operational"
  return 0
}

# Function: Check for anomalies (placeholder for future logic)
check_anomalies() {
  echo "🔍 Checking for anomalies..."

  # Placeholder: Check for drift, outdated contracts, etc.
  # For MVP, just return no anomalies

  echo "  ✅ No anomalies detected"
  return 0
}

# Function: Trigger worker if queue not empty
trigger_worker() {
  local queue_length
  queue_length=$(jq -r '.queueLength // 0' "$STATE_FILE")

  if [[ "$queue_length" -gt 0 ]]; then
    echo "🚀 Queue has $queue_length tasks, triggering worker..."
    bash "$WORKER"
    return 0
  else
    echo "📭 Queue is empty, no action needed"
    return 0
  fi
}

# Main
main() {
  echo "💓 Heartbeat - $(date)"
  echo ""

  # Step 1: Health check
  if ! check_health; then
    echo "❌ Health check failed"
    jq '.health = "unhealthy"' "$STATE_FILE" > "$STATE_FILE.tmp"
    mv "$STATE_FILE.tmp" "$STATE_FILE"
    exit 1
  fi

  # Update health status
  jq '.health = "ok"' "$STATE_FILE" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"

  # Step 2: Check for anomalies
  if ! check_anomalies; then
    echo "⚠️  Anomalies detected, enqueuing self-check task..."

    # Auto-enqueue a self-check task
    bash "$GATEWAY" add heartbeat optimizeSelf P1 '{"reason":"anomaly_detected"}'
  fi

  # Step 3: Trigger worker if queue not empty
  trigger_worker

  echo ""
  echo "✅ Heartbeat complete"

  exit 0
}

main "$@"
