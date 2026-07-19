#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"
TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
VERIFY="${VERIFY:-$ROOT_DIR/scripts/smoke/e2e/relay-d355821f.sh}"
FAILURES=0

record_fail() {
  echo "FAIL: $*"
  FAILURES=$((FAILURES + 1))
}

require_current_binding() {
  echo "TEST: contract files are rebound to current task"
  [ "$TASK_ID" = "d355821f-4a37-4fa2-ad2f-99668bc91a3d" ] || {
    record_fail "TASK_ID is not current: $TASK_ID"
    return
  }
  case "$SPRINT_DIR" in
    sprints/07191314-relay-d355821f|*/sprints/07191314-relay-d355821f) ;;
    *)
      record_fail "SPRINT_DIR is not current: $SPRINT_DIR"
      return
      ;;
  esac
  local old_short
  old_short="$(printf '%s%s' 537 10094)"
  if grep -R "$old_short" "$ROOT_DIR/$SPRINT_DIR/contract-draft.md" "$ROOT_DIR/$SPRINT_DIR/contract-dod.md" >/dev/null 2>&1; then
    record_fail "historical task short id appears in current contract artifacts"
    return
  fi
  echo "PASS: contract files are rebound to current task"
}

run_test() {
  local name="$1"
  local assert_name="${2:-}"
  echo "TEST: $name"
  if [ ! -f "$VERIFY" ]; then
    record_fail "missing $VERIFY"
    return
  fi
  if [ -n "$assert_name" ]; then
    TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DATABASE_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert "$assert_name"
  else
    TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DATABASE_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY"
  fi
  local code=$?
  if [ "$code" -eq 0 ]; then
    echo "PASS: $name"
  else
    record_fail "$name exit=$code"
  fi
}

require_current_binding
run_test "e2e-verify.sh 校验当前 task API payload shape" "task-payload-shape"
run_test "e2e-verify.sh 校验当前 task DB claim oracle" "db-claim-oracle"
run_test "e2e-verify.sh 对 foreground run 绑定 claim oracle，拒绝 headless/container run" "runs-concern-or-verified"
run_test "e2e-verify.sh 拒绝历史 task 作为当前证据" "current-task-only"
run_test "e2e-verify.sh 日志证据限于当前 sprint 且脱敏" "evidence-boundary-and-redaction"
run_test "e2e-verify.sh local_api 全链路基于当前 task API 和 DB claim oracle"

if [ "$FAILURES" -ne 0 ]; then
  echo "FAIL: $FAILURES contract red assertions failed"
  exit 1
fi

echo "PASS: all contract red assertions passed"
