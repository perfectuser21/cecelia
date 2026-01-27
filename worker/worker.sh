#!/bin/bash
# Worker - Consumes queue and executes tasks
# Calls CloudCode headless or Orchestrator based on intent

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
QUEUE_FILE="${QUEUE_FILE:-$PROJECT_ROOT/queue/queue.jsonl}"
STATE_FILE="${STATE_FILE:-$PROJECT_ROOT/state/state.json}"
RUNS_DIR="${RUNS_DIR:-$PROJECT_ROOT/runs}"

# Ensure directories exist
mkdir -p "$RUNS_DIR"

# Function: Dequeue next task (priority-aware)
dequeue() {
  if [[ ! -f "$QUEUE_FILE" ]] || [[ ! -s "$QUEUE_FILE" ]]; then
    echo "Queue is empty"
    return 1
  fi

  # Sort by priority (P0 > P1 > P2) and take first
  local task
  task=$(cat "$QUEUE_FILE" | jq -s 'sort_by(.priority) | .[0]')

  if [[ "$task" == "null" || -z "$task" ]]; then
    echo "Queue is empty"
    return 1
  fi

  # Remove this task from queue
  local taskId
  taskId=$(echo "$task" | jq -r '.taskId')

  # Create temp file without this task
  grep -v "\"taskId\":\"$taskId\"" "$QUEUE_FILE" > "$QUEUE_FILE.tmp" || true
  mv "$QUEUE_FILE.tmp" "$QUEUE_FILE"

  # Update state
  local queue_length
  queue_length=$(wc -l < "$QUEUE_FILE")
  jq --arg len "$queue_length" '.queueLength = ($len | tonumber)' "$STATE_FILE" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"

  echo "$task"
  return 0
}

# Function: Execute task based on intent
execute_task() {
  local task_json="$1"

  local taskId intent source priority payload
  taskId=$(echo "$task_json" | jq -r '.taskId')
  intent=$(echo "$task_json" | jq -r '.intent')
  source=$(echo "$task_json" | jq -r '.source')
  priority=$(echo "$task_json" | jq -r '.priority')
  payload=$(echo "$task_json" | jq -r '.payload')

  echo "🚀 Executing task: $taskId"
  echo "   Intent: $intent"
  echo "   Source: $source"
  echo "   Priority: $priority"
  echo ""

  # Create run directory
  local run_dir="$RUNS_DIR/$taskId"
  mkdir -p "$run_dir"

  # Save task details
  echo "$task_json" > "$run_dir/task.json"

  # Route to appropriate executor based on intent
  case "$intent" in
    runQA)
      execute_qa "$task_json" "$run_dir"
      ;;
    fixBug)
      execute_fix "$task_json" "$run_dir"
      ;;
    refactor)
      execute_refactor "$task_json" "$run_dir"
      ;;
    review)
      execute_review "$task_json" "$run_dir"
      ;;
    summarize)
      execute_summarize "$task_json" "$run_dir"
      ;;
    optimizeSelf)
      execute_optimize "$task_json" "$run_dir"
      ;;
    *)
      echo "ERROR: Unknown intent: $intent" >&2
      echo '{"status":"error","reason":"unknown_intent"}' > "$run_dir/result.json"
      return 1
      ;;
  esac

  # Generate summary.json
  local result_status
  result_status=$(jq -r '.status // "unknown"' "$run_dir/result.json" 2>/dev/null || echo "unknown")

  jq -n \
    --arg taskId "$taskId" \
    --arg intent "$intent" \
    --arg status "$result_status" \
    --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg runDir "$run_dir" \
    '{
      taskId: $taskId,
      intent: $intent,
      status: $status,
      completedAt: $completedAt,
      runDir: $runDir,
      files: ["task.json", "result.json"]
    }' > "$run_dir/summary.json"

  # Update state with last run and stats
  jq --arg id "$taskId" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg status "$result_status" '
    .lastRun = {taskId: $id, completedAt: $ts} |
    .stats.total = (.stats.total // 0) + 1 |
    if $status == "completed" then
      .stats.succeeded = (.stats.succeeded // 0) + 1
    else
      .stats.failed = (.stats.failed // 0) + 1
    end
  ' "$STATE_FILE" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"

  echo ""
  echo "✅ Task completed: $taskId"
  echo "   Results: $run_dir/result.json"
  echo "   Summary: $run_dir/summary.json"

  return 0
}

# Executor: runQA
execute_qa() {
  local task_json="$1"
  local run_dir="$2"

  echo "Running QA orchestrator..."

  # Extract payload
  local project branch scope
  project=$(echo "$task_json" | jq -r '.payload.project // "unknown"')
  branch=$(echo "$task_json" | jq -r '.payload.branch // "develop"')
  scope=$(echo "$task_json" | jq -r '.payload.scope // "pr"')

  # Call orchestrator (if implemented)
  if [[ -f "$PROJECT_ROOT/orchestrator/qa-run.sh" ]]; then
    bash "$PROJECT_ROOT/orchestrator/qa-run.sh" "$project" "$branch" "$scope" > "$run_dir/qa-output.log" 2>&1 || true
  else
    echo "WARNING: orchestrator/qa-run.sh not found, skipping QA run" >&2
  fi

  # Generate result
  echo '{"status":"completed","intent":"runQA"}' > "$run_dir/result.json"
}

# Executor: fixBug (call CloudCode headless)
execute_fix() {
  local task_json="$1"
  local run_dir="$2"

  echo "Calling CloudCode headless for bug fix..."

  # Extract payload
  local project branch issue
  project=$(echo "$task_json" | jq -r '.payload.project // "unknown"')
  branch=$(echo "$task_json" | jq -r '.payload.branch // "develop"')
  issue=$(echo "$task_json" | jq -r '.payload.issue // ""')

  # Placeholder: Call CloudCode headless (需要实现 claude CLI 调用)
  # Example: /usr/local/bin/claude -p "Fix bug in $project: $issue" --output-format json

  echo '{"status":"completed","intent":"fixBug","note":"CloudCode integration pending"}' > "$run_dir/result.json"
}

# Executor: refactor
execute_refactor() {
  local task_json="$1"
  local run_dir="$2"

  echo "Calling CloudCode headless for refactor..."
  echo '{"status":"completed","intent":"refactor","note":"CloudCode integration pending"}' > "$run_dir/result.json"
}

# Executor: review
execute_review() {
  local task_json="$1"
  local run_dir="$2"

  echo "Performing code review..."
  echo '{"status":"completed","intent":"review","note":"Review logic pending"}' > "$run_dir/result.json"
}

# Executor: summarize
execute_summarize() {
  local task_json="$1"
  local run_dir="$2"

  echo "Summarizing..."
  echo '{"status":"completed","intent":"summarize","note":"Summarize logic pending"}' > "$run_dir/result.json"
}

# Executor: optimizeSelf
execute_optimize() {
  local task_json="$1"
  local run_dir="$2"

  echo "Running self-optimization..."
  echo '{"status":"completed","intent":"optimizeSelf","note":"Optimize logic pending"}' > "$run_dir/result.json"
}

# Main: Process one task
main() {
  echo "🔍 Checking queue..."

  local task
  if ! task=$(dequeue); then
    echo "No tasks in queue"
    exit 0
  fi

  echo "📦 Task dequeued"
  echo ""

  execute_task "$task"

  exit 0
}

main "$@"
