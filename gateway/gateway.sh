#!/bin/bash
# Gateway - Unified Input Gateway for Cecelia System
# All inputs from different sources converge here

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
QUEUE_FILE="$PROJECT_ROOT/queue/queue.jsonl"
STATE_FILE="$PROJECT_ROOT/state/state.json"

# Ensure queue directory exists
mkdir -p "$(dirname "$QUEUE_FILE")"
mkdir -p "$(dirname "$STATE_FILE")"

# Initialize queue file if not exists
if [[ ! -f "$QUEUE_FILE" ]]; then
  touch "$QUEUE_FILE"
fi

# Initialize state file if not exists
if [[ ! -f "$STATE_FILE" ]]; then
  echo '{"lastRun": null, "queueLength": 0, "health": "ok"}' > "$STATE_FILE"
fi

# Function: Enqueue task
enqueue() {
  local task_json="$1"

  # Validate JSON format (basic check)
  if ! echo "$task_json" | jq empty 2>/dev/null; then
    echo "ERROR: Invalid JSON format" >&2
    return 1
  fi

  # Validate required fields
  local taskId source intent priority
  taskId=$(echo "$task_json" | jq -r '.taskId // empty')
  source=$(echo "$task_json" | jq -r '.source // empty')
  intent=$(echo "$task_json" | jq -r '.intent // empty')
  priority=$(echo "$task_json" | jq -r '.priority // empty')

  if [[ -z "$taskId" || -z "$source" || -z "$intent" || -z "$priority" ]]; then
    echo "ERROR: Missing required fields (taskId, source, intent, priority)" >&2
    return 1
  fi

  # Add timestamp if not present
  local timestamp
  timestamp=$(echo "$task_json" | jq -r '.createdAt // empty')
  if [[ -z "$timestamp" ]]; then
    task_json=$(echo "$task_json" | jq --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '. + {createdAt: $ts}')
  fi

  # Append to queue
  echo "$task_json" >> "$QUEUE_FILE"

  # Update state
  local queue_length
  queue_length=$(wc -l < "$QUEUE_FILE")
  jq --arg len "$queue_length" '.queueLength = ($len | tonumber)' "$STATE_FILE" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"

  echo "✅ Task enqueued: $taskId (priority: $priority, source: $source, intent: $intent)"
  echo "📊 Queue length: $queue_length"

  return 0
}

# Function: Show queue status
status() {
  if [[ ! -f "$QUEUE_FILE" ]]; then
    echo "Queue is empty (file not found)"
    return 0
  fi

  local queue_length
  queue_length=$(wc -l < "$QUEUE_FILE")

  if [[ "$queue_length" -eq 0 ]]; then
    echo "Queue is empty"
    return 0
  fi

  echo "📊 Queue Status"
  echo "Total tasks: $queue_length"
  echo ""
  echo "Tasks by priority:"

  local p0_count p1_count p2_count
  p0_count=$(grep -c '"priority":"P0"' "$QUEUE_FILE" || true)
  p1_count=$(grep -c '"priority":"P1"' "$QUEUE_FILE" || true)
  p2_count=$(grep -c '"priority":"P2"' "$QUEUE_FILE" || true)

  echo "  P0 (critical): $p0_count"
  echo "  P1 (high):     $p1_count"
  echo "  P2 (normal):   $p2_count"

  return 0
}

# Function: CLI interface
cli_enqueue() {
  local source="$1"
  local intent="$2"
  local priority="${3:-P2}"
  local payload_str="${4:-\{\}}"

  # Generate UUID for taskId
  local taskId
  taskId=$(uuidgen | tr '[:upper:]' '[:lower:]')

  # Validate and parse payload JSON
  # Note: echo "$payload_str" may fail with single-quoted shell strings like '{}'
  # Try to parse it first, if fails, use default empty object
  local payload_json
  if payload_json=$(echo "$payload_str" | jq . 2>/dev/null); then
    # Valid JSON
    :
  else
    # Invalid JSON, use empty object
    payload_json="{}"
  fi

  # Build task JSON
  local task_json
  task_json=$(jq -n \
    --arg id "$taskId" \
    --arg src "$source" \
    --arg int "$intent" \
    --arg pri "$priority" \
    --argjson pay "$payload_json" \
    '{taskId: $id, source: $src, intent: $int, priority: $pri, payload: $pay}')

  enqueue "$task_json"
}

# Main command router
main() {
  local command="${1:-help}"

  case "$command" in
    enqueue)
      # HTTP mode: read JSON from stdin or arg
      if [[ -n "${2:-}" ]]; then
        enqueue "$2"
      else
        local json_input
        json_input=$(cat)
        enqueue "$json_input"
      fi
      ;;

    add)
      # CLI mode: simplified interface
      # Usage: gateway.sh add <source> <intent> [priority] [payload_json]
      if [[ $# -lt 3 ]]; then
        echo "Usage: gateway.sh add <source> <intent> [priority] [payload_json]" >&2
        exit 1
      fi
      cli_enqueue "${2}" "${3}" "${4:-P2}" "${5:-{}}"
      ;;

    status)
      status
      ;;

    help|--help|-h)
      cat <<EOF
Cecelia Gateway - Unified Input Gateway

Usage:
  gateway.sh enqueue [JSON]     # Enqueue task from JSON (stdin or arg)
  gateway.sh add <source> <intent> [priority] [payload]  # CLI mode
  gateway.sh status              # Show queue status
  gateway.sh help                # Show this help

Examples:
  # Enqueue from JSON string
  gateway.sh enqueue '{"taskId":"uuid","source":"cloudcode","intent":"runQA","priority":"P0","payload":{}}'

  # Enqueue from stdin
  echo '{"taskId":"uuid",...}' | gateway.sh enqueue

  # CLI mode (simplified)
  gateway.sh add cloudcode runQA P0 '{"project":"cecelia-quality"}'

  # Check queue
  gateway.sh status

Task Schema:
  - taskId: UUID
  - source: cloudcode|notion|chat|n8n|webhook|heartbeat
  - intent: runQA|fixBug|refactor|review|summarize|optimizeSelf
  - priority: P0|P1|P2
  - payload: object (task-specific data)
  - createdAt: ISO 8601 timestamp (auto-added)

See: gateway/task-schema.json for full schema
EOF
      ;;

    *)
      echo "ERROR: Unknown command: $command" >&2
      echo "Run 'gateway.sh help' for usage" >&2
      exit 1
      ;;
  esac
}

main "$@"
