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
if [[ ${DIRNAME_OVERRIDE+x} ]]; then
  printf '%s\n' "$DIRNAME_OVERRIDE"
  exit 0
fi
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
if [[ -n "${GIT_LOG:-}" ]]; then
  printf '%s\n' "$*" >> "$GIT_LOG"
fi
if [[ "${1:-}" == "branch" && "${2:-}" == "--show-current" ]]; then
  printf '%s\n' "${GIT_BRANCH:-cp-run-all-scans-test}"
  exit 0
fi
if [[ "${1:-}" == "status" && "${2:-}" == "--porcelain" ]]; then
  exit 0
fi
if [[ "${1:-}" == "pull" && "${2:-}" == "--ff-only" ]]; then
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
if [[ -n "${NODE_LOG:-}" ]]; then
  printf '%s\n' "$*" >> "$NODE_LOG"
fi
printf '%s\n' "$1" >> "$SCAN_LOG"
if [[ "${1##*/}" == "${FAIL_SCANNER:-}" ]]; then
  exit 23
fi
STUB

cat > "$CONTROL_BIN/curl" <<'STUB'
#!/bin/bash
if [[ -n "${CURL_LOG:-}" ]]; then
  printf '%s\n' "$*" >> "$CURL_LOG"
fi
printf '%s\n' '{"status":"active"}'
STUB
chmod +x "$CONTROL_BIN/dirname" "$CONTROL_BIN/date" "$CONTROL_BIN/git" "$CONTROL_BIN/curl" "$NODE_STUB"

DEFAULT_SCANS=$(cat <<'EOF'
scripts/scan/scan-api-registry.js
scripts/scan/scan-db-schema.js
scripts/scan/scan-test-registry.js
scripts/scan/scan-graph.mjs
EOF
)

echo "=== run-all-scans.sh cron PATH 测试 ==="

SUCCESS_LOG="$TMPD/default.log"
SUCCESS_CURL_LOG="$TMPD/default-curl.log"
SUCCESS_OUT="$TMPD/default.out"
SUCCESS_RC=0
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" \
  NODE_FALLBACK_PATHS="$CONTROL_BIN/missing" SCAN_LOG="$SUCCESS_LOG" \
  CURL_LOG="$SUCCESS_CURL_LOG" \
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

if [[ -f "$SUCCESS_CURL_LOG" ]] \
  && grep -q -- '-X POST http://localhost:5221/api/brain/map/rebuild' "$SUCCESS_CURL_LOG" \
  && grep -q -- 'scope_key.*cecelia' "$SUCCESS_CURL_LOG"; then
  pass "全部事实扫描成功后按 scope 原子重建 active Map projection"
else
  fail "扫描成功后未重建 cecelia Map projection"
fi

FAIL_LOG="$TMPD/failure.log"
FAIL_CURL_LOG="$TMPD/failure-curl.log"
FAIL_OUT="$TMPD/failure.out"
FAIL_RC=0
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" \
  NODE_FALLBACK_PATHS="$CONTROL_BIN/missing" SCAN_LOG="$FAIL_LOG" \
  CURL_LOG="$FAIL_CURL_LOG" \
  FAIL_SCANNER="fail.js" SCAN_SCRIPTS="before.js fail.js after.mjs" \
  /bin/bash "$RUNNER" > "$FAIL_OUT" 2>&1 || FAIL_RC=$?

if [[ $FAIL_RC -ne 0 ]]; then
  pass "scanner 失败时 runner 聚合返回非零"
else
  fail "scanner 失败时 runner 错误返回 0"
fi

if [[ ! -s "$FAIL_CURL_LOG" ]]; then
  pass "任一 scanner 失败时不发布混合 revision projection"
else
  fail "scanner 失败后仍调用 Map rebuild"
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

SKIP_PULL_LOG="$TMPD/skip-pull-git.log"
SKIP_PULL_SCAN_LOG="$TMPD/skip-pull-scan.log"
SKIP_PULL_OUT="$TMPD/skip-pull.out"
SKIP_PULL_RC=0
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" \
  NODE_FALLBACK_PATHS="$CONTROL_BIN/missing" SCAN_LOG="$SKIP_PULL_SCAN_LOG" \
  GIT_LOG="$SKIP_PULL_LOG" GIT_BRANCH=main SKIP_GIT_PULL=1 SCAN_SCRIPTS="probe.js" \
  /bin/bash "$RUNNER" > "$SKIP_PULL_OUT" 2>&1 || SKIP_PULL_RC=$?

PULL_CALLED=0
if [[ -f "$SKIP_PULL_LOG" ]] && grep -q '^pull --ff-only$' "$SKIP_PULL_LOG"; then
  PULL_CALLED=1
fi
if [[ $SKIP_PULL_RC -eq 0 ]] \
  && [[ $PULL_CALLED -eq 0 ]] \
  && [[ "$(cat "$SKIP_PULL_SCAN_LOG")" == 'scripts/scan/probe.js' ]]; then
  pass "SKIP_GIT_PULL=1 在 clean main 上禁止 git pull 且继续扫描"
else
  fail "SKIP_GIT_PULL=1 未阻止 git pull(rc=$SKIP_PULL_RC): $(tr '\n' ' ' < "$SKIP_PULL_OUT")"
fi

ROOT_FAILURE_GIT_LOG="$TMPD/root-failure-git.log"
ROOT_FAILURE_NODE_LOG="$TMPD/root-failure-node.log"
ROOT_FAILURE_SCAN_LOG="$TMPD/root-failure-scan.log"
ROOT_FAILURE_OUT="$TMPD/root-failure.out"
ROOT_FAILURE_RC=0
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" \
  NODE_FALLBACK_PATHS="$CONTROL_BIN/missing" \
  DIRNAME_OVERRIDE="$TMPD/unavailable-root/scripts/scan" \
  GIT_LOG="$ROOT_FAILURE_GIT_LOG" NODE_LOG="$ROOT_FAILURE_NODE_LOG" \
  SCAN_LOG="$ROOT_FAILURE_SCAN_LOG" SCAN_SCRIPTS="probe.js" \
  /bin/bash "$RUNNER" > "$ROOT_FAILURE_OUT" 2>&1 || ROOT_FAILURE_RC=$?

if [[ $ROOT_FAILURE_RC -eq 1 ]] \
  && [[ ! -e "$ROOT_FAILURE_GIT_LOG" ]] \
  && [[ ! -e "$ROOT_FAILURE_NODE_LOG" ]] \
  && [[ ! -e "$ROOT_FAILURE_SCAN_LOG" ]]; then
  pass "repo root 不可用时 exit 1 且不调用 git、node 或 scanner"
else
  fail "repo root 不可用时仍继续执行(rc=$ROOT_FAILURE_RC): $(tr '\n' ' ' < "$ROOT_FAILURE_OUT")"
fi

ROOT_DEPS_OK=1
for WORKFLOW in .github/workflows/{ci-smoke-glob-runner,ci,nightly-regression}.yml; do
  awk '/name: Install Brain deps/{n=12} n && /cd packages\/brain/{exit 1} n && /^[[:space:]]+(run: )?npm ci$/{exit 0} n && n-- == 1{exit 1}' "$WORKFLOW" || ROOT_DEPS_OK=0
done
if [[ $ROOT_DEPS_OK -eq 1 ]]; then pass "真实 smoke CI 安装 graph scanner 的根依赖"; else fail "真实 smoke CI 仅安装 Brain 依赖"; fi

echo ""
echo "结果: PASS=$PASS FAIL=$ERRORS"
[[ $ERRORS -eq 0 ]] || exit 1
