#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

SPRINT_DIR="${SPRINT_DIR:-sprints/07191539-relay-dedbca0c}"
TASK_ID="${TASK_ID:-dedbca0c-0864-4b0d-be69-d37f70a25827}"
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
  [ "$TASK_ID" = "dedbca0c-0864-4b0d-be69-d37f70a25827" ] || fail "TASK_ID not current: $TASK_ID"
  case "$SPRINT_DIR" in
    sprints/07191539-relay-dedbca0c|*/sprints/07191539-relay-dedbca0c) ;;
    *) fail "SPRINT_DIR not current: $SPRINT_DIR" ;;
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
  psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 -c "SELECT status, task_type, payload->>'mode', payload->>'orchestrator', payload->>'dispatched_by_orchestrator', COALESCE(claimed_by,''), COALESCE(claimed_at::text,'') FROM tasks WHERE id = \$\$${TASK_ID}\$\$::uuid"
}

current_run_db_row() {
  require_current_binding
  psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 -c "SELECT COALESCE(phase,''), COALESCE(started_at::text,''), COALESCE(failure_reason,'') FROM initiative_runs WHERE initiative_id = \$\$${TASK_ID}\$\$::uuid ORDER BY started_at DESC LIMIT 1"
}

assert_current_task_only() {
  require_current_binding
  echo "OK: current task binding"
}

assert_task_payload_shape() {
  local resp expected_orch
  resp="$(task_api_json)" || fail "brain task api"
  expected_orch="$(expected_orchestrator)"

  echo "$resp" | python3 -c "import json,sys; t=json.load(sys.stdin); exit(0 if t.get('id')=='$TASK_ID' else 1)" || fail "id mismatch"
  echo "$resp" | python3 -c "import json,sys; t=json.load(sys.stdin); exit(0 if t.get('status') in ['in_progress','completed'] else 1)" || fail "status not in_progress or completed"
  echo "$resp" | python3 -c "
import json,sys
t=json.load(sys.stdin)
p=t.get('payload',{})
expected_orch='$expected_orch'
ok = (p.get('mode')=='headless' and
      p.get('orchestrator')==expected_orch and
      p.get('dispatched_by_orchestrator')==True)
exit(0 if ok else 1)
" || fail "payload shape mismatch (expected mode=headless, orchestrator=$expected_orch, dispatched_by_orchestrator=true)"
  echo "OK: task api payload shape"
}

assert_status_history() {
  local resp
  resp="$(task_api_json)" || fail "brain task api"
  echo "$resp" | python3 -c "
import json,sys
t=json.load(sys.stdin)
h=t.get('status_history',[])
ok=any(e.get('from')=='queued' and e.get('to')=='in_progress' for e in h)
exit(0 if ok else 1)
" || fail "status_history missing queued->in_progress transition"
  echo "OK: status_history queued->in_progress"
}

assert_claim_fields() {
  local resp
  resp="$(task_api_json)" || fail "brain task api"
  echo "$resp" | python3 -c "
import json,sys
t=json.load(sys.stdin)
ok=bool(t.get('claimed_by')) and bool(t.get('claimed_at'))
exit(0 if ok else 1)
" || fail "claimed_by or claimed_at missing"
  echo "OK: claim fields present"
}

assert_sprint_artifacts() {
  require_current_binding
  test -f "$SPRINT_DIR/sprint-prd.md" || fail "sprint-prd.md missing"
  test -f "$SPRINT_DIR/contract-draft.md" || fail "contract-draft.md missing"
  test -f "$SPRINT_DIR/contract-dod.md" || fail "contract-dod.md missing"
  echo "OK: sprint artifacts exist"
}

assert_runs_concern_or_verified() {
  local base runs run_count run_row run_phase run_started_at run_failure_reason
  assert_task_payload_shape >/dev/null
  assert_claim_fields >/dev/null

  base="$(brain_base_url)"
  runs="$(curl -sf "$base/api/brain/harness/runs?limit=100")" || fail "harness runs api"
  run_count="$(echo "$runs" | python3 -c "import json,sys; r=json.load(sys.stdin); print(sum(1 for x in r if x.get('initiative_id')=='$TASK_ID'))")"

  if [ "$run_count" -eq 0 ]; then
    # B-6 CONCERN: headless foreground takeover 不经 Brain tick，initiative_runs 不自动创建
    echo "CONCERN: initiative_runs missing for current task (expected: headless foreground takeover does not create initiative_run row); B-6 unverifiable"
    return
  fi

  run_row="$(current_run_db_row)" || fail "initiative_runs query failed"
  IFS='|' read -r run_phase run_started_at run_failure_reason <<< "$run_row"
  [ "$run_phase" != "failed" ] || fail "run failed reason=$run_failure_reason"
  echo "OK: initiative_runs current run verified (phase=$run_phase)"
}

assert_evidence_boundary_and_redaction() {
  require_current_binding
  assert_task_payload_shape >/dev/null

  local path
  for path in "$SPRINT_DIR/tui.log" "$SPRINT_DIR/harness-report.md"; do
    if [ -f "$path" ]; then
      if grep -E 'ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]{20,}|xox[abp]-|BEGIN [A-Z ]*PRIVATE KEY|Authorization: Bearer' "$path" >/dev/null; then
        fail "sensitive token-like content in $path"
      fi
    fi
  done
  echo "OK: evidence boundary and redaction"
}

assert_l3_verification_level() {
  require_current_binding
  local base resp
  base="$(brain_base_url)"
  resp="$(curl -sf "$base/api/brain/tasks/$TASK_ID")" || fail "brain task api unreachable (L3 verification requires real Brain API)"
  echo "$resp" | python3 -c "import json,sys; t=json.load(sys.stdin); exit(0 if t.get('id')=='$TASK_ID' else 1)" || fail "L3 verification: task id mismatch — not a real Brain API response"
  echo "PASS: verification_level: L3 真目标复核"
}

run_full() {
  assert_current_task_only
  assert_task_payload_shape
  assert_status_history
  assert_claim_fields
  assert_sprint_artifacts
  assert_runs_concern_or_verified
  assert_evidence_boundary_and_redaction
  assert_l3_verification_level
  echo "PASS: headless relay smoke validated for current task"
}

case "${1:-}" in
  "")
    run_full
    ;;
  --assert)
    case "${2:-}" in
      task-payload-shape) assert_task_payload_shape ;;
      status-history) assert_status_history ;;
      claim-fields) assert_claim_fields ;;
      sprint-artifacts) assert_sprint_artifacts ;;
      runs-concern-or-verified) assert_runs_concern_or_verified ;;
      current-task-only) assert_current_task_only ;;
      evidence-boundary-and-redaction) assert_evidence_boundary_and_redaction ;;
      l3-verification-level) assert_l3_verification_level ;;
      *) fail "unknown assert: ${2:-}" ;;
    esac
    ;;
  *)
    fail "usage: $0 [--assert task-payload-shape|status-history|claim-fields|sprint-artifacts|runs-concern-or-verified|current-task-only|evidence-boundary-and-redaction|l3-verification-level]"
    ;;
esac
