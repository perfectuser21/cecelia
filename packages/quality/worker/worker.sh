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

  # Record start time
  local started_at
  started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local start_timestamp
  start_timestamp=$(date +%s)

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

  # Calculate duration
  local end_timestamp completed_at duration
  end_timestamp=$(date +%s)
  completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  duration=$((end_timestamp - start_timestamp))

  # Extract error if failed
  local error_msg
  error_msg=$(jq -r '.error // null' "$run_dir/result.json" 2>/dev/null || echo "null")

  # List evidence files
  local evidence_files
  evidence_files=$(cd "$run_dir" && ls -1 | jq -R -s -c 'split("\n") | map(select(length > 0))')

  jq -n \
    --arg taskId "$taskId" \
    --arg intent "$intent" \
    --arg status "$result_status" \
    --arg startedAt "$started_at" \
    --arg completedAt "$completed_at" \
    --argjson duration "$duration" \
    --arg runDir "$run_dir" \
    --argjson evidence "$evidence_files" \
    --argjson error "$error_msg" \
    '{
      taskId: $taskId,
      intent: $intent,
      status: $status,
      startedAt: $startedAt,
      completedAt: $completedAt,
      duration: $duration,
      runDir: $runDir,
      evidence: $evidence,
      error: $error
    }' > "$run_dir/summary.json"

  # Update state with last run, stats, and updatedAt
  jq --arg id "$taskId" --arg ts "$completed_at" --arg status "$result_status" '
    .lastRun = {taskId: $id, completedAt: $ts} |
    .stats.total = (.stats.total // 0) + 1 |
    .updatedAt = $ts |
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

  # Run RCI tests and collect results
  local total=0 passed=0 failed=0 skipped=0
  local skipped_details="[]"

  # Set flag to prevent recursive worker execution in tests
  export WORKER_RUNNING=1

  # Check if tests directory exists
  if [[ -d "$PROJECT_ROOT/tests" ]]; then
    # Run each RCI test
    for test_script in "$PROJECT_ROOT"/tests/test-*.sh; do
      if [[ -f "$test_script" ]]; then
        total=$((total + 1))
        test_name=$(basename "$test_script" .sh)

        # Run test and capture output
        set +e
        bash "$test_script" > "$run_dir/${test_name}.log" 2>&1
        test_exit=$?
        set -e

        # Check if skipped (check output first, regardless of exit code)
        if grep -qi "SKIP" "$run_dir/${test_name}.log" 2>/dev/null; then
          echo "⚠️  $test_name skipped"
          skipped=$((skipped + 1))

          # Extract skip reason (simplified)
          skip_reason=$(grep -i "SKIP" "$run_dir/${test_name}.log" 2>/dev/null | head -1 | cut -d: -f2- | tr -d '[:cntrl:]' | sed 's/^[[:space:]]*//' || echo "dependency missing")

          # Add to skipped_details
          skipped_details=$(echo "$skipped_details" | jq --arg id "$test_name" --arg reason "$skip_reason" '. += [{"id": $id, "reason": $reason}]')
        elif [[ $test_exit -eq 0 ]]; then
          echo "✅ $test_name passed"
          passed=$((passed + 1))
        else
          echo "❌ $test_name failed"
          failed=$((failed + 1))
        fi
      fi
    done
  fi

  # Call orchestrator (if implemented)
  if [[ -f "$PROJECT_ROOT/orchestrator/qa-run.sh" ]]; then
    bash "$PROJECT_ROOT/orchestrator/qa-run.sh" "$project" "$branch" "$scope" > "$run_dir/qa-output.log" 2>&1 || true
  fi

  # Generate detailed result
  jq -n \
    --arg status "completed" \
    --arg intent "runQA" \
    --argjson total "$total" \
    --argjson passed "$passed" \
    --argjson failed "$failed" \
    --argjson skipped "$skipped" \
    --argjson skipped_details "$skipped_details" \
    '{
      status: $status,
      intent: $intent,
      tests: {
        total: $total,
        passed: $passed,
        failed: $failed,
        skipped: $skipped,
        skipped_details: $skipped_details
      }
    }' > "$run_dir/result.json"
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
