#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
ASSERT="$REPO_ROOT/scripts/ci/assert-internal-auth-ready.sh"
PASS=0
FAIL=0

expect_status() {
  local status="$1" expected_rc="$2" expected_text="$3"
  local output rc
  set +e
  output=$(INTERNAL_AUTH_STATUS_OVERRIDE="$status" bash "$ASSERT" http://brain.invalid 2>&1)
  rc=$?
  set -e
  if [[ "$rc" -eq "$expected_rc" && "$output" == *"$expected_text"* ]]; then
    echo "✅ HTTP $status => rc=$rc $expected_text"
    PASS=$((PASS + 1))
  else
    echo "❌ HTTP $status => rc=$rc output=$output"
    FAIL=$((FAIL + 1))
  fi
}

expect_status 401 0 INTERNAL_AUTH_READY
expect_status 503 5 INTERNAL_AUTH_NOT_CONFIGURED
expect_status 400 6 INTERNAL_AUTH_UNENFORCED

echo "结果: $PASS passed, $FAIL failed"
exit "$FAIL"
