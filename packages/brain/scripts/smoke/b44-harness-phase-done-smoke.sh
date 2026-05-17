#!/usr/bin/env bash
# B44 smoke — static checks only (no live server needed, CI-safe)
set -euo pipefail

TEST_FILE="packages/brain/src/workflows/__tests__/harness-pipeline-b44-integration.test.js"

echo "[b44-smoke] Checking test file exists..."
[ -f "$TEST_FILE" ] || { echo "FAIL: $TEST_FILE not found"; exit 1; }

echo "[b44-smoke] Checking phase+done assertion present..."
grep -q "sql.includes.*phase" "$TEST_FILE" || { echo "FAIL: phase assertion missing"; exit 1; }
grep -q "params.includes.*done" "$TEST_FILE" || { echo "FAIL: done param assertion missing"; exit 1; }

echo "[b44-smoke] Checking buildHarnessFullGraph import..."
grep -q "buildHarnessFullGraph" "$TEST_FILE" || { echo "FAIL: buildHarnessFullGraph import missing"; exit 1; }

echo "[b44-smoke] ALL CHECKS PASSED"
exit 0
