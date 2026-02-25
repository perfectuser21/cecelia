#!/bin/bash
# ============================================
# DLQ (Dead Letter Queue) Utilities
# ============================================
# Handles failed memory/evidence writes
# Storage: apps/core/dlq/*.jsonl

DLQ_DIR="${DLQ_DIR:-/home/xx/dev/cecelia-workspace/apps/core/dlq}"
MEMORY_DLQ="${DLQ_DIR}/memory_dlq.jsonl"
EVIDENCE_DLQ="${DLQ_DIR}/evidence_dlq.jsonl"

# Ensure DLQ directory exists
mkdir -p "$DLQ_DIR"

# ============================================
# Write to DLQ
# ============================================
dlq_write() {
  local type="$1"  # memory or evidence
  local payload="$2"
  local trace_id="$3"
  local error_msg="$4"

  local dlq_file
  case "$type" in
    memory) dlq_file="$MEMORY_DLQ" ;;
    evidence) dlq_file="$EVIDENCE_DLQ" ;;
    *) echo "Unknown DLQ type: $type" >&2; return 1 ;;
  esac

  local entry=$(jq -c -n \
    --arg type "$type" \
    --arg trace_id "$trace_id" \
    --arg error "$error_msg" \
    --arg timestamp "$(date -Iseconds)" \
    --argjson payload "$payload" \
    '{type: $type, trace_id: $trace_id, error: $error, timestamp: $timestamp, payload: $payload, replayed: false}')

  echo "$entry" >> "$dlq_file"
  echo "DLQ: Written to $type queue (trace: $trace_id)"
}

# ============================================
# Read DLQ status
# ============================================
dlq_status() {
  local memory_count=0
  local evidence_count=0
  local memory_pending=0
  local evidence_pending=0

  if [[ -f "$MEMORY_DLQ" ]]; then
    memory_count=$(wc -l < "$MEMORY_DLQ")
    memory_pending=$(grep -c '"replayed":false' "$MEMORY_DLQ" 2>/dev/null || echo 0)
  fi

  if [[ -f "$EVIDENCE_DLQ" ]]; then
    evidence_count=$(wc -l < "$EVIDENCE_DLQ")
    evidence_pending=$(grep -c '"replayed":false' "$EVIDENCE_DLQ" 2>/dev/null || echo 0)
  fi

  jq -n \
    --argjson memory_total "$memory_count" \
    --argjson memory_pending "$memory_pending" \
    --argjson evidence_total "$evidence_count" \
    --argjson evidence_pending "$evidence_pending" \
    '{
      memory: {total: $memory_total, pending: $memory_pending},
      evidence: {total: $evidence_total, pending: $evidence_pending},
      total_pending: ($memory_pending + $evidence_pending)
    }'
}

# ============================================
# List DLQ entries
# ============================================
dlq_list() {
  local type="$1"  # memory, evidence, or all
  local limit="${2:-10}"

  case "$type" in
    memory)
      if [[ -f "$MEMORY_DLQ" ]]; then
        tail -n "$limit" "$MEMORY_DLQ" | jq -s '.'
      else
        echo "[]"
      fi
      ;;
    evidence)
      if [[ -f "$EVIDENCE_DLQ" ]]; then
        tail -n "$limit" "$EVIDENCE_DLQ" | jq -s '.'
      else
        echo "[]"
      fi
      ;;
    all|*)
      local memory_entries="[]"
      local evidence_entries="[]"
      if [[ -f "$MEMORY_DLQ" ]]; then
        memory_entries=$(tail -n "$limit" "$MEMORY_DLQ" | jq -s '.')
      fi
      if [[ -f "$EVIDENCE_DLQ" ]]; then
        evidence_entries=$(tail -n "$limit" "$EVIDENCE_DLQ" | jq -s '.')
      fi
      jq -n --argjson memory "$memory_entries" --argjson evidence "$evidence_entries" \
        '{memory: $memory, evidence: $evidence}'
      ;;
  esac
}

# ============================================
# Replay DLQ entries
# ============================================
dlq_replay() {
  local type="$1"  # memory or evidence
  local brain_url="${BRAIN_URL:-http://localhost:5220}"
  local workspace_url="${WORKSPACE_URL:-http://localhost:5211}"

  local dlq_file
  local replayed=0
  local failed=0

  case "$type" in
    memory) dlq_file="$MEMORY_DLQ" ;;
    evidence) dlq_file="$EVIDENCE_DLQ" ;;
    *) echo "Unknown DLQ type: $type" >&2; return 1 ;;
  esac

  if [[ ! -f "$dlq_file" ]]; then
    echo '{"replayed": 0, "failed": 0, "message": "No DLQ file found"}'
    return 0
  fi

  # Process each pending entry
  local temp_file=$(mktemp)

  while IFS= read -r line; do
    local is_replayed=$(echo "$line" | jq -r '.replayed')

    if [[ "$is_replayed" == "false" ]]; then
      local payload=$(echo "$line" | jq -c '.payload')
      local trace_id=$(echo "$line" | jq -r '.trace_id')

      local success=false

      if [[ "$type" == "memory" ]]; then
        # Replay memory write
        local response=$(curl -s --max-time 10 -X POST \
          -H "Content-Type: application/json" \
          -d "$payload" \
          "${brain_url}/api/brain/action/set-memory" 2>/dev/null)

        if [[ "$response" == *"success"* ]] || [[ "$response" == *"true"* ]]; then
          success=true
        fi
      elif [[ "$type" == "evidence" ]]; then
        # Replay evidence write
        local task_id=$(echo "$payload" | jq -r '.task_id')
        local response=$(curl -s --max-time 10 -X POST \
          -H "Content-Type: application/json" \
          -d "$payload" \
          "${workspace_url}/api/tasks/tasks/${task_id}/evidence" 2>/dev/null)

        if [[ "$response" != *"error"* ]]; then
          success=true
        fi
      fi

      if [[ "$success" == "true" ]]; then
        # Mark as replayed
        echo "$line" | jq -c '.replayed = true | .replayed_at = now | .replayed_at = (now | todate)' >> "$temp_file"
        replayed=$((replayed + 1))
      else
        echo "$line" >> "$temp_file"
        failed=$((failed + 1))
      fi
    else
      echo "$line" >> "$temp_file"
    fi
  done < "$dlq_file"

  mv "$temp_file" "$dlq_file"

  jq -n \
    --argjson replayed "$replayed" \
    --argjson failed "$failed" \
    '{replayed: $replayed, failed: $failed, message: "Replay completed"}'
}

# ============================================
# Clear replayed entries
# ============================================
dlq_clear_replayed() {
  local type="$1"

  local dlq_file
  case "$type" in
    memory) dlq_file="$MEMORY_DLQ" ;;
    evidence) dlq_file="$EVIDENCE_DLQ" ;;
    all)
      dlq_clear_replayed memory
      dlq_clear_replayed evidence
      return
      ;;
    *) echo "Unknown DLQ type: $type" >&2; return 1 ;;
  esac

  if [[ -f "$dlq_file" ]]; then
    local temp_file=$(mktemp)
    grep '"replayed":false' "$dlq_file" > "$temp_file" 2>/dev/null || true
    mv "$temp_file" "$dlq_file"
    echo "Cleared replayed entries from $type DLQ"
  fi
}

# CLI interface
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  case "$1" in
    write)
      dlq_write "$2" "$3" "$4" "$5"
      ;;
    status)
      dlq_status
      ;;
    list)
      dlq_list "$2" "$3"
      ;;
    replay)
      dlq_replay "$2"
      ;;
    clear)
      dlq_clear_replayed "$2"
      ;;
    *)
      echo "Usage: dlq-utils.sh {write|status|list|replay|clear} [args...]"
      echo ""
      echo "Commands:"
      echo "  write <type> <payload> <trace_id> <error>  Write to DLQ"
      echo "  status                                      Show DLQ status"
      echo "  list [type] [limit]                         List DLQ entries"
      echo "  replay <type>                               Replay pending entries"
      echo "  clear <type>                                Clear replayed entries"
      ;;
  esac
fi
