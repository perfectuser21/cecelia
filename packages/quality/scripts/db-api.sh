#!/bin/bash
# Database API - Simplified interface for common DB operations

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_FILE="$PROJECT_ROOT/db/cecelia.db"

# Ensure DB exists
if [[ ! -f "$DB_FILE" ]]; then
  echo "ERROR: Database not found. Run 'bash scripts/db-init.sh init' first" >&2
  exit 1
fi

# Helper: Execute SQL and return JSON
sql_json() {
  local sql="$1"
  sqlite3 -json "$DB_FILE" "$sql"
}

# Helper: Execute SQL and return single value
sql_value() {
  local sql="$1"
  sqlite3 "$DB_FILE" "$sql" | head -1
}

# Function: Create task
task_create() {
  local task_id="$1"
  local project_id="$2"
  local title="$3"
  local intent="$4"
  local priority="$5"
  local payload="$6"

  local sql="INSERT INTO tasks (id, project_id, title, intent, priority, payload, status)
             VALUES ('$task_id', '$project_id', '$title', '$intent', '$priority', '$payload', 'inbox');"

  sqlite3 "$DB_FILE" "$sql"
  echo "$task_id"
}

# Function: Update task status
task_update_status() {
  local task_id="$1"
  local status="$2"

  local sql="UPDATE tasks SET status = '$status', updated_at = datetime('now') WHERE id = '$task_id';"
  sqlite3 "$DB_FILE" "$sql"
}

# Function: Create run
run_create() {
  local run_id="$1"
  local task_id="$2"
  local intent="$3"
  local priority="$4"

  local sql="INSERT INTO runs (id, task_id, intent, priority, status)
             VALUES ('$run_id', '$task_id', '$intent', '$priority', 'queued');"

  sqlite3 "$DB_FILE" "$sql"
  echo "$run_id"
}

# Function: Update run status
run_update() {
  local run_id="$1"
  local status="$2"
  local exit_code="${3:-}"
  local error_msg="${4:-}"

  local sql="UPDATE runs SET status = '$status'"

  if [[ "$status" == "running" ]]; then
    sql="$sql, started_at = datetime('now')"
  elif [[ "$status" == "succeeded" || "$status" == "failed" ]]; then
    sql="$sql, completed_at = datetime('now')"
    sql="$sql, duration_seconds = (julianday('now') - julianday(started_at)) * 86400"

    if [[ -n "$exit_code" ]]; then
      sql="$sql, exit_code = $exit_code"
    fi

    if [[ -n "$error_msg" ]]; then
      local escaped_msg=$(echo "$error_msg" | sed "s/'/''/g")
      sql="$sql, error_message = '$escaped_msg'"
    fi
  fi

  sql="$sql WHERE id = '$run_id';"
  sqlite3 "$DB_FILE" "$sql"
}

# Function: Add evidence
evidence_add() {
  local evidence_id="$1"
  local run_id="$2"
  local task_id="$3"
  local type="$4"
  local file_path="$5"
  local description="${6:-}"

  local size=0
  if [[ -f "$file_path" ]]; then
    size=$(stat -f%z "$file_path" 2>/dev/null || stat -c%s "$file_path" 2>/dev/null || echo 0)
  fi

  local sql="INSERT INTO evidence (id, run_id, task_id, type, file_path, description, size_bytes)
             VALUES ('$evidence_id', '$run_id', '$task_id', '$type', '$file_path', '$description', $size);"

  sqlite3 "$DB_FILE" "$sql"
}

# Function: Get active tasks
tasks_active() {
  sql_json "SELECT * FROM active_tasks LIMIT 10;"
}

# Function: Get system health
system_health() {
  sql_json "SELECT * FROM system_health;"
}

# Function: Update system state
state_update() {
  local key="$1"
  local value="$2"

  local sql="INSERT OR REPLACE INTO system_state (key, value, updated_at)
             VALUES ('$key', '$value', datetime('now'));"

  sqlite3 "$DB_FILE" "$sql"
}

# Main router
case "${1:-help}" in
  task:create)
    task_create "$2" "$3" "$4" "$5" "$6" "$7"
    ;;
  task:update)
    task_update_status "$2" "$3"
    ;;
  run:create)
    run_create "$2" "$3" "$4" "$5"
    ;;
  run:update)
    run_update "$2" "$3" "${4:-}" "${5:-}"
    ;;
  evidence:add)
    evidence_add "$2" "$3" "$4" "$5" "$6" "${7:-}"
    ;;
  tasks:active)
    tasks_active
    ;;
  system:health)
    system_health
    ;;
  state:update)
    state_update "$2" "$3"
    ;;
  help|--help|-h)
    cat <<EOF
Database API - Simplified DB operations

Usage:
  $0 task:create <task_id> <project_id> <title> <intent> <priority> <payload>
  $0 task:update <task_id> <status>
  $0 run:create <run_id> <task_id> <intent> <priority>
  $0 run:update <run_id> <status> [exit_code] [error_msg]
  $0 evidence:add <evidence_id> <run_id> <task_id> <type> <file_path> [description]
  $0 tasks:active
  $0 system:health
  $0 state:update <key> <value>

Examples:
  $0 task:create uuid-123 cecelia-quality "Run QA" runQA P0 '{}'
  $0 run:create run-uuid-456 uuid-123 runQA P0
  $0 run:update run-uuid-456 running
  $0 run:update run-uuid-456 succeeded 0
  $0 evidence:add ev-uuid run-uuid task-uuid qa_report evidence/qa-report.md
  $0 tasks:active
  $0 system:health
EOF
    ;;
  *)
    echo "Unknown command: $1"
    exit 1
    ;;
esac
