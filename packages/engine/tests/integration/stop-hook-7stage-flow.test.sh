#!/usr/bin/env bash
# stop-hook-7stage-flow.test.sh — 5 case mock gh+curl 验证 P1→P0 状态机
set -uo pipefail
THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"
LIB="$REPO_ROOT/packages/engine/lib/devloop-check.sh"
# shellcheck disable=SC1090
source "$LIB"

PASS=0; FAIL=0
TMPROOT=$(mktemp -d)
trap "rm -rf $TMPROOT" EXIT

expect_contains() {
    local label="$1" haystack="$2" needle="$3"
    if [[ "$haystack" == *"$needle"* ]]; then
        echo "✅ $label"; PASS=$((PASS+1))
    else
        echo "❌ $label: 缺 [$needle]，实际: $haystack"; FAIL=$((FAIL+1))
    fi
}

# === smart gh stub：解析 --json / --workflow / run id ===
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

STUB_DIR=$(mktemp -d)
make_smart_gh "$STUB_DIR"
make_curl_mock "$STUB_DIR"
ORIG_PATH="$PATH"
export PATH="$STUB_DIR:$PATH"

TMP_MAIN=$(mktemp -d)
mkdir -p "$TMP_MAIN/docs/learnings" "$TMP_MAIN/packages/engine/skills/dev/scripts"
echo -e "### 根本原因\nfoo\n### 下次预防\n- [ ] bar" > "$TMP_MAIN/docs/learnings/test-branch.md"
cat > "$TMP_MAIN/packages/engine/skills/dev/scripts/cleanup.sh" <<'CLN'
#!/usr/bin/env bash
exit 0
CLN
chmod +x "$TMP_MAIN/packages/engine/skills/dev/scripts/cleanup.sh"

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

# === Test 1: P1→P0 全过 done ===
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "completed" "success"
result=$(
    export HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 HEALTH_PROBE_MOCK=ok
    export VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=1
    verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN" 2>/dev/null
)
expect_contains "Test 1 P1→P0 全链路 done" "$result" '"status": "done"'

# === Test 2: P3 CI 失败 ===
set_stub "100" "" "" "completed" "failure" "1001" '[{"name":"brain-unit","conclusion":"failure","url":"https://x/job/1"}]' "" "" ""
result=$(VERIFY_DEPLOY_WORKFLOW=0 VERIFY_HEALTH_PROBE=0 verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN" 2>/dev/null)
expect_contains "Test 2 P3 CI failure 含 'CI 失败'" "$result" 'CI 失败'

# === Test 3: P5 deploy 进行中 ===
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "in_progress" ""
result=$(
    export HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 HEALTH_PROBE_MOCK=ok
    export VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=0
    verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN" 2>/dev/null
)
expect_contains "Test 3 P5 deploy 进行中 含 'brain-ci-deploy'" "$result" 'brain-ci-deploy'

# === Test 4: P6 health probe 超时 ===
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "completed" "success"
result=$(
    export HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 HEALTH_PROBE_MOCK=fail
    export VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=1
    verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN" 2>/dev/null
)
expect_contains "Test 4 P6 health 超时 含 'health probe'" "$result" 'health probe'

# === Test 5: P7 Learning 缺（disable health probe 让 P7 提前触发）===
rm "$TMP_MAIN/docs/learnings/test-branch.md"
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "completed" "success"
VERIFY_DEPLOY_WORKFLOW=0 VERIFY_HEALTH_PROBE=0 \
result=$(verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN" 2>/dev/null)
expect_contains "Test 5 P7 Learning 缺 含 'Learning 文件不存在'" "$result" 'Learning 文件不存在'

export PATH="$ORIG_PATH"
echo ""
echo "=== integration: $PASS PASS / $FAIL FAIL ==="
[[ $FAIL -eq 0 ]] || exit 1
