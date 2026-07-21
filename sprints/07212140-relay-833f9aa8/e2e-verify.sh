#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

SPRINT_DIR="${SPRINT_DIR:-sprints/07212140-relay-833f9aa8}"
TASK_ID="${TASK_ID:-833f9aa8-7d17-4537-bff7-0ad4e16ca1be}"
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

require_current_binding() {
  [ "$TASK_ID" = "833f9aa8-7d17-4537-bff7-0ad4e16ca1be" ] || fail "TASK_ID not current: $TASK_ID"
  case "$SPRINT_DIR" in
    sprints/07212140-relay-833f9aa8|*/sprints/07212140-relay-833f9aa8) ;;
    *) fail "SPRINT_DIR not current: $SPRINT_DIR" ;;
  esac
  for old in 53710094 d355821f 57e25e92; do
    case "$TASK_ID:$SPRINT_DIR" in
      *"$old"*) fail "historical task/sprint leaked: $old" ;;
    esac
  done
}

task_api_json() {
  require_current_binding
  curl -sf "$(brain_base_url)/api/brain/tasks/$TASK_ID"
}

task_db_row() {
  require_current_binding
  psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 -c "SELECT status, task_type, payload->>'mode', payload->>'executor', payload->>'orchestrator', payload->>'journey_id', payload->>'sprint_dir', COALESCE(claimed_by,''), COALESCE(claimed_at::text,''), COALESCE(executor_kind,'') FROM tasks WHERE id = \$\$${TASK_ID}\$\$::uuid"
}

run_db_row() {
  require_current_binding
  psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 -c "SELECT COALESCE(orchestrator_host,''), COALESCE(phase,''), COALESCE(started_at::text,''), COALESCE(failure_reason,''), COALESCE(current_task_id::text,'') FROM initiative_runs WHERE initiative_id = \$\$${TASK_ID}\$\$::uuid ORDER BY started_at DESC LIMIT 1"
}

assert_task_payload_shape() {
  local resp
  resp="$(task_api_json)" || fail "brain task api"

  echo "$resp" | jq -e --arg tid "$TASK_ID" '.id == $tid' >/dev/null || fail "id mismatch"
  echo "$resp" | jq -e '.task_type == "harness_initiative"' >/dev/null || fail "task_type mismatch"
  echo "$resp" | jq -e '.status == "in_progress"' >/dev/null || fail "status not in_progress"
  echo "$resp" | jq -e --arg jid "$JOURNEY_ID" '.payload.mode == "headed" and .payload.executor == "codex" and .payload.orchestrator == "skill-relay" and .payload.journey_id == $jid and .payload.sprint_dir == "sprints/07212140-relay-833f9aa8" and .payload.dispatched_by_orchestrator == true' >/dev/null || fail "payload shape mismatch"
  echo "$resp" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("openai_api_key") | not) and (.payload | has("codex_token") | not) and (.payload | has("prep_prd_body") | not) and (.payload | has("thin_prd") | not)' >/dev/null || fail "payload contains forbidden field"
  echo "PASS: task-payload-shape"
}

assert_db_claim_oracle() {
  local row status task_type mode executor orch journey sprint_dir claimed_by claimed_at executor_kind
  row="$(task_db_row)" || fail "tasks query failed"
  [ -n "$row" ] || fail "tasks row missing"

  IFS='|' read -r status task_type mode executor orch journey sprint_dir claimed_by claimed_at executor_kind <<< "$row"
  [ "$status" = "in_progress" ] || fail "db status=$status"
  [ "$task_type" = "harness_initiative" ] || fail "db task_type=$task_type"
  [ "$mode" = "headed" ] || fail "db mode=$mode"
  [ "$executor" = "codex" ] || fail "db executor=$executor"
  [ "$orch" = "skill-relay" ] || fail "db orchestrator=$orch"
  [ "$journey" = "$JOURNEY_ID" ] || fail "db journey_id=$journey"
  [ "$sprint_dir" = "sprints/07212140-relay-833f9aa8" ] || fail "db sprint_dir=$sprint_dir"
  [ "$claimed_by" = "brain-tick-7" ] || fail "db claimed_by=$claimed_by"
  [ -n "$claimed_at" ] || fail "db claimed_at missing"
  [ "$executor_kind" = "relay-container" ] || fail "db executor_kind=$executor_kind"
  echo "PASS: db-claim-oracle"
}

assert_run_host_phase() {
  local row host phase started_at failure_reason current_task_id
  row="$(run_db_row)" || fail "initiative_runs query failed"
  [ -n "$row" ] || fail "initiative_runs row missing"

  IFS='|' read -r host phase started_at failure_reason current_task_id <<< "$row"
  [ "$host" = "skill-relay-codex-headed" ] || fail "run host=$host"
  [ "$phase" != "failed" ] || fail "run failed reason=$failure_reason"
  case "$phase" in
    A_planning|planning|gan|generate|evaluate|done|completed|running|in_progress) ;;
    *) fail "run phase=$phase" ;;
  esac
  [ -n "$started_at" ] || fail "run started_at missing"
  [ "$current_task_id" = "$TASK_ID" ] || fail "run current_task_id=$current_task_id"
  echo "PASS: run-host-phase"
}

assert_current_task_only() {
  require_current_binding
  echo "PASS: current-task-only"
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
  echo "PASS: evidence-boundary-and-redaction"
}

run_full() {
  assert_current_task_only
  assert_task_payload_shape
  assert_db_claim_oracle
  assert_run_host_phase
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
      run-host-phase) assert_run_host_phase ;;
      current-task-only) assert_current_task_only ;;
      evidence-boundary-and-redaction) assert_evidence_boundary_and_redaction ;;
      *) fail "unknown assert: ${2:-}" ;;
    esac
    ;;
  *)
    fail "usage: $0 [--assert task-payload-shape|db-claim-oracle|run-host-phase|current-task-only|evidence-boundary-and-redaction]"
    ;;
esac
