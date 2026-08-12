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
TARGET_REPO=0
if [[ "${1:-}" == "-C" ]]; then
  TARGET_REPO=1
  shift 2
fi
if [[ "${1:-}" == "branch" && "${2:-}" == "--show-current" ]]; then
  if [[ $TARGET_REPO -eq 1 ]]; then
    printf '%s\n' "${GIT_TARGET_BRANCH:-main}"
  else
    printf '%s\n' "${GIT_BRANCH:-main}"
  fi
  exit 0
fi
if [[ "${1:-}" == "status" && "${2:-}" == "--porcelain" ]]; then
  if [[ $TARGET_REPO -eq 1 && -n "${GIT_TARGET_DIRTY:-}" ]]; then printf '%s\n' ' M changed'; fi
  exit 0
fi
if [[ "${1:-}" == "pull" && "${2:-}" == "--ff-only" ]]; then
  exit 0
fi
if [[ "${1:-}" == "rev-parse" && "${2:-}" == "HEAD" ]]; then
  if [[ $TARGET_REPO -eq 1 && -n "${TARGET_HEAD_CHANGE_MARKER:-}" \
    && -f "$TARGET_HEAD_CHANGE_MARKER" ]]; then
    printf '%s\n' "${GIT_TARGET_HEAD_AFTER_SCAN:-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
  elif [[ $TARGET_REPO -eq 1 ]]; then
    printf '%s\n' "${GIT_TARGET_HEAD_SHA:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}"
  elif [[ -n "${HEAD_CHANGE_MARKER:-}" && -f "$HEAD_CHANGE_MARKER" ]]; then
    printf '%s\n' "${GIT_HEAD_AFTER_SCAN:-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
  else
    printf '%s\n' "${GIT_HEAD_SHA:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}"
  fi
  exit 0
fi
if [[ "${1:-}" == "rev-parse" && "${2:-}" == "origin/main" ]]; then
  printf '%s\n' "${GIT_REMOTE_SHA:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}"
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
if [[ "${1##*/}" == "verify-scan-batch.mjs" ]]; then
  if [[ -n "${VERIFY_LOG:-}" ]]; then printf '%s\n' "${2:-}" > "$VERIFY_LOG"; fi
  exit "${VERIFY_EXIT:-0}"
fi
if [[ -n "${ENV_LOG:-}" ]]; then
  printf '%s|%s|%s|%s\n' "${SCAN_REPO_NAME:-}" "${SCAN_REPO_ROOT:-}" \
    "${SOURCE_DATABASE_URL:-}" "${GRAPH_REPOS:-}" >> "$ENV_LOG"
fi
printf '%s\n' "$1" >> "$SCAN_LOG"
if [[ -n "${HEAD_CHANGE_MARKER:-}" ]]; then : > "$HEAD_CHANGE_MARKER"; fi
if [[ -n "${TARGET_HEAD_CHANGE_MARKER:-}" ]]; then : > "$TARGET_HEAD_CHANGE_MARKER"; fi
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
  VERIFY_LOG="$TMPD/default-verify.log" \
  /bin/bash "$RUNNER" > "$SUCCESS_OUT" 2>&1 || SUCCESS_RC=$?

if [[ $SUCCESS_RC -eq 0 ]]; then
  pass "cron PATH 下使用 NODE_BIN 完成默认扫描"
else
  fail "cron PATH 下默认扫描失败(rc=$SUCCESS_RC): $(tr '\n' ' ' < "$SUCCESS_OUT")"
fi

if [[ -f "$TMPD/default-verify.log" ]] \
  && [[ "$(cat "$TMPD/default-verify.log")" == aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ]]; then
  pass "rebuild 前机械核对四类 header revision"
else
  fail "默认扫描未执行 batch revision 核对"
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

TOKEN_ENV="$TMPD/internal-auth.env"
printf '%s\n' 'CECELIA_INTERNAL_TOKEN=test-internal-token-0123456789abcdef' > "$TOKEN_ENV"
TOKEN_CURL_LOG="$TMPD/token-curl.log"
TOKEN_RC=0
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" \
  NODE_FALLBACK_PATHS="$CONTROL_BIN/missing" SCAN_LOG="$TMPD/token-scan.log" \
  CURL_LOG="$TOKEN_CURL_LOG" VERIFY_LOG="$TMPD/token-verify.log" \
  CECELIA_INTERNAL_ENV_FILE="$TOKEN_ENV" \
  /bin/bash "$RUNNER" > "$TMPD/token.out" 2>&1 || TOKEN_RC=$?
if [[ $TOKEN_RC -eq 0 ]] \
  && grep -q -- 'Authorization: Bearer test-internal-token-0123456789abcdef' "$TOKEN_CURL_LOG"; then
  pass "宿主 cron 从受保护 env 文件加载内部 token 并鉴权 Map rebuild"
else
  fail "宿主 cron 未携带内部 token(rc=$TOKEN_RC): $(tr '\n' ' ' < "$TMPD/token.out")"
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

UNSAFE_BRANCH_SCAN_LOG="$TMPD/unsafe-branch-scan.log"
UNSAFE_BRANCH_OUT="$TMPD/unsafe-branch.out"
UNSAFE_BRANCH_RC=0
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" \
  NODE_FALLBACK_PATHS="$CONTROL_BIN/missing" SCAN_LOG="$UNSAFE_BRANCH_SCAN_LOG" \
  GIT_BRANCH=feature/unsafe SCAN_SCRIPTS="probe.js" \
  /bin/bash "$RUNNER" > "$UNSAFE_BRANCH_OUT" 2>&1 || UNSAFE_BRANCH_RC=$?
if [[ $UNSAFE_BRANCH_RC -eq 3 && ! -e "$UNSAFE_BRANCH_SCAN_LOG" ]]; then
  pass "非 main checkout 在 scanner 启动前 fail-closed"
else
  fail "非 main checkout 仍被扫描(rc=$UNSAFE_BRANCH_RC)"
fi

MISMATCH_SCAN_LOG="$TMPD/mismatch-scan.log"
MISMATCH_OUT="$TMPD/mismatch.out"
MISMATCH_RC=0
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" \
  NODE_FALLBACK_PATHS="$CONTROL_BIN/missing" SCAN_LOG="$MISMATCH_SCAN_LOG" \
  GIT_HEAD_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  EXPECTED_SCAN_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  SKIP_GIT_PULL=1 SCAN_SCRIPTS="probe.js" \
  /bin/bash "$RUNNER" > "$MISMATCH_OUT" 2>&1 || MISMATCH_RC=$?
if [[ $MISMATCH_RC -eq 3 && ! -e "$MISMATCH_SCAN_LOG" ]]; then
  pass "扫描 HEAD 与事件扳机 SHA 不一致时 fail-closed"
else
  fail "错误 revision 仍被记为目标快照(rc=$MISMATCH_RC)"
fi

MIDSCAN_MARKER="$TMPD/midscan-head-changed"
MIDSCAN_CURL_LOG="$TMPD/midscan-curl.log"
MIDSCAN_RC=0
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" \
  NODE_FALLBACK_PATHS="$CONTROL_BIN/missing" SCAN_LOG="$TMPD/midscan-scan.log" \
  VERIFY_LOG="$TMPD/midscan-verify.log" CURL_LOG="$MIDSCAN_CURL_LOG" \
  HEAD_CHANGE_MARKER="$MIDSCAN_MARKER" \
  /bin/bash "$RUNNER" > "$TMPD/midscan.out" 2>&1 || MIDSCAN_RC=$?
if [[ $MIDSCAN_RC -eq 3 && ! -s "$MIDSCAN_CURL_LOG" ]]; then
  pass "扫描过程中 checkout revision 改变时拒绝 rebuild"
else
  fail "扫描中 revision 漂移仍发布 projection(rc=$MIDSCAN_RC)"
fi

mkdir -p "$TMPD/repo-a" "$TMPD/repo-b"
MULTI_REPO_LOG="$TMPD/multi-repo.log"
MULTI_REPO_SCAN_LOG="$TMPD/multi-repo-scans.log"
MULTI_REPO_RC=0
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" SKIP_GIT_PULL=1 \
  SCAN_LOG="$MULTI_REPO_SCAN_LOG" ENV_LOG="$MULTI_REPO_LOG" \
  SCAN_REPO_SPECS="repo-a|$TMPD/repo-a|postgresql://source/a;repo-b|$TMPD/repo-b|postgresql://source/b" \
  /bin/bash "$RUNNER" >/dev/null 2>&1 || MULTI_REPO_RC=$?
if [[ $MULTI_REPO_RC -eq 0 ]] \
  && [[ "$(wc -l < "$MULTI_REPO_LOG" | tr -d ' ')" == '8' ]] \
  && grep -q "repo-a|$TMPD/repo-a|postgresql://source/a|repo-a" "$MULTI_REPO_LOG" \
  && grep -q "repo-b|$TMPD/repo-b|postgresql://source/b|repo-b" "$MULTI_REPO_LOG"; then
  pass "SCAN_REPO_SPECS 为每个仓库向四 scanner 注入独立 repo/root/source DB"
else
  fail "SCAN_REPO_SPECS 多仓扫描合同失败(rc=$MULTI_REPO_RC)"
fi

TARGET_DRIFT_MARKER="$TMPD/target-head-changed"
TARGET_DRIFT_CURL_LOG="$TMPD/target-drift-curl.log"
TARGET_DRIFT_RC=0
env -i PATH="$CONTROL_BIN" NODE_BIN="$NODE_STUB" SKIP_GIT_PULL=1 \
  SCAN_LOG="$TMPD/target-drift-scans.log" CURL_LOG="$TARGET_DRIFT_CURL_LOG" \
  TARGET_HEAD_CHANGE_MARKER="$TARGET_DRIFT_MARKER" \
  SCAN_REPO_SPECS="repo-a|$TMPD/repo-a|postgresql://source/a" \
  /bin/bash "$RUNNER" > "$TMPD/target-drift.out" 2>&1 || TARGET_DRIFT_RC=$?
if [[ $TARGET_DRIFT_RC -eq 3 && ! -s "$TARGET_DRIFT_CURL_LOG" ]]; then
  pass "目标 repo 扫描中 revision 漂移时拒绝 rebuild"
else
  fail "目标 repo revision 漂移仍发布 projection(rc=$TARGET_DRIFT_RC)"
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
