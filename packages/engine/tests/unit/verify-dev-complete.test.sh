#!/usr/bin/env bash
# verify-dev-complete.test.sh — verify_dev_complete 函数 unit test

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

make_gh_stub() {
    local stub_dir="$1" script="$2"
    mkdir -p "$stub_dir"
    cat > "$stub_dir/gh" <<EOF
#!/usr/bin/env bash
$script
EOF
    chmod +x "$stub_dir/gh"
    export PATH="$stub_dir:$PATH"
}

ORIG_PATH="$PATH"
restore_path() { export PATH="$ORIG_PATH"; }

assert_status() {
    local label="$1" expected="$2" got="$3"
    if [[ "$got" == "$expected" ]]; then
        echo "✅ $label: status=$got"
        PASS=$((PASS+1))
    else
        echo "❌ $label: status=$got (期望 $expected)"
        FAIL=$((FAIL+1))
    fi
}

assert_contains() {
    local label="$1" needle="$2" haystack="$3"
    if [[ "$haystack" == *"$needle"* ]]; then
        echo "✅ $label"
        PASS=$((PASS+1))
    else
        echo "❌ $label: 缺 [$needle]"
        FAIL=$((FAIL+1))
    fi
}

setup_repo() {
    local prefix="$1"
    local main_repo="$TMPROOT/$prefix-main"
    local worktree="$TMPROOT/$prefix-wt"
    mkdir -p "$main_repo" "$worktree"
    echo "$main_repo|$worktree"
}

# Case 1: branch 缺参数
restore_path
result=$(verify_dev_complete "" "/tmp/wt" "/tmp/main")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 1 缺 branch" "blocked" "$status"
assert_contains "Case 1 reason 含缺参数" "缺参数" "$result"

# Case 2: gh CLI 不可用
NO_GH_DIR="$TMPROOT/no-gh"
mkdir -p "$NO_GH_DIR"
PATH="$NO_GH_DIR:/usr/bin:/bin" result=$(verify_dev_complete "cp-test" "/tmp/wt" "/tmp/main")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 2 gh 不可用" "blocked" "$status"
assert_contains "Case 2 reason 含 gh CLI" "gh CLI" "$result"

# Case 3: PR 未创建
restore_path
IFS='|' read -r MAIN3 WT3 <<< "$(setup_repo case3)"
make_gh_stub "$TMPROOT/case3-gh" 'echo ""; exit 0'
result=$(verify_dev_complete "cp-test" "$WT3" "$MAIN3")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 3 PR 未创建" "blocked" "$status"
assert_contains "Case 3 reason 含 PR 未创建" "PR 未创建" "$result"
restore_path

# Case 4: PR + CI in_progress
IFS='|' read -r MAIN4 WT4 <<< "$(setup_repo case4)"
make_gh_stub "$TMPROOT/case4-gh" '
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "" ;;
    "run list") echo "in_progress" ;;
esac
exit 0
'
result=$(verify_dev_complete "cp-test" "$WT4" "$MAIN4")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 4 CI in_progress" "blocked" "$status"
assert_contains "Case 4 reason 含 CI 进行中" "CI 进行中" "$result"
restore_path

# Case 5: PR + CI completed but not merged
IFS='|' read -r MAIN5 WT5 <<< "$(setup_repo case5)"
make_gh_stub "$TMPROOT/case5-gh" '
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "" ;;
    "run list") echo "completed" ;;
esac
exit 0
'
result=$(verify_dev_complete "cp-test" "$WT5" "$MAIN5")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 5 CI completed not merged" "blocked" "$status"
assert_contains "Case 5 reason 含 auto-merge" "auto-merge" "$result"
restore_path

# Case 6: PR merged + Learning 不存在
IFS='|' read -r MAIN6 WT6 <<< "$(setup_repo case6)"
make_gh_stub "$TMPROOT/case6-gh" '
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "2026-05-04T00:00:00Z" ;;
esac
exit 0
'
result=$(verify_dev_complete "cp-test" "$WT6" "$MAIN6")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 6 Learning 不存在" "blocked" "$status"
assert_contains "Case 6 reason 含 Learning 文件不存在" "Learning 文件不存在" "$result"
restore_path

# Case 7: PR merged + Learning 缺根本原因段
IFS='|' read -r MAIN7 WT7 <<< "$(setup_repo case7)"
mkdir -p "$MAIN7/docs/learnings"
echo "# 空 Learning" > "$MAIN7/docs/learnings/cp-test.md"
make_gh_stub "$TMPROOT/case7-gh" '
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "2026-05-04T00:00:00Z" ;;
esac
exit 0
'
result=$(verify_dev_complete "cp-test" "$WT7" "$MAIN7")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 7 Learning 缺必备段" "blocked" "$status"
assert_contains "Case 7 reason 含缺必备段" "缺必备段" "$result"
restore_path

# Case 8: PR merged + Learning OK + 无 cleanup.sh
IFS='|' read -r MAIN8 WT8 <<< "$(setup_repo case8)"
mkdir -p "$MAIN8/docs/learnings"
printf '# Learning\n### 根本原因\nfoo\n' > "$MAIN8/docs/learnings/cp-test.md"
make_gh_stub "$TMPROOT/case8-gh" '
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "2026-05-04T00:00:00Z" ;;
esac
exit 0
'
HOME="/nonexistent-home" result=$(verify_dev_complete "cp-test" "$WT8" "$MAIN8")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 8 无 cleanup.sh" "blocked" "$status"
assert_contains "Case 8 reason 含未找到 cleanup.sh" "未找到 cleanup.sh" "$result"
restore_path

# Case 9: PR merged + Learning + cleanup fail
IFS='|' read -r MAIN9 WT9 <<< "$(setup_repo case9)"
mkdir -p "$MAIN9/docs/learnings" "$MAIN9/packages/engine/skills/dev/scripts"
printf '# Learning\n### 根本原因\nfoo\n' > "$MAIN9/docs/learnings/cp-test.md"
echo '#!/usr/bin/env bash
exit 1' > "$MAIN9/packages/engine/skills/dev/scripts/cleanup.sh"
chmod +x "$MAIN9/packages/engine/skills/dev/scripts/cleanup.sh"
make_gh_stub "$TMPROOT/case9-gh" '
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "2026-05-04T00:00:00Z" ;;
esac
exit 0
'
result=$(verify_dev_complete "cp-test" "$WT9" "$MAIN9")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 9 cleanup fail" "blocked" "$status"
assert_contains "Case 9 reason 含 cleanup.sh 执行失败" "cleanup.sh 执行失败" "$result"
restore_path

# Case 10: HAPPY PATH
IFS='|' read -r MAIN10 WT10 <<< "$(setup_repo case10)"
mkdir -p "$MAIN10/docs/learnings" "$MAIN10/packages/engine/skills/dev/scripts"
printf '# Learning\n### 根本原因\nfoo\n' > "$MAIN10/docs/learnings/cp-test.md"
echo '#!/usr/bin/env bash
exit 0' > "$MAIN10/packages/engine/skills/dev/scripts/cleanup.sh"
chmod +x "$MAIN10/packages/engine/skills/dev/scripts/cleanup.sh"
make_gh_stub "$TMPROOT/case10-gh" '
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "2026-05-04T00:00:00Z" ;;
esac
exit 0
'
result=$(verify_dev_complete "cp-test" "$WT10" "$MAIN10")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 10 [HAPPY PATH]" "done" "$status"
assert_contains "Case 10 reason 含真完成" "真完成" "$result"
restore_path

# Case 11: harness 模式豁免
IFS='|' read -r MAIN11 WT11 <<< "$(setup_repo case11)"
mkdir -p "$WT11" "$MAIN11/packages/engine/skills/dev/scripts"
cat > "$WT11/.dev-mode.cp-test" <<EOF
dev
branch: cp-test
harness_mode: true
EOF
echo '#!/usr/bin/env bash
exit 0' > "$MAIN11/packages/engine/skills/dev/scripts/cleanup.sh"
chmod +x "$MAIN11/packages/engine/skills/dev/scripts/cleanup.sh"
make_gh_stub "$TMPROOT/case11-gh" '
case "$1 $2" in
    "pr list") echo "100" ;;
    "pr view") echo "2026-05-04T00:00:00Z" ;;
esac
exit 0
'
result=$(verify_dev_complete "cp-test" "$WT11" "$MAIN11")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 11 harness 豁免 Learning" "done" "$status"
restore_path

echo ""
echo "=== verify_dev_complete unit: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
