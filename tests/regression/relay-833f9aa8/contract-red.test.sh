#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SPRINT_DIR="${SPRINT_DIR:-sprints/07212140-relay-833f9aa8}"
TASK_ID="${TASK_ID:-833f9aa8-7d17-4537-bff7-0ad4e16ca1be}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
VERIFY="${VERIFY:-$ROOT_DIR/scripts/smoke/e2e/relay-833f9aa8.sh}"
FAILURES=0

record_fail() {
  echo "FAIL: $*"
  FAILURES=$((FAILURES + 1))
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

echo "TEST: contract files are rebound to current task"
[ "$TASK_ID" = "833f9aa8-7d17-4537-bff7-0ad4e16ca1be" ] || record_fail "TASK_ID is not current: $TASK_ID"
case "$SPRINT_DIR" in
  sprints/07212140-relay-833f9aa8|*/sprints/07212140-relay-833f9aa8) ;;
  *) record_fail "SPRINT_DIR is not current: $SPRINT_DIR" ;;
esac

run_test "e2e-verify.sh 校验当前 task API payload shape" "task-payload-shape"
run_test "e2e-verify.sh 校验当前 task DB claim oracle" "db-claim-oracle"
run_test "e2e-verify.sh 校验当前 task run host 与 phase" "run-host-phase"
run_test "e2e-verify.sh 拒绝历史 task 作为当前证据" "current-task-only"
run_test "e2e-verify.sh 日志证据限于当前 sprint 且脱敏" "evidence-boundary-and-redaction"
run_test "e2e-verify.sh local_api 全链路基于当前 task API 与 DB"
run_test "verification_level: L3 真目标复核"

if [ "$FAILURES" -ne 0 ]; then
  echo "FAIL: $FAILURES contract red assertions failed"
  exit 1
fi

echo "PASS: all contract red assertions passed"
