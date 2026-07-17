#!/usr/bin/env bash
set -euo pipefail

SPRINT_DIR="${SPRINT_DIR:-sprints/07172022-relay-53710094}"
TASK_ID="${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
EXPECTED_JOURNEY_ID="bb8cc561-b3ee-4fec-b74d-2255694bd963"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

info() {
  echo "$*"
}

validate_task_id() {
  case "$TASK_ID" in
    53710094-898c-452c-8cc3-a56149e8b0ac) ;;
    *) fail "unexpected TASK_ID=$TASK_ID" ;;
  esac
}

brain_task_json() {
  validate_task_id
  local base="${BRAIN_URL%/}"
  curl -fsS "$base/api/brain/tasks/$TASK_ID"
}

tasks_row() {
  validate_task_id
  psql "$DB" -XAt -F '|' -c "SELECT status, task_type, COALESCE(claimed_by,''), COALESCE(claimed_at::text,''), COALESCE(executor_kind,'') FROM tasks WHERE id = \$\$${TASK_ID}\$\$"
}

run_row() {
  validate_task_id
  psql "$DB" -XAt -F '|' -c "SELECT COALESCE(orchestrator_host,''), COALESCE(phase,''), COALESCE(started_at::text,''), COALESCE(failure_reason,'') FROM initiative_runs WHERE initiative_id = \$\$${TASK_ID}\$\$ ORDER BY started_at DESC LIMIT 1"
}

forbidden_payload_fields() {
  jq -r '
    def forbidden:
      ["token","github_token","anthropic_token","openai_api_key","thin_prd","prep_prd_body"];
    [
      .payload
      | paths
      | select(length > 0)
      | select(.[-1] as $key | ($key | type) == "string" and (forbidden | index($key)))
      | join(".")
    ]
    | unique
    | .[]?
  '
}

assert_task_payload_shape() {
  local resp forbidden
  resp="$(brain_task_json)" || fail "brain task api unavailable"

  jq -e --arg task_id "$TASK_ID" '.id == $task_id' <<<"$resp" >/dev/null \
    || fail "brain task id mismatch"
  jq -e '.task_type == "harness_initiative"' <<<"$resp" >/dev/null \
    || fail "task_type mismatch"
  jq -e '.payload.mode == "headed" and .payload.executor == "codex" and .payload.orchestrator == "skill-relay"' <<<"$resp" >/dev/null \
    || fail "payload headed codex skill-relay shape mismatch"
  jq -e --arg journey_id "$EXPECTED_JOURNEY_ID" '.payload.journey_id == $journey_id' <<<"$resp" >/dev/null \
    || fail "payload journey_id mismatch"

  forbidden="$(forbidden_payload_fields <<<"$resp")"
  [ -z "$forbidden" ] || fail "payload contains forbidden field(s): $forbidden"

  info "PASS: task-payload-shape"
}

assert_db_tasks_claimed() {
  local row status task_type claimed_by claimed_at executor_kind
  row="$(tasks_row)" || fail "tasks query failed"
  [ -n "$row" ] || fail "tasks row missing"

  status="$(printf "%s" "$row" | cut -d'|' -f1)"
  task_type="$(printf "%s" "$row" | cut -d'|' -f2)"
  claimed_by="$(printf "%s" "$row" | cut -d'|' -f3)"
  claimed_at="$(printf "%s" "$row" | cut -d'|' -f4)"
  executor_kind="$(printf "%s" "$row" | cut -d'|' -f5)"

  [ "$status" = "in_progress" ] || fail "status=$status"
  [ "$task_type" = "harness_initiative" ] || fail "task_type=$task_type"
  [ -n "$claimed_by" ] || fail "claimed_by missing"
  [ -n "$claimed_at" ] || fail "claimed_at missing"
  case "$executor_kind" in
    ""|headed-session) ;;
    *) fail "executor_kind=$executor_kind" ;;
  esac

  info "PASS: db-tasks-claimed"
}

assert_run_or_foreground_path() {
  local row host phase started_at failure_reason
  row="$(run_row)" || fail "initiative_runs query failed"

  if [ -z "$row" ]; then
    assert_task_payload_shape >/dev/null
    assert_db_tasks_claimed >/dev/null
    info "CONCERN: initiative_runs row missing; validated foreground takeover path"
    info "PASS: run-or-foreground-path"
    return 0
  fi

  host="$(printf "%s" "$row" | cut -d'|' -f1)"
  phase="$(printf "%s" "$row" | cut -d'|' -f2)"
  started_at="$(printf "%s" "$row" | cut -d'|' -f3)"
  failure_reason="$(printf "%s" "$row" | cut -d'|' -f4)"

  case "$host" in
    *skill-relay*codex*headed*|*codex*headed*) ;;
    *) fail "host=$host" ;;
  esac
  [ "$phase" != "failed" ] || fail "phase=failed reason=$failure_reason"
  case "$phase" in
    A_planning|planning|gan|generate|evaluate|done|completed|running|in_progress) ;;
    *) fail "phase=$phase" ;;
  esac
  [ -n "$started_at" ] || fail "started_at missing"

  info "PASS: run-or-foreground-path"
}

assert_failed_and_secrets_rejected() {
  local resp forbidden task_row task_status run phase failure_reason
  resp="$(brain_task_json)" || fail "brain task api unavailable"

  task_status="$(jq -r '.status // ""' <<<"$resp")"
  [ "$task_status" != "failed" ] || fail "task status is failed"

  forbidden="$(forbidden_payload_fields <<<"$resp")"
  [ -z "$forbidden" ] || fail "payload contains forbidden field(s): $forbidden"

  task_row="$(tasks_row)" || fail "tasks query failed"
  [ -n "$task_row" ] || fail "tasks row missing"
  task_status="$(printf "%s" "$task_row" | cut -d'|' -f1)"
  [ "$task_status" != "failed" ] || fail "db task status is failed"

  run="$(run_row)" || fail "initiative_runs query failed"
  if [ -n "$run" ]; then
    phase="$(printf "%s" "$run" | cut -d'|' -f2)"
    failure_reason="$(printf "%s" "$run" | cut -d'|' -f4)"
    [ "$phase" != "failed" ] || fail "run phase=failed reason=$failure_reason"
  fi

  info "PASS: failed-and-secrets-rejected"
}

run_full() {
  assert_task_payload_shape
  assert_db_tasks_claimed
  assert_run_or_foreground_path
  assert_failed_and_secrets_rejected
  info "PASS: codex headed relay smoke contract validated"
}

case "${1:-}" in
  "")
    run_full
    ;;
  --assert)
    case "${2:-}" in
      task-payload-shape) assert_task_payload_shape ;;
      db-tasks-claimed) assert_db_tasks_claimed ;;
      run-or-foreground-path) assert_run_or_foreground_path ;;
      failed-and-secrets-rejected) assert_failed_and_secrets_rejected ;;
      *) fail "unknown assert=${2:-}" ;;
    esac
    ;;
  *)
    fail "usage: $0 [--assert task-payload-shape|db-tasks-claimed|run-or-foreground-path|failed-and-secrets-rejected]"
    ;;
esac
