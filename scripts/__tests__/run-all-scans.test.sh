#!/usr/bin/env bash
set -uo pipefail

ERRORS=0
PASS=0
pass() { echo "✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS + 1)); }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
RUNNER="$REPO_ROOT/scripts/scan/run-all-scans.sh"
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/run-all-scans-test.XXXXXX")
trap 'rm -rf "$TMPD"' EXIT

NODE_STUB="$TMPD/node-stub"
cat > "$NODE_STUB" <<'STUB'
#!/bin/bash
printf '%s\n' "$1" >> "$SCAN_LOG"
if [[ "$(basename "$1")" == "${FAIL_SCANNER:-}" ]]; then
  exit 23
fi
STUB
chmod +x "$NODE_STUB"

DEFAULT_SCANS=$(cat <<'EOF'
scripts/scan/scan-api-registry.js
scripts/scan/scan-db-schema.js
scripts/scan/scan-test-registry.js
scripts/scan/scan-graph.mjs
EOF
)

echo "=== run-all-scans.sh cron PATH 测试 ==="

SUCCESS_LOG="$TMPD/default.log"
SUCCESS_OUT="$TMPD/default.out"
SUCCESS_RC=0
env -i PATH=/usr/bin:/bin NODE_BIN="$NODE_STUB" SCAN_LOG="$SUCCESS_LOG" \
  /bin/bash "$RUNNER" > "$SUCCESS_OUT" 2>&1 || SUCCESS_RC=$?

if [[ $SUCCESS_RC -eq 0 ]]; then
  pass "cron PATH 下使用 NODE_BIN 完成默认扫描"
else
  fail "cron PATH 下默认扫描失败(rc=$SUCCESS_RC): $(tr '\n' ' ' < "$SUCCESS_OUT")"
fi

if [[ -f "$SUCCESS_LOG" && "$(cat "$SUCCESS_LOG")" == "$DEFAULT_SCANS" ]]; then
  pass "默认四个 scanner 全部调用"
else
  fail "默认 scanner 调用不完整"
fi

FAIL_LOG="$TMPD/failure.log"
FAIL_OUT="$TMPD/failure.out"
FAIL_RC=0
env -i PATH=/usr/bin:/bin NODE_BIN="$NODE_STUB" SCAN_LOG="$FAIL_LOG" \
  FAIL_SCANNER="fail.js" SCAN_SCRIPTS="before.js fail.js after.mjs" \
  /bin/bash "$RUNNER" > "$FAIL_OUT" 2>&1 || FAIL_RC=$?

if [[ $FAIL_RC -ne 0 ]]; then
  pass "scanner 失败时 runner 聚合返回非零"
else
  fail "scanner 失败时 runner 错误返回 0"
fi

EXPECTED_FAILURE_SCANS=$(cat <<'EOF'
scripts/scan/before.js
scripts/scan/fail.js
scripts/scan/after.mjs
EOF
)
if [[ -f "$FAIL_LOG" && "$(cat "$FAIL_LOG")" == "$EXPECTED_FAILURE_SCANS" ]]; then
  pass "单个 scanner 失败后其余 scanner 仍继续执行"
else
  fail "scanner 失败后未完成全部调用"
fi

echo ""
echo "结果: PASS=$PASS FAIL=$ERRORS"
[[ $ERRORS -eq 0 ]] || exit 1
