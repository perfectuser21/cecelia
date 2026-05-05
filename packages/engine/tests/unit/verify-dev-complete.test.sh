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

# Case 2: gh CLI 不可用 — PATH 完全隔离（CI Linux /usr/bin/gh 存在）
# 软链 jq 到 NO_GH_DIR 让 PATH 仅含 NO_GH_DIR（无 gh，但有 jq）
NO_GH_DIR="$TMPROOT/no-gh"
mkdir -p "$NO_GH_DIR"
JQ_BIN=$(command -v jq 2>/dev/null || echo "/usr/bin/jq")
ln -sf "$JQ_BIN" "$NO_GH_DIR/jq"
PATH="$NO_GH_DIR" result=$(verify_dev_complete "cp-test" "/tmp/wt" "/tmp/main")
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

# ============================================================================
# Smart stub helpers (cp-0504230106) — 解析 --json/--workflow，覆盖 P3/P5/P6
# ============================================================================
make_smart_gh() {
    local stub_dir="$1"
    cat > "$stub_dir/gh" <<'STUB'
#!/usr/bin/env bash
json_field=""
workflow_filter=""
for ((i=1; i<=$#; i++)); do
    arg="${!i}"
    case "$arg" in
        --json)
            j=$((i+1))
            json_field="${!j}"
            ;;
        --workflow)
            j=$((i+1))
            workflow_filter="${!j}"
            ;;
    esac
done
cmd="$1 $2"
case "$cmd" in
    "pr list") cat "${STUB_PR_LIST:-/dev/null}" 2>/dev/null || echo "" ;;
    "pr view")
        case "$json_field" in
            mergedAt) cat "${STUB_PR_MERGED:-/dev/null}" 2>/dev/null || echo "" ;;
            mergeCommit) cat "${STUB_PR_MERGE_SHA:-/dev/null}" 2>/dev/null || echo "" ;;
            *) echo "" ;;
        esac
        ;;
    "run list")
        if [[ "$workflow_filter" == "brain-ci-deploy.yml" ]]; then
            cat "${STUB_DEPLOY_RUN:-/dev/null}" 2>/dev/null || echo ""
        else
            case "$json_field" in
                status) cat "${STUB_CI_STATUS:-/dev/null}" 2>/dev/null || echo "" ;;
                conclusion) cat "${STUB_CI_CONCLUSION:-/dev/null}" 2>/dev/null || echo "" ;;
                databaseId) cat "${STUB_CI_RUN_ID:-/dev/null}" 2>/dev/null || echo "" ;;
                *) echo "" ;;
            esac
        fi
        ;;
    "run view")
        case "$json_field" in
            jobs) cat "${STUB_RUN_JOBS:-/dev/null}" 2>/dev/null || echo "" ;;
            status) cat "${STUB_DEPLOY_STATUS:-/dev/null}" 2>/dev/null || echo "" ;;
            conclusion) cat "${STUB_DEPLOY_CONCLUSION:-/dev/null}" 2>/dev/null || echo "" ;;
            *) echo "" ;;
        esac
        ;;
    *) echo "" ;;
esac
exit 0
STUB
    chmod +x "$stub_dir/gh"
}

make_curl_mock() {
    local stub_dir="$1"
    cat > "$stub_dir/curl" <<'STUB'
#!/usr/bin/env bash
[[ "${HEALTH_PROBE_MOCK:-fail}" == "ok" ]] && echo '{"status":"ok"}' && exit 0
exit 22
STUB
    chmod +x "$stub_dir/curl"
}

set_stub() {
    [[ -n "${1:-}" ]] && export STUB_PR_LIST=$(mktemp) && echo "$1" > "$STUB_PR_LIST" || unset STUB_PR_LIST
    [[ -n "${2:-}" ]] && export STUB_PR_MERGED=$(mktemp) && echo "$2" > "$STUB_PR_MERGED" || unset STUB_PR_MERGED
    [[ -n "${3:-}" ]] && export STUB_PR_MERGE_SHA=$(mktemp) && echo "$3" > "$STUB_PR_MERGE_SHA" || unset STUB_PR_MERGE_SHA
    [[ -n "${4:-}" ]] && export STUB_CI_STATUS=$(mktemp) && echo "$4" > "$STUB_CI_STATUS" || unset STUB_CI_STATUS
    [[ -n "${5:-}" ]] && export STUB_CI_CONCLUSION=$(mktemp) && echo "$5" > "$STUB_CI_CONCLUSION" || unset STUB_CI_CONCLUSION
    [[ -n "${6:-}" ]] && export STUB_CI_RUN_ID=$(mktemp) && echo "$6" > "$STUB_CI_RUN_ID" || unset STUB_CI_RUN_ID
    [[ -n "${7:-}" ]] && export STUB_RUN_JOBS=$(mktemp) && echo "$7" > "$STUB_RUN_JOBS" || unset STUB_RUN_JOBS
    [[ -n "${8:-}" ]] && export STUB_DEPLOY_RUN=$(mktemp) && echo "$8" > "$STUB_DEPLOY_RUN" || unset STUB_DEPLOY_RUN
    [[ -n "${9:-}" ]] && export STUB_DEPLOY_STATUS=$(mktemp) && echo "$9" > "$STUB_DEPLOY_STATUS" || unset STUB_DEPLOY_STATUS
    [[ -n "${10:-}" ]] && export STUB_DEPLOY_CONCLUSION=$(mktemp) && echo "${10}" > "$STUB_DEPLOY_CONCLUSION" || unset STUB_DEPLOY_CONCLUSION
}

SMART_MAIN=$(mktemp -d)
mkdir -p "$SMART_MAIN/docs/learnings" "$SMART_MAIN/packages/engine/skills/dev/scripts"
echo -e "### 根本原因\nfoo" > "$SMART_MAIN/docs/learnings/cp-test.md"
cat > "$SMART_MAIN/packages/engine/skills/dev/scripts/cleanup.sh" <<'CLN'
#!/usr/bin/env bash
exit 0
CLN
chmod +x "$SMART_MAIN/packages/engine/skills/dev/scripts/cleanup.sh"

SMART_STUB=$(mktemp -d)
make_smart_gh "$SMART_STUB"
make_curl_mock "$SMART_STUB"

# === Case 22: P3 CI failure ===
restore_path
PATH="$SMART_STUB:$ORIG_PATH"
set_stub "100" "" "" "completed" "failure" "12345" '[{"name":"brain-unit (2)","conclusion":"failure","url":"https://x/job/1"}]' "" "" ""
result=$(export VERIFY_DEPLOY_WORKFLOW=0 VERIFY_HEALTH_PROBE=0; verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 22 P3 CI failure" "blocked" "$status"
assert_contains "Case 22 reason 含 'CI 失败'" "CI 失败" "$result"
restore_path

# === Case 23: P3 cancelled ===
PATH="$SMART_STUB:$ORIG_PATH"
set_stub "100" "" "" "completed" "cancelled" "12345" '[]' "" "" ""
result=$(export VERIFY_DEPLOY_WORKFLOW=0 VERIFY_HEALTH_PROBE=0; verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 23 P3 cancelled" "blocked" "$status"
assert_contains "Case 23 reason 含 'CI 失败'" "CI 失败" "$result"
restore_path

# === Case 24: P5 deploy in_progress ===
PATH="$SMART_STUB:$ORIG_PATH"
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "in_progress" ""
result=$(export VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=0; verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 24 P5 deploy 进行中" "blocked" "$status"
assert_contains "Case 24 reason 含 'brain-ci-deploy'" "brain-ci-deploy" "$result"
restore_path

# === Case 25: P5 deploy failure ===
PATH="$SMART_STUB:$ORIG_PATH"
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "completed" "failure"
result=$(export VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=0; verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 25 P5 deploy failure" "blocked" "$status"
assert_contains "Case 25 reason 含 'deploy 失败'" "deploy 失败" "$result"
restore_path

# === Case 26 (P5 SHA 未匹配): 跳过 — stub 不支持 gh -q jq filter，由 integration test
# 通过 mock_smart_gh + 真 jq 处理覆盖（stop-hook-7stage-flow.test.sh）

# === Case 27: P6 health probe 超时 ===
PATH="$SMART_STUB:$ORIG_PATH"
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "completed" "success"
result=$(
    export HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 HEALTH_PROBE_MOCK=fail
    export VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=1
    verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN"
)
status=$(echo "$result" | jq -r '.status')
assert_status "Case 27 P6 health 超时" "blocked" "$status"
assert_contains "Case 27 reason 含 'health probe'" "health probe" "$result"
restore_path

# === Case 28: 全过 done ===
PATH="$SMART_STUB:$ORIG_PATH"
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "completed" "success"
result=$(
    export HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 HEALTH_PROBE_MOCK=ok
    export VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=1
    verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN"
)
status=$(echo "$result" | jq -r '.status')
assert_status "Case 28 全过 done" "done" "$status"
restore_path

echo ""
echo "=== verify_dev_complete unit: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
