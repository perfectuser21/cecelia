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

CONTROL_BIN="$TMPD/bin"
mkdir -p "$CONTROL_BIN"

cat > "$CONTROL_BIN/dirname" <<'STUB'
#!/bin/bash
path=${1%/}
case "$path" in
  */*)
    directory=${path%/*}
    [[ -n "$directory" ]] || directory=/
    printf '%s\n' "$directory"
    ;;
  *) printf '.\n' ;;
esac
STUB

cat > "$CONTROL_BIN/date" <<'STUB'
#!/bin/bash
printf '%s\n' '2026-08-10 00:00:00 UTC'
STUB

cat > "$CONTROL_BIN/git" <<'STUB'
#!/bin/bash
if [[ "${1:-}" == "branch" && "${2:-}" == "--show-current" ]]; then
  printf '%s\n' 'cp-run-all-scans-test'
  exit 0
fi
printf 'unexpected git invocation:' >&2
printf ' %q' "$@" >&2
printf '\n' >&2
exit 97
STUB

NODE_STUB="$CONTROL_BIN/node-stub"
cat > "$NODE_STUB" <<'STUB'
#!/bin/bash
printf '%s\n' "$1" >> "$SCAN_LOG"
if [[ "${1##*/}" == "${FAIL_SCANNER:-}" ]]; then
  exit 23
fi
STUB
chmod +x "$CONTROL_BIN/dirname" "$CONTROL_BIN/date" "$CONTROL_BIN/git" "$NODE_STUB"

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
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" \
  NODE_FALLBACK_PATHS="$CONTROL_BIN/missing" SCAN_LOG="$SUCCESS_LOG" \
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
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" \
  NODE_FALLBACK_PATHS="$CONTROL_BIN/missing" SCAN_LOG="$FAIL_LOG" \
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

EMPTY_LOG="$TMPD/empty.log"
EMPTY_OUT="$TMPD/empty.out"
EMPTY_RC=0
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" \
  NODE_FALLBACK_PATHS="$CONTROL_BIN/missing" SCAN_LOG="$EMPTY_LOG" \
  SCAN_SCRIPTS=$' \n\t ' /bin/bash "$RUNNER" > "$EMPTY_OUT" 2>&1 || EMPTY_RC=$?

if [[ $EMPTY_RC -eq 2 && "$(cat "$EMPTY_OUT")" == *"ERROR: SCAN_SCRIPTS"* ]]; then
  pass "SCAN_SCRIPTS 空白值清晰报错并 exit 2"
else
  fail "SCAN_SCRIPTS 空白值未按合同失败(rc=$EMPTY_RC)"
fi

MULTILINE_LOG="$TMPD/multiline.log"
MULTILINE_OUT="$TMPD/multiline.out"
MULTILINE_RC=0
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" \
  NODE_FALLBACK_PATHS="$CONTROL_BIN/missing" SCAN_LOG="$MULTILINE_LOG" \
  SCAN_SCRIPTS=$'first.js\nsecond.mjs\tthird.js' \
  /bin/bash "$RUNNER" > "$MULTILINE_OUT" 2>&1 || MULTILINE_RC=$?

EXPECTED_MULTILINE_SCANS=$(cat <<'EOF'
scripts/scan/first.js
scripts/scan/second.mjs
scripts/scan/third.js
EOF
)
if [[ $MULTILINE_RC -eq 0 && -f "$MULTILINE_LOG" && "$(cat "$MULTILINE_LOG")" == "$EXPECTED_MULTILINE_SCANS" ]]; then
  pass "SCAN_SCRIPTS 按所有 shell 空白解析"
else
  fail "SCAN_SCRIPTS 多行或 tab 解析不完整(rc=$MULTILINE_RC)"
fi

MISSING_NODE_LOG="$TMPD/missing-node.log"
MISSING_NODE_OUT="$TMPD/missing-node.out"
MISSING_NODE_RC=0
env -i PATH="$CONTROL_BIN" NODE_BIN="$CONTROL_BIN/missing-node" \
  NODE_FALLBACK_PATHS="$CONTROL_BIN/missing-fallback" SCAN_LOG="$MISSING_NODE_LOG" \
  SCAN_SCRIPTS="probe.js" /bin/bash "$RUNNER" > "$MISSING_NODE_OUT" 2>&1 || MISSING_NODE_RC=$?

if [[ $MISSING_NODE_RC -eq 127 && ! -e "$MISSING_NODE_LOG" && "$(cat "$MISSING_NODE_OUT")" == *"ERROR: 找不到可执行的 Node.js"* ]]; then
  pass "无可用 Node 时在运行 scanner 前清晰报错并 exit 127"
else
  fail "NODE_FALLBACK_PATHS 未限制绝对路径回退(rc=$MISSING_NODE_RC)"
fi

echo ""
echo "结果: PASS=$PASS FAIL=$ERRORS"
[[ $ERRORS -eq 0 ]] || exit 1
