#!/usr/bin/env bash
# devloop-classify.test.sh — classify_session 8 分支 integration 测试
# 不依赖 vitest，纯 bash，便于在 CI lint job 直接跑。

set -uo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"
LIB="$REPO_ROOT/packages/engine/lib/devloop-check.sh"

# shellcheck disable=SC1090
source "$LIB"

PASS=0
FAIL=0
TMPROOT=$(mktemp -d)
trap 'rm -rf "$TMPROOT"' EXIT

assert_status() {
    local label="$1" expected="$2" got="$3"
    if [[ "$got" == "$expected" ]]; then
        echo "✅ $label: status=$got"
        PASS=$((PASS+1))
    else
        echo "❌ $label: status=$got (expected $expected)"
        FAIL=$((FAIL+1))
    fi
}

# Case 1: bypass env → not-dev
unset CECELIA_STOP_HOOK_BYPASS
CECELIA_STOP_HOOK_BYPASS=1 result=$(classify_session "$TMPROOT")
status=$(echo "$result" | jq -r '.status')
assert_status "bypass env" "not-dev" "$status"

# Case 2: cwd 不是目录 → not-dev（无 git 信号，不可能在 /dev 业务，fail-open OK）
unset CECELIA_STOP_HOOK_BYPASS
result=$(classify_session "/non/existent/path/zzz")
status=$(echo "$result" | jq -r '.status')
assert_status "cwd 不是目录" "not-dev" "$status"

# Case 3: cwd 是目录但不是 git repo → not-dev（无 git 信号 → 不可能有 .dev-mode）
NOT_GIT="$TMPROOT/not-git"
mkdir -p "$NOT_GIT"
result=$(classify_session "$NOT_GIT")
status=$(echo "$result" | jq -r '.status')
assert_status "非 git repo" "not-dev" "$status"

# Case 4: 主分支 → not-dev
MAIN_REPO="$TMPROOT/main-repo"
mkdir -p "$MAIN_REPO"
( cd "$MAIN_REPO" && git init -q -b main && git commit -q --allow-empty -m init )
result=$(classify_session "$MAIN_REPO")
status=$(echo "$result" | jq -r '.status')
assert_status "主分支放行" "not-dev" "$status"

# Case 5: cp-* 分支但无 .dev-mode → not-dev
CP_REPO="$TMPROOT/cp-repo"
mkdir -p "$CP_REPO"
( cd "$CP_REPO" && git init -q -b main && git commit -q --allow-empty -m init && git checkout -q -b cp-test )
result=$(classify_session "$CP_REPO")
status=$(echo "$result" | jq -r '.status')
assert_status "cp-* 分支但无 .dev-mode" "not-dev" "$status"

# Case 6: cp-* 分支 + .dev-mode 格式异常（首行非 dev）→ blocked
BAD_REPO="$TMPROOT/bad-repo"
mkdir -p "$BAD_REPO"
( cd "$BAD_REPO" && git init -q -b main && git commit -q --allow-empty -m init && git checkout -q -b cp-bad )
echo "garbage" > "$BAD_REPO/.dev-mode.cp-bad"
result=$(classify_session "$BAD_REPO")
status=$(echo "$result" | jq -r '.status')
assert_status ".dev-mode 格式异常" "blocked" "$status"

# Case 7: cp-* 分支 + .dev-mode 合法但 step_1_spec 未完成 → blocked（透传 devloop_check）
DEV_REPO="$TMPROOT/dev-repo"
mkdir -p "$DEV_REPO"
( cd "$DEV_REPO" && git init -q -b main && git commit -q --allow-empty -m init && git checkout -q -b cp-dev )
cat > "$DEV_REPO/.dev-mode.cp-dev" <<EOF
dev
branch: cp-dev
step_1_spec: pending
step_2_code: pending
EOF
result=$(classify_session "$DEV_REPO")
status=$(echo "$result" | jq -r '.status')
assert_status "step_1_spec 未完成" "blocked" "$status"

# Case 8: cp-* 分支 + .dev-mode 含 cleanup_done: true → done（透传 devloop_check 条件 0.1）
CLEAN_REPO="$TMPROOT/clean-repo"
mkdir -p "$CLEAN_REPO"
( cd "$CLEAN_REPO" && git init -q -b main && git commit -q --allow-empty -m init && git checkout -q -b cp-clean )
cat > "$CLEAN_REPO/.dev-mode.cp-clean" <<EOF
dev
branch: cp-clean
cleanup_done: true
EOF
result=$(classify_session "$CLEAN_REPO")
status=$(echo "$result" | jq -r '.status')
assert_status "cleanup_done done 透传" "done" "$status"

echo ""
echo "=== Total: $((PASS+FAIL)) | PASS: $PASS | FAIL: $FAIL ==="
[[ "$FAIL" -eq 0 ]]
