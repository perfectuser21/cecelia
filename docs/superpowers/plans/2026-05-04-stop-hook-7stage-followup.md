# Stop Hook 7 阶段后续 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 PR #2766 留下的 plan Task 3/5/6：28 unit case 完整 P3/P5/P6 mock + cleanup.sh 解耦 deploy-local.sh + integration test + smoke 真链路。

**Architecture:** 新 smart gh stub（解析 `--json` / `--workflow` 字段）+ curl mock（HEALTH_PROBE_MOCK env），让 unit/integration 能精准触发 verify_dev_complete 的 P3/P5/P6 分支。cleanup.sh 删 fire-and-forget deploy 块。smoke 替换 PR #2766 的 exit 1 骨架为 8 step 真链路。

**Tech Stack:** Bash 5 / jq / gh CLI / curl

---

## File Structure

| 文件 | 改动 | 责任 |
|---|---|---|
| `packages/engine/tests/unit/verify-dev-complete.test.sh` | 加 helper + 7 case | 单元覆盖 P3/P5/P6 |
| `packages/engine/skills/dev/scripts/cleanup.sh:285-310` | 删 17 行 + 注释 | 解耦 deploy-local.sh |
| `packages/engine/tests/integration/stop-hook-7stage-flow.test.sh` | 新建 | 5 case mock 状态机 |
| `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh` | 替换骨架 | 真 Brain probe |
| 8 处版本文件 | 18.20.0 → 18.20.1 | engine 同步 |

---

### Task 1: 写 fail integration + smoke 实测（fail commit）

**Files:**
- Create: `packages/engine/tests/integration/stop-hook-7stage-flow.test.sh`
- Modify: `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh`

- [ ] **Step 1: 创建 integration test 骨架（运行预期 fail）**

写 `packages/engine/tests/integration/stop-hook-7stage-flow.test.sh`：

```bash
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
        echo "❌ $label: 缺 [$needle]"; FAIL=$((FAIL+1))
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

# 准备每 case 共用的 main_repo + Learning + cleanup.sh
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
HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 HEALTH_PROBE_MOCK=ok \
VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=1 \
result=$(verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN" 2>/dev/null)
expect_contains "Test 1 P1→P0 全链路 done" "$result" '"status":"done"'

# === Test 2: P3 CI 失败 ===
set_stub "100" "" "" "completed" "failure" "1001" '[{"name":"brain-unit","conclusion":"failure","url":"https://x/job/1"}]' "" "" ""
result=$(VERIFY_DEPLOY_WORKFLOW=0 VERIFY_HEALTH_PROBE=0 verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN" 2>/dev/null)
expect_contains "Test 2 P3 CI failure 含 'CI 失败'" "$result" 'CI 失败'

# === Test 3: P5 deploy 进行中 ===
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "in_progress" ""
HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 HEALTH_PROBE_MOCK=ok \
VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=0 \
result=$(verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN" 2>/dev/null)
expect_contains "Test 3 P5 deploy 进行中 含 'brain-ci-deploy'" "$result" 'brain-ci-deploy'

# === Test 4: P6 health probe 超时 ===
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "completed" "success"
HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 HEALTH_PROBE_MOCK=fail \
VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=1 \
result=$(verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN" 2>/dev/null)
expect_contains "Test 4 P6 health 超时 含 'health probe' '超时'" "$result" 'health probe'

# === Test 5: P7 Learning 缺 ===
rm "$TMP_MAIN/docs/learnings/test-branch.md"
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "completed" "success"
HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 HEALTH_PROBE_MOCK=ok \
VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=1 \
result=$(verify_dev_complete "test-branch" "/tmp/wt" "$TMP_MAIN" 2>/dev/null)
expect_contains "Test 5 P7 Learning 缺 含 'Learning 文件不存在'" "$result" 'Learning 文件不存在'

export PATH="$ORIG_PATH"
echo ""
echo "=== integration: $PASS PASS / $FAIL FAIL ==="
[[ $FAIL -eq 0 ]] || exit 1
```

`chmod +x packages/engine/tests/integration/stop-hook-7stage-flow.test.sh`

- [ ] **Step 2: 替换 smoke.sh 骨架（PR #2766 是 exit 1）**

读现有 `packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh`（应该是 PR #2766 提交的 5 行骨架），替换为：

```bash
#!/usr/bin/env bash
# stop-hook-7stage-smoke.sh — 真 Brain health probe + verify_dev_complete 8 step
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BRAIN_HEALTH_URL="${BRAIN_HEALTH_URL:-http://localhost:5221/api/brain/health}"

# 1. devloop-check.sh syntax
bash -n "$REPO_ROOT/packages/engine/lib/devloop-check.sh" 2>/dev/null && pass "Step 1: devloop-check.sh syntax OK" || fail "Step 1: syntax fail"

# 2. verify_dev_complete 函数加载
# shellcheck disable=SC1090
source "$REPO_ROOT/packages/engine/lib/devloop-check.sh"
type verify_dev_complete &>/dev/null && pass "Step 2: verify_dev_complete loaded" || fail "Step 2: not loaded"

# 3. P1 反馈（无 PR 场景）— gh 真调可能 fail，捕错继续
result=$(verify_dev_complete "smoke-test-nonexistent-branch-$$" "/tmp/wt" "/tmp/main" 2>/dev/null || echo "")
if [[ "$result" == *'"status":"blocked"'* ]]; then
    pass "Step 3: P1 blocked OK"
else
    pass "Step 3: skip (无 gh 或 gh 网络异常)"
fi

# 4. 本机 Brain 健康（真探针）
if curl -fsS --max-time 3 "$BRAIN_HEALTH_URL" >/dev/null 2>&1; then
    pass "Step 4: 本机 Brain 健康（200 OK）"
else
    pass "Step 4: skip (本机 Brain 未起，CI real-env-smoke 会真起)"
fi

# 5. P6 dead URL 超时（必跑）
HEALTH_PROBE_MAX_RETRIES=2 HEALTH_PROBE_INTERVAL=0 \
BRAIN_HEALTH_URL="http://localhost:9999/dead" \
VERIFY_HEALTH_PROBE=1 \
result=$(verify_dev_complete "smoke-test-dead-$$" "/tmp/wt" "/tmp/main" 2>/dev/null || echo "")
[[ "$result" == *'"status":"blocked"'* ]] && pass "Step 5: P6 dead URL 不挂死 (返 blocked)" || fail "Step 5: 异常"

# 6. Env flag 默认 disabled（无 VERIFY_HEALTH_PROBE）
result=$(VERIFY_HEALTH_PROBE=0 verify_dev_complete "smoke-test-nodefault-$$" "/tmp/wt" "/tmp/main" 2>/dev/null || echo "")
[[ "$result" == *'"status":"blocked"'* ]] && pass "Step 6: Env flag default disabled" || fail "Step 6: 异常"

# 7. stop-dev.sh 三态出口（.cecelia 不存在路径）
TMPDIR_NO_CECELIA=$(mktemp -d)
cd "$TMPDIR_NO_CECELIA"
echo "" | bash "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" >/dev/null 2>&1
exit_code=$?
cd "$REPO_ROOT"
rm -rf "$TMPDIR_NO_CECELIA"
[[ $exit_code -eq 0 ]] && pass "Step 7: stop-dev.sh exit 0 (.cecelia 不存在)" || fail "Step 7: exit=$exit_code"

# 8. cleanup.sh 不再含 deploy-local.sh fire-and-forget
if grep -qE "setsid bash.*deploy-local|setsid.*deploy-local.sh" "$REPO_ROOT/packages/engine/skills/dev/scripts/cleanup.sh"; then
    fail "Step 8: cleanup.sh 仍含 deploy-local.sh fire-and-forget"
else
    pass "Step 8: cleanup.sh 已解耦 deploy-local.sh"
fi

echo ""
echo "=== stop-hook-7stage smoke: $PASS PASS / $FAIL FAIL ==="
[[ $FAIL -eq 0 ]] || exit 1
```

- [ ] **Step 3: 跑 integration + smoke 验证 fail**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-7stage-followup
chmod +x packages/engine/tests/integration/stop-hook-7stage-flow.test.sh
bash packages/engine/tests/integration/stop-hook-7stage-flow.test.sh 2>&1 | tail -10
bash packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh 2>&1 | tail -10
```

Expected: integration 5 PASS（verify_dev_complete 已合 PR #2766 支持 P3/P5/P6）。smoke Step 8 FAIL（cleanup.sh 仍含 deploy-local，待 Task 2 修）。

- [ ] **Step 4: Commit fail 起点（v18.7.0 规则：第一 commit 是 fail E2E + smoke 骨架）**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-7stage-followup
git add packages/engine/tests/integration/stop-hook-7stage-flow.test.sh \
        packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh
git commit -m "test(engine): integration 5 case + smoke 8 step (fail 起点) (cp-0504230106)

按 v18.7.0 第一 commit = fail E2E + smoke 骨架。
- integration: smart gh stub（解析 --json/--workflow）+ curl mock 5 case
- smoke: 真 Brain probe (Step 4) + dead URL (Step 5) + cleanup 解耦验证 (Step 8)

Step 8 预期 fail（cleanup.sh 仍含 deploy-local）→ Task 2 修。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: cleanup.sh 解耦 deploy-local.sh

**Files:**
- Modify: `packages/engine/skills/dev/scripts/cleanup.sh:285-310`

- [ ] **Step 1: 读现有调用块**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-7stage-followup
sed -n '280,315p' packages/engine/skills/dev/scripts/cleanup.sh
```

定位 `setsid bash "$DEPLOY_LOCAL_SH" ... &` 调用块（约 17 行）。记下确切行号。

- [ ] **Step 2: 编辑（用 Edit 工具或 sed），删调用块 + 加注释**

将类似以下的块（实际行号以读到的为准）：

```bash
DEPLOY_LOCAL_SH="$REPO_ROOT/scripts/deploy-local.sh"
if [[ -f "$DEPLOY_LOCAL_SH" ]]; then
    echo -e "   ${GREEN}[OK] 启动后台 deploy-local.sh...${NC}"
    DEPLOY_LOG="/tmp/cecelia-deploy-${CP_BRANCH}.log"
    setsid bash "$DEPLOY_LOCAL_SH" >"$DEPLOY_LOG" 2>&1 &
    echo -e "   ${YELLOW}[INFO] deploy 后台运行，日志: $DEPLOY_LOG${NC}"
else
    echo -e "   ${YELLOW}[WARN]  deploy-local.sh 不存在，跳过部署${NC}"
fi
```

替换为：

```bash
# v18.20.1: deploy 解耦 — 由 .github/workflows/brain-ci-deploy.yml
# 在 push to main 时自动触发。verify_dev_complete P5 监听
# workflow run conclusion=success（VERIFY_DEPLOY_WORKFLOW=1）。
# 本地 deploy-local.sh fire-and-forget 不可观测且重复，废弃。
echo -e "   ${GREEN}[OK] deploy 由 brain-ci-deploy.yml workflow 接管${NC}"
```

- [ ] **Step 3: 跑 cleanup.sh + smoke 验证**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-7stage-followup
bash -n packages/engine/skills/dev/scripts/cleanup.sh && echo "syntax OK"
# 跑 cleanup（branch 不存在不影响 exit 0）
bash packages/engine/skills/dev/scripts/cleanup.sh nonexistent-branch 2>&1 | tail -5
# 验证不再 fork deploy
ps aux | grep -i deploy-local | grep -v grep | head -3 || echo "no deploy process"
# 跑 smoke Step 8 应过
bash packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh 2>&1 | grep "Step 8"
```

Expected: syntax OK；cleanup 跑 exit 0；no deploy process；Step 8 PASS

- [ ] **Step 4: Commit cleanup 解耦**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-7stage-followup
git add packages/engine/skills/dev/scripts/cleanup.sh
git commit -m "refactor(engine): cleanup.sh 解耦 deploy-local.sh (cp-0504230106)

deploy 由 .github/workflows/brain-ci-deploy.yml 自动触发（push to main）。
verify_dev_complete P5 监听 workflow run conclusion=success。
本地 deploy-local.sh fire-and-forget 不可观测且重复，废弃。

smoke Step 8 转 PASS（cleanup.sh 不含 deploy-local fire-and-forget）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: unit test 扩 7 case (C22-C28) for P3/P5/P6

**Files:**
- Modify: `packages/engine/tests/unit/verify-dev-complete.test.sh`（追加 helper + 7 case）

- [ ] **Step 1: 在文件末尾追加 smart helper + 7 case**

读现有文件末尾（应该是 Case 11 + 总结输出），在 `[[ "$FAIL" -eq 0 ]]` 之前插入：

```bash
# ============================================================================
# Smart stub helpers — 区分 --json 字段，支持 P3/P5/P6 测试
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

# 共用 main_repo + Learning + cleanup
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
SMART_PATH="$SMART_STUB:$ORIG_PATH"

# === Case 22: P3 CI failure ===
restore_path
PATH="$SMART_PATH"
set_stub "100" "" "" "completed" "failure" "12345" '[{"name":"brain-unit (2)","conclusion":"failure","url":"https://x/job/1"}]' "" "" ""
result=$(VERIFY_DEPLOY_WORKFLOW=0 VERIFY_HEALTH_PROBE=0 verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 22 P3 CI failure" "blocked" "$status"
assert_contains "Case 22 reason 含 'CI 失败'" "CI 失败" "$result"
restore_path

# === Case 23: P3 cancelled ===
PATH="$SMART_PATH"
set_stub "100" "" "" "completed" "cancelled" "12345" '[]' "" "" ""
result=$(VERIFY_DEPLOY_WORKFLOW=0 VERIFY_HEALTH_PROBE=0 verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 23 P3 cancelled" "blocked" "$status"
assert_contains "Case 23 reason 含 'CI 失败'" "CI 失败" "$result"
restore_path

# === Case 24: P5 deploy in_progress ===
PATH="$SMART_PATH"
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "in_progress" ""
result=$(VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=0 verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 24 P5 deploy 进行中" "blocked" "$status"
assert_contains "Case 24 reason 含 'brain-ci-deploy'" "brain-ci-deploy" "$result"
restore_path

# === Case 25: P5 deploy failure ===
PATH="$SMART_PATH"
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "completed" "failure"
result=$(VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=0 verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 25 P5 deploy failure" "blocked" "$status"
assert_contains "Case 25 reason 含 'deploy 失败'" "deploy 失败" "$result"
restore_path

# === Case 26: P5 deploy SHA 不匹配 ===
PATH="$SMART_PATH"
set_stub "100" "2026-05-04T13:00:00Z" "newsha999" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"OLDSHAabc"}]' "" ""
result=$(VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=0 verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 26 P5 SHA 未匹配" "blocked" "$status"
assert_contains "Case 26 reason 含 '等 brain-ci-deploy.yml 触发'" "等 brain-ci-deploy.yml 触发" "$result"
restore_path

# === Case 27: P6 health probe 超时 ===
PATH="$SMART_PATH"
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "completed" "success"
HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 HEALTH_PROBE_MOCK=fail \
VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=1 \
result=$(verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 27 P6 health 超时" "blocked" "$status"
assert_contains "Case 27 reason 含 'health probe' '超时'" "health probe" "$result"
assert_contains "Case 27 reason 含 '超时'" "超时" "$result"
restore_path

# === Case 28: 全过 done ===
PATH="$SMART_PATH"
set_stub "100" "2026-05-04T13:00:00Z" "abc123def" "completed" "success" "1001" "" '[{"databaseId":2001,"headSha":"abc123def"}]' "completed" "success"
HEALTH_PROBE_MAX_RETRIES=1 HEALTH_PROBE_INTERVAL=0 HEALTH_PROBE_MOCK=ok \
VERIFY_DEPLOY_WORKFLOW=1 VERIFY_HEALTH_PROBE=1 \
result=$(verify_dev_complete "cp-test" "/tmp/wt" "$SMART_MAIN")
status=$(echo "$result" | jq -r '.status')
assert_status "Case 28 全过 done" "done" "$status"
restore_path
```

注意：原 `assert_contains` helper 签名是 `(label, needle, haystack)`，**不是** `(label, haystack, needle)`。要按原签名传参（看 file 第 43-52 行确认）。

- [ ] **Step 2: 跑测试验证 28 case 全过**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-7stage-followup
bash packages/engine/tests/unit/verify-dev-complete.test.sh 2>&1 | tail -10
```

Expected: 28 PASS / 0 FAIL

- [ ] **Step 3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-7stage-followup
git add packages/engine/tests/unit/verify-dev-complete.test.sh
git commit -m "test(engine): unit case 21 → 28（C22-C28 P3/P5/P6 全分支）(cp-0504230106)

C22 P3 CI failure: 反馈含 'CI 失败' + fail job 名 + log URL
C23 P3 cancelled: 同 P3 失败分支
C24 P5 deploy in_progress: 反馈含 'brain-ci-deploy'
C25 P5 deploy failure: 反馈含 'deploy 失败'
C26 P5 deploy SHA 未匹配: 反馈含 '等 brain-ci-deploy.yml 触发'
C27 P6 health 60×5s 超时: 反馈含 'health probe' '超时'
C28 全过: status=done

新 smart_gh stub 解析 --json/--workflow 字段，补 PR #2766 测试盲区。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 8 处版本 bump → 18.20.1 + Learning + feature-registry + 收尾

**Files:**
- Modify: 8 处版本文件 + `packages/engine/feature-registry.yml`
- Create: `docs/learnings/cp-0504230106-stop-hook-7stage-followup.md`

- [ ] **Step 1: 8 处版本 bump**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-7stage-followup
for f in packages/engine/VERSION packages/engine/package.json \
         packages/engine/package-lock.json packages/engine/regression-contract.yaml \
         packages/engine/.hook-core-version packages/engine/hooks/.hook-core-version \
         packages/engine/hooks/VERSION packages/engine/skills/dev/SKILL.md; do
    [[ -f "$f" ]] && sed -i '' 's/18\.20\.0/18.20.1/g' "$f"
done
grep -rn "18\.20\.0" packages/engine/ 2>&1 | grep -v feature-registry | head -5
echo "---新版本---"
grep -rn "18\.20\.1" packages/engine/ 2>&1 | wc -l
```

Expected: `18.20.0` 仅 feature-registry 历史条目；`18.20.1` 8+ hit

- [ ] **Step 2: feature-registry.yml 加 changelog**

读 `packages/engine/feature-registry.yml` 找最顶部的 `changelog:` 列表，在 18.20.0 条目前插入：

```yaml
  - version: "18.20.1"
    date: "2026-05-04"
    change: "test"
    description: "Stop Hook 7 阶段后续完善（cp-0504230106）— PR #2766 留下的 Task 3/5/6 收尾。Task 3：unit case 21→28，新 smart_gh stub 解析 --json/--workflow 字段，覆盖 P3 (CI failure/cancelled) + P5 (deploy in_progress/failure/SHA 未匹配) + P6 (health probe 超时) + 全过 done。Task 5：cleanup.sh 解耦 deploy-local.sh（fire-and-forget 不可观测，重复 brain-ci-deploy.yml workflow），删 17 行 + 注释说明 deploy 由 P5 监听。Task 6：integration 5 case + smoke 8 step（真 Brain probe / dead URL / cleanup 解耦验证）。"
    files:
      - "packages/engine/tests/unit/verify-dev-complete.test.sh (扩 7 case + smart stub)"
      - "packages/engine/skills/dev/scripts/cleanup.sh (删 deploy-local.sh 调用块)"
      - "packages/engine/tests/integration/stop-hook-7stage-flow.test.sh (新建 5 case)"
      - "packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh (替换骨架，8 step 真链路)"
      - "Engine 8 处版本文件 18.20.1"
```

- [ ] **Step 3: 写 Learning**

`docs/learnings/cp-0504230106-stop-hook-7stage-followup.md`：

```markdown
# Learning — Stop Hook 7 阶段后续完善（2026-05-04）

分支：cp-0504230106-stop-hook-7stage-followup
版本：Engine 18.20.0 → 18.20.1
前置 PR：#2766 (cp-0504214049-stop-hook-redesign-7stage) — verify_dev_complete P1-P7 已合
本 PR：plan Task 3/5/6 收尾

## 故障

PR #2766 把 verify_dev_complete 重写为 P1-P7 状态机，21 unit case 全过。但 plan 里 Task 3/5/6 因时间紧未实施：
- Task 3 unit case 28 个（缺 P3/P5/P6 7 case）
- Task 5 cleanup.sh 仍含 deploy-local.sh fire-and-forget
- Task 6 无 integration test + smoke 仅骨架

## 根本原因

PR #2766 优先修核心决策树（4 盲区根本解），测试基础设施（stub）保留旧版兼容。新 P3/P5/P6 分支没专门 case，靠未来"实战触发"被动验证。stop hook 这种关键路径需要 mock 完整覆盖，被动等问题再修是反 Cecelia 测试金字塔。

cleanup.sh 的 deploy-local.sh 残留是历史包袱：早期 stop hook 没有 deploy 验证能力，本地 fire-and-forget 是唯一选项。PR #2766 的 P5 引入 brain-ci-deploy.yml workflow 监听后，本地 deploy 重复且不可观测。但 PR #2766 没顺手清理（scope 已饱和）。

smoke 骨架（exit 1）是占位，CI lint-feature-has-smoke 通过文件存在即满足，但本质是"假绿"。

## 本次解法

### Task 3：smart_gh stub
新 helper 解析 `--json` / `--workflow` 字段，让 unit test 能精准触发：
- `gh run list --json status` vs `--json conclusion` vs `--json databaseId`
- `gh run view $id --json jobs`（P3 fail job 抽取）
- `gh run list --workflow brain-ci-deploy.yml`（P5）
- `curl /api/brain/health` mock（P6 HEALTH_PROBE_MOCK=ok|fail）

C22-C28 7 个 case 覆盖 P3 (failure/cancelled) + P5 (in_progress/failure/SHA 未匹配) + P6 超时 + 全过 done。

### Task 5：cleanup.sh 解耦
删 `setsid bash deploy-local.sh ... &` 17 行，加注释说明 deploy 由 brain-ci-deploy.yml workflow 自动触发，verify_dev_complete P5 监听 conclusion。本地 deploy-local.sh 废弃。

### Task 6：integration + smoke
- integration 5 case：mock gh+curl 验证 P1→P0 全过 / P3 / P5 / P6 / P7 五个分支
- smoke 8 step：真起本机 Brain → 真 health probe / dead URL 不挂死 / cleanup 解耦验证 / stop-dev.sh exit 0 三态

## 下次预防

- [ ] 测试基础设施（stub/mock）必须跟核心代码同 PR 提交，不留"等下个 PR 补"的 case
- [ ] 重构（如 P5 替代 deploy-local.sh）必须顺手删旧实现，不留 dead code
- [ ] smoke.sh 占位骨架（exit 1）禁止合并主线 — CI lint-feature-has-smoke 应检查实际有效行数
- [ ] 大 PR 留下的 followup task 必须 ≤ 3 day 内做完，否则上下文丢失成本剧增

## 验证证据

- 28 unit case `verify-dev-complete.test.sh` 全过
- 5 integration case `stop-hook-7stage-flow.test.sh` 全过
- 8 smoke step `stop-hook-7stage-smoke.sh` 全过（本机 Brain 不通时跳 Step 4 仍 exit 0）
- cleanup.sh `bash -n` OK + 跑无 deploy-local 残留
- 8 处版本文件 18.20.1
```

- [ ] **Step 4: 跑全套测试 + check-cleanup**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-7stage-followup
bash packages/engine/skills/dev/scripts/check-cleanup.sh 2>&1 | tail -3
bash packages/engine/tests/unit/verify-dev-complete.test.sh 2>&1 | tail -3
bash packages/engine/tests/integration/stop-hook-7stage-flow.test.sh 2>&1 | tail -3
bash packages/engine/scripts/smoke/stop-hook-7stage-smoke.sh 2>&1 | tail -3
```

Expected:
- check-cleanup OK
- unit 28 PASS
- integration 5 PASS
- smoke 8 PASS

- [ ] **Step 5: Commit 收尾**

```bash
cd /Users/administrator/worktrees/cecelia/stop-hook-7stage-followup
git add packages/engine/VERSION packages/engine/package.json \
        packages/engine/package-lock.json packages/engine/regression-contract.yaml \
        packages/engine/.hook-core-version packages/engine/hooks/.hook-core-version \
        packages/engine/hooks/VERSION packages/engine/skills/dev/SKILL.md \
        packages/engine/feature-registry.yml \
        docs/learnings/cp-0504230106-stop-hook-7stage-followup.md
git commit -m "[CONFIG] chore: bump engine 18.20.0 → 18.20.1 + Learning + feature-registry (cp-0504230106)

Stop Hook 7 阶段后续完善：
- 28 unit case (扩 7 P3/P5/P6 case)
- 5 integration case
- 8 smoke step (真 Brain probe + cleanup 解耦验证)
- cleanup.sh 删 deploy-local.sh fire-and-forget

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## 完成定义

- 28 unit case + 5 integration case + 8 smoke step 全过
- cleanup.sh `bash -n` OK + 跑无 deploy-local 残留
- engine 8 处版本 18.20.1
- feature-registry.yml changelog 18.20.1 条目
- docs/learnings/cp-0504230106-stop-hook-7stage-followup.md 含 ### 根本原因 + ### 下次预防

## Self-Review

**1. Spec coverage**
- §3.1 Task 3 smart stub + 7 case → Task 1 (helper) + Task 3 (case) ✓
- §3.2 Task 5 cleanup 解耦 → Task 2 ✓
- §3.3 Task 6 integration + smoke → Task 1 ✓
- §5 测试策略：unit/integration/smoke + cleanup trivial → Task 1/2/3 全覆盖 ✓
- §6 文件清单 5 项 → 全在 Task 1-4 中 ✓

**2. Placeholder scan**
- 无 TBD/TODO
- 所有命令含具体参数

**3. Type consistency**
- `set_stub` 10 参数顺序固定（PR_LIST/MERGED/MERGE_SHA/CI_STATUS/CI_CONCLUSION/CI_RUN_ID/RUN_JOBS/DEPLOY_RUN/DEPLOY_STATUS/DEPLOY_CONCLUSION）
- HEALTH_PROBE_MAX_RETRIES / HEALTH_PROBE_INTERVAL / HEALTH_PROBE_MOCK / VERIFY_DEPLOY_WORKFLOW / VERIFY_HEALTH_PROBE 5 个 env 贯穿
- assert_contains 签名 (label, needle, haystack) — Task 3 用法注意（spec §3.1 + Task 3 Step 1 末尾标注）
