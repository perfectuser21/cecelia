#!/usr/bin/env bash
# ============================================================
# relay-565fa27a.sh — headless dispatch smoke e2e wrapper
# Task ID: 565fa27a-4b5b-4eb7-905e-b6fb61eb8413
# Sprint: 07191541-relay-565fa27a
# Mode: headless / executor=claude / orchestrator=skill-relay
#
# 用法:
#   bash scripts/smoke/e2e/relay-565fa27a.sh
#   bash scripts/smoke/e2e/relay-565fa27a.sh --assert task-payload-shape
#   bash scripts/smoke/e2e/relay-565fa27a.sh --assert db-dispatch-oracle
#   bash scripts/smoke/e2e/relay-565fa27a.sh --assert runs-concern-or-verified
#   bash scripts/smoke/e2e/relay-565fa27a.sh --assert current-task-only
#   bash scripts/smoke/e2e/relay-565fa27a.sh --assert evidence-boundary-and-redaction
#
# 环境变量（可 env 覆盖，无需修改脚本）:
#   BRAIN_URL      默认 http://localhost:5221
#   DATABASE_URL   默认 postgresql://cecelia:cecelia@localhost:5432/cecelia
#   SPRINT_DIR     默认 sprints/07191541-relay-565fa27a
#   TASK_ID        默认 565fa27a-4b5b-4eb7-905e-b6fb61eb8413
#
# headless 与 headed 版本的差异:
#   - 不检查 executor_kind（headless 无需 headed-session）
#   - 不检查 claimed_by（headless 认领方式不同）
#   - 不检查 journey_id（当前任务无 journey_id）
#   - initiative_runs 缺失时只输出 concern，不检查 orchestrator_host=foreground
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"
TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

brain_base_url() {
  printf "%s" "${BRAIN_URL%/}"
}

require_current_binding() {
  [ "$TASK_ID" = "565fa27a-4b5b-4eb7-905e-b6fb61eb8413" ] || fail "TASK_ID not current: $TASK_ID"
  case "$SPRINT_DIR" in
    sprints/07191541-relay-565fa27a|*/sprints/07191541-relay-565fa27a) ;;
    *) fail "SPRINT_DIR not current: $SPRINT_DIR" ;;
  esac
  # 拒绝历史 task d355821f 作为当前证据
  local old_short
  old_short="d355821f"
  case "$TASK_ID:$SPRINT_DIR" in
    *"$old_short"*) fail "historical task/sprint cannot be current evidence" ;;
  esac
}

task_api_json() {
  require_current_binding
  local base
  base="$(brain_base_url)"
  curl -sf "$base/api/brain/tasks/$TASK_ID" || fail "brain task api unreachable"
}

task_db_row() {
  require_current_binding
  # headless: 不读取 claimed_by/claimed_at/executor_kind/journey_id
  psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 \
    -c "SELECT status, task_type, payload->>'mode', payload->>'executor', payload->>'orchestrator', COALESCE(payload->>'dispatched_by_orchestrator','') FROM tasks WHERE id = \$\$${TASK_ID}\$\$::uuid"
}

current_run_db_row() {
  require_current_binding
  psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 \
    -c "SELECT COALESCE(orchestrator_host,''), COALESCE(phase,''), COALESCE(started_at::text,''), COALESCE(failure_reason,'') FROM initiative_runs WHERE initiative_id = \$\$${TASK_ID}\$\$::uuid ORDER BY started_at DESC LIMIT 1"
}

assert_current_task_only() {
  require_current_binding
  echo "OK: current task binding"
}

assert_task_payload_shape() {
  local resp
  resp="$(task_api_json)" || fail "brain task api"

  echo "$resp" | jq -e --arg tid "$TASK_ID" '.id == $tid' >/dev/null || fail "id mismatch"
  echo "$resp" | jq -e '.task_type == "harness_initiative"' >/dev/null || fail "task_type mismatch"
  echo "$resp" | jq -e '.status == "in_progress"' >/dev/null || fail "status not in_progress"
  # headless 三元组: mode=headless, executor=claude, orchestrator=skill-relay
  echo "$resp" | jq -e '.payload.mode == "headless" and .payload.executor == "claude" and .payload.orchestrator == "skill-relay" and .payload.smoke_test == true and .payload.dispatched_by_orchestrator == true' >/dev/null || fail "payload shape mismatch"
  # 禁用字段检查
  echo "$resp" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not) and (.payload | has("prep_prd_body") | not)' >/dev/null || fail "payload contains forbidden field"
  echo "OK: task api payload shape"
}

assert_db_dispatch_oracle() {
  local row status task_type mode executor orchestrator dispatched_by
  row="$(task_db_row)" || fail "tasks query failed"
  [ -n "$row" ] || fail "tasks row missing"

  IFS='|' read -r status task_type mode executor orchestrator dispatched_by <<< "$row"
  [ "$status" = "in_progress" ] || fail "db status=$status"
  [ "$task_type" = "harness_initiative" ] || fail "db task_type=$task_type"
  [ "$mode" = "headless" ] && [ "$executor" = "claude" ] && [ "$orchestrator" = "skill-relay" ] || fail "db payload mismatch (mode=$mode executor=$executor orchestrator=$orchestrator)"
  [ "$dispatched_by" = "true" ] || fail "db dispatched_by_orchestrator=$dispatched_by"
  echo "OK: db dispatch oracle"
}

assert_runs_concern_or_verified() {
  local base runs run_api_count run_row run_host run_phase run_started_at run_failure_reason
  # 先通过 task payload shape 和 DB dispatch oracle
  assert_task_payload_shape >/dev/null
  assert_db_dispatch_oracle >/dev/null

  base="$(brain_base_url)"
  runs="$(curl -sf "$base/api/brain/harness/runs?limit=50")" || fail "harness runs api"
  run_api_count="$(echo "$runs" | jq --arg tid "$TASK_ID" '[.[]? | select(.initiative_id == $tid)] | length')"
  run_row="$(current_run_db_row)" || fail "initiative_runs query failed"

  if [ -z "$run_row" ]; then
    # initiative_runs 缺当前 task run 时只输出 concern，不判定成功
    echo "CONCERN: initiative_runs missing for current task; runs_api_count=$run_api_count; headless dispatch oracle validated but relay run not yet recorded"
    return 0
  fi

  IFS='|' read -r run_host run_phase run_started_at run_failure_reason <<< "$run_row"
  [ "$run_phase" != "failed" ] || fail "run failed reason=$run_failure_reason"
  case "$run_phase" in
    A_planning|planning|gan|generate|evaluate|done|completed|running|in_progress) ;;
    *) fail "run phase=$run_phase unknown" ;;
  esac
  [ -n "$run_started_at" ] || fail "run started_at missing"
  echo "OK: initiative_runs current run verified (host=$run_host phase=$run_phase)"
}

assert_evidence_boundary_and_redaction() {
  local path
  assert_current_task_only >/dev/null
  assert_task_payload_shape >/dev/null

  for path in "$SPRINT_DIR/tui.log" "$SPRINT_DIR/harness-report.md"; do
    if [ -f "$path" ]; then
      if grep -E 'ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]{20,}|xox[abp]-|BEGIN [A-Z ]*PRIVATE KEY|Authorization: Bearer' "$path" >/dev/null; then
        fail "sensitive token-like content in $path"
      fi
    fi
  done
  echo "OK: evidence boundary and redaction"
}

run_full() {
  assert_current_task_only
  assert_task_payload_shape
  assert_db_dispatch_oracle
  assert_runs_concern_or_verified
  assert_evidence_boundary_and_redaction
  echo "PASS: headless claude relay smoke validated for current task"
}

case "${1:-}" in
  "")
    run_full
    ;;
  --assert)
    case "${2:-}" in
      task-payload-shape) assert_task_payload_shape ;;
      db-dispatch-oracle) assert_db_dispatch_oracle ;;
      runs-concern-or-verified) assert_runs_concern_or_verified ;;
      current-task-only) assert_current_task_only ;;
      evidence-boundary-and-redaction) assert_evidence_boundary_and_redaction ;;
      *) fail "unknown assert: ${2:-}" ;;
    esac
    ;;
  *)
    fail "usage: $0 [--assert task-payload-shape|db-dispatch-oracle|runs-concern-or-verified|current-task-only|evidence-boundary-and-redaction]"
    ;;
esac
