#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SPRINT_DIR="${SPRINT_DIR:-sprints/07172022-relay-53710094}"
TASK_ID="${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
VERIFY="$ROOT_DIR/$SPRINT_DIR/e2e-verify.sh"
FAILURES=0

run_test() {
  local name="$1"
  local assert_name="$2"
  echo "TEST: $name"
  TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DATABASE_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY" --assert "$assert_name"
  local code=$?
  if [ "$code" -eq 0 ]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name exit=$code"
    FAILURES=$((FAILURES + 1))
  fi
}

run_test "e2e-verify.sh 校验 task API payload shape" "task-payload-shape"
run_test "e2e-verify.sh 校验 DB tasks 认领状态" "db-tasks-claimed"
run_test "e2e-verify.sh 对 initiative_runs 采用可选 run 或 foreground path" "run-or-foreground-path"
run_test "e2e-verify.sh 拒绝 failed 状态并不记录敏感字段" "failed-and-secrets-rejected"

if [ "$FAILURES" -ne 0 ]; then
  echo "FAIL: $FAILURES contract red assertions failed"
  exit 1
fi

echo "PASS: all contract red assertions passed"
