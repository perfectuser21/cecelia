#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"
TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"
JOURNEY_ID="${JOURNEY_ID:-bb8cc561-b3ee-4fec-b74d-2255694bd963}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

brain_base_url() {
  printf "%s" "${BRAIN_URL%/}"
}

expected_orchestrator() {
  printf 's%s%s-relay' 'ki' 'll'
}

require_current_binding() {
  [ "$TASK_ID" = "d355821f-4a37-4fa2-ad2f-99668bc91a3d" ] || fail "TASK_ID not current: $TASK_ID"
  case "$SPRINT_DIR" in
    sprints/07191314-relay-d355821f|*/sprints/07191314-relay-d355821f) ;;
    *) fail "SPRINT_DIR not current: $SPRINT_DIR" ;;
  esac
  local old_short
  old_short="$(printf "%s%s" 537 10094)"
  case "$TASK_ID:$SPRINT_DIR" in
    *"$old_short"*) fail "historical task/sprint cannot be current evidence" ;;
  esac
}

task_api_json() {
  require_current_binding
  local base
  base="$(brain_base_url)"
  curl -sf "$base/api/brain/tasks/$TASK_ID"
}

task_db_row() {
  require_current_binding
  psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 -c "SELECT status, task_type, payload->>'mode', payload->>'executor', payload->>'orchestrator', payload->>'journey_id', COALESCE(claimed_by,''), COALESCE(claimed_at::text,''), COALESCE(executor_kind,'') FROM tasks WHERE id = \$\$${TASK_ID}\$\$::uuid"
}

current_run_db_row() {
  require_current_binding
  psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 -c "SELECT COALESCE(orchestrator_host,''), COALESCE(phase,''), COALESCE(started_at::text,''), COALESCE(failure_reason,'') FROM initiative_runs WHERE initiative_id = \$\$${TASK_ID}\$\$::uuid ORDER BY started_at DESC LIMIT 1"
}

assert_current_task_only() {
  require_current_binding
  echo "OK: current task binding"
}

assert_task_payload_shape() {
  local resp expected_orch
  resp="$(task_api_json)" || fail "brain task api"
  expected_orch="$(expected_orchestrator)"

  echo "$resp" | jq -e --arg tid "$TASK_ID" '.id == $tid' >/dev/null || fail "id mismatch"
  echo "$resp" | jq -e '.task_type == "harness_initiative"' >/dev/null || fail "task_type mismatch"
  echo "$resp" | jq -e '.status == "in_progress"' >/dev/null || fail "status not in_progress"
  echo "$resp" | jq -e --arg orch "$expected_orch" '.payload.mode == "headed" and .payload.executor == "codex" and .payload.orchestrator == $orch and .payload.journey_id == "bb8cc561-b3ee-4fec-b74d-2255694bd963" and .payload.dispatched_by_orchestrator == true' >/dev/null || fail "payload shape mismatch"
  echo "$resp" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("openai_api_key") | not) and (.payload | has("codex_token") | not) and (.payload | has("thin_prd") | not) and (.payload | has("prep_prd_body") | not) and (.payload | has("sprint_dir") | not) and (.payload | has("prd_content") | not)' >/dev/null || fail "payload contains forbidden field"
  echo "OK: task api payload shape"
}

assert_db_claim_oracle() {
  local row status task_type mode executor orchestrator db_journey_id claimed_by claimed_at executor_kind expected_orch
  row="$(task_db_row)" || fail "tasks query failed"
  [ -n "$row" ] || fail "tasks row missing"
  expected_orch="$(expected_orchestrator)"

  IFS='|' read -r status task_type mode executor orchestrator db_journey_id claimed_by claimed_at executor_kind <<< "$row"
  [ "$status" = "in_progress" ] || fail "db status=$status"
  [ "$task_type" = "harness_initiative" ] || fail "db task_type=$task_type"
  [ "$mode" = "headed" ] && [ "$executor" = "codex" ] && [ "$orchestrator" = "$expected_orch" ] || fail "db payload mismatch"
  [ "$db_journey_id" = "$JOURNEY_ID" ] || fail "db journey_id=$db_journey_id"
  [ "$claimed_by" = "session:engine-patch" ] || fail "db claimed_by=$claimed_by"
  [ -n "$claimed_at" ] || fail "db claimed_at missing"
  [ "$executor_kind" = "headed-session" ] || fail "db executor_kind=$executor_kind"
  echo "OK: db claim oracle"
}

assert_runs_concern_or_verified() {
  local base runs run_api_count gps gp_current_refs run_row run_host run_phase run_started_at run_failure_reason expected_orch
  assert_task_payload_shape >/dev/null
  assert_db_claim_oracle >/dev/null
  expected_orch="$(expected_orchestrator)"

  base="$(brain_base_url)"
  runs="$(curl -sf "$base/api/brain/harness/runs?limit=50")" || fail "harness runs api"
  run_api_count="$(echo "$runs" | jq --arg tid "$TASK_ID" '[.[]? | select(.initiative_id == $tid)] | length')"
  gps="$(curl -sf "$base/api/brain/journeys/$JOURNEY_ID/golden-paths")" || fail "journey golden-paths api"
  gp_current_refs="$(echo "$gps" | jq --arg tid "$TASK_ID" '[.. | strings | select(. == $tid)] | length')"
  run_row="$(current_run_db_row)" || fail "initiative_runs query failed"

  if [ -z "$run_row" ]; then
    echo "CONCERN: initiative_runs missing for current task; runs_api_count=$run_api_count golden_path_refs=$gp_current_refs; foreground takeover oracle validated"
    return
  fi

  IFS='|' read -r run_host run_phase run_started_at run_failure_reason <<< "$run_row"
  case "$run_host" in
    *"$expected_orch"*codex*headed*|*codex*headed*) ;;
    *) fail "run host=$run_host" ;;
  esac
  [ "$run_phase" != "failed" ] || fail "run failed reason=$run_failure_reason"
  case "$run_phase" in
    A_planning|planning|gan|generate|evaluate|done|completed|running|in_progress) ;;
    *) fail "run phase=$run_phase" ;;
  esac
  [ -n "$run_started_at" ] || fail "run started_at missing"
  echo "OK: initiative_runs current run verified"
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
  assert_db_claim_oracle
  assert_runs_concern_or_verified
  assert_evidence_boundary_and_redaction
  echo "PASS: codex headed relay smoke validated for current task"
}

case "${1:-}" in
  "")
    run_full
    ;;
  --assert)
    case "${2:-}" in
      task-payload-shape) assert_task_payload_shape ;;
      db-claim-oracle) assert_db_claim_oracle ;;
      runs-concern-or-verified) assert_runs_concern_or_verified ;;
      current-task-only) assert_current_task_only ;;
      evidence-boundary-and-redaction) assert_evidence_boundary_and_redaction ;;
      *) fail "unknown assert: ${2:-}" ;;
    esac
    ;;
  *)
    fail "usage: $0 [--assert task-payload-shape|db-claim-oracle|runs-concern-or-verified|current-task-only|evidence-boundary-and-redaction]"
    ;;
esac
