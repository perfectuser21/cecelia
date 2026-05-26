# Harness Pipeline Lifecycle Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 `harness-pipeline-lifecycle-smoke.sh`，验证 harness pipeline 在真实 Brain 上跑完整流程不卡死。

**Architecture:** 单一 bash 脚本，遵循现有 smoke 脚本模式（`log/fail/skip` helper + skip guard + 轮询）。POST 创建 `harness_initiative` 任务，每 60s 轮询 task status，`completed` 或 `failed` 均为 PASS，90 分钟超时为 FAIL。

**Tech Stack:** bash, curl, jq（可选）, Brain REST API

---

## 文件变更一览

| 文件 | 操作 |
|------|------|
| `packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh` | Create |
| `docs/learnings/cp-0518143337-harness-e2e-smoke.md` | Create |

---

### Task 1: 写 smoke 脚本并验证可运行

**Files:**
- Create: `packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh`

注：这是 bash 脚本，没有单独的"测试文件"。TDD 体现在：先写脚本骨架让 skip guard 跑通（commit-1），再写完整轮询逻辑（commit-2）。

- [ ] **Step 1: 创建脚本骨架（只有 skip guard，commit-1）**

创建 `/Users/administrator/worktrees/cecelia/harness-e2e-smoke/packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh`，内容：

```bash
#!/usr/bin/env bash
# harness-pipeline-lifecycle-smoke.sh
#
# 真实 E2E smoke：向 Brain 注册 harness_initiative 任务，等待其跑完整流程。
# completed 或 failed 均视为 PASS（验证"不卡死"，不要求代码一定写成功）。
#
# 环境变量：
#   BRAIN_URL       默认 http://localhost:5221
#   SPRINT_DIR      默认 sprints/w19-playground-sum
#   POLL_INTERVAL   默认 60（秒）
#   MAX_WAIT        默认 5400（秒 = 90 分钟）
#
# 退出码：0=PASS 或 SKIP，1=FAIL（卡死/超时/非预期终止）
set -uo pipefail

SMOKE_NAME="harness-pipeline-lifecycle"
log()  { echo "[smoke:$SMOKE_NAME] $*"; }
fail() { log "FAIL — $*"; exit 1; }
skip() { log "SKIP — $*"; exit 0; }

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
SPRINT_DIR="${SPRINT_DIR:-sprints/w19-playground-sum}"
POLL_INTERVAL="${POLL_INTERVAL:-60}"
MAX_WAIT="${MAX_WAIT:-5400}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# ── Skip guard ──────────────────────────────────────────────────────────────

command -v curl >/dev/null 2>&1 || skip "curl 未安装"

if ! curl -sf "${BRAIN_URL}/api/brain/health" -o /dev/null 2>&1; then
  skip "Brain ${BRAIN_URL} 不健康"
fi

PRD_PATH="${REPO_ROOT}/${SPRINT_DIR}/sprint-prd.md"
if [[ ! -f "$PRD_PATH" ]]; then
  skip "sprint PRD 不存在: ${PRD_PATH}"
fi

log "前置 OK — Brain 健康, PRD 存在"
log "（骨架 smoke 到此结束，完整轮询逻辑待实现）"
exit 0
```

- [ ] **Step 2: 加 execute 权限并运行骨架，确认 SKIP 或通过 skip guard**

```bash
chmod +x /Users/administrator/worktrees/cecelia/harness-e2e-smoke/packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh

bash /Users/administrator/worktrees/cecelia/harness-e2e-smoke/packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh
```

期望输出之一：
- `[smoke:harness-pipeline-lifecycle] 前置 OK — Brain 健康, PRD 存在` + exit 0（Brain 在跑）
- `[smoke:harness-pipeline-lifecycle] SKIP — Brain ... 不健康` + exit 0（Brain 没开）

无论哪种，exit code 必须为 0。

- [ ] **Step 3: Commit 骨架**

```bash
cd /Users/administrator/worktrees/cecelia/harness-e2e-smoke
git add packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh
git commit -m "feat(smoke): harness pipeline lifecycle smoke — 骨架 + skip guard"
```

- [ ] **Step 4: 实现完整轮询逻辑（覆盖骨架末尾，commit-2）**

把脚本中 `log "（骨架 smoke 到此结束...）"` 和末尾 `exit 0` 替换为以下完整实现：

```bash
# ── 创建 harness_initiative 任务 ─────────────────────────────────────────────

log "创建 harness_initiative 任务 (sprint_dir=${SPRINT_DIR})..."

TASK_JSON=$(curl -sf -X POST "${BRAIN_URL}/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{
    \"task_type\": \"harness_initiative\",
    \"title\": \"[smoke] harness-pipeline-lifecycle $(date +%Y%m%d-%H%M%S)\",
    \"payload\": {
      \"sprint_dir\": \"${SPRINT_DIR}\",
      \"smoke_test\": true
    }
  }" 2>/dev/null) || fail "POST /api/brain/tasks 失败"

# 提取 task id（兼容 jq 不存在的环境）
if command -v jq >/dev/null 2>&1; then
  TASK_ID=$(echo "$TASK_JSON" | jq -r '.id // empty')
else
  TASK_ID=$(echo "$TASK_JSON" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

[[ -z "$TASK_ID" || "$TASK_ID" == "null" ]] && fail "无法解析 task id，响应: ${TASK_JSON}"

log "任务已创建: task_id=${TASK_ID}"
log "开始轮询 (每 ${POLL_INTERVAL}s，最多 ${MAX_WAIT}s)..."

# ── 轮询 status ──────────────────────────────────────────────────────────────

START_TIME=$(date +%s)
CONSECUTIVE_ERRORS=0

while true; do
  ELAPSED=$(( $(date +%s) - START_TIME ))
  if (( ELAPSED >= MAX_WAIT )); then
    # 打印最后一次 status 供排查
    LAST_JSON=$(curl -sf "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null || echo '{}')
    if command -v jq >/dev/null 2>&1; then
      LAST_STATUS=$(echo "$LAST_JSON" | jq -r '.status // "unknown"')
    else
      LAST_STATUS=$(echo "$LAST_JSON" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
    fi
    fail "超时（${MAX_WAIT}s），pipeline 疑似卡死。最后 status=${LAST_STATUS}, task_id=${TASK_ID}"
  fi

  TASK_JSON=$(curl -sf "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null || echo "")
  if [[ -z "$TASK_JSON" ]]; then
    CONSECUTIVE_ERRORS=$(( CONSECUTIVE_ERRORS + 1 ))
    log "⚠ curl 失败 (${CONSECUTIVE_ERRORS}/5)，Brain 可能在重启..."
    if (( CONSECUTIVE_ERRORS >= 5 )); then
      fail "连续 5 次 curl 失败，Brain 已失联 (task_id=${TASK_ID})"
    fi
    sleep "$POLL_INTERVAL"
    continue
  fi

  CONSECUTIVE_ERRORS=0

  if command -v jq >/dev/null 2>&1; then
    STATUS=$(echo "$TASK_JSON" | jq -r '.status // "unknown"')
    FAILURE_REASON=$(echo "$TASK_JSON" | jq -r '.result.failure_reason // empty' 2>/dev/null || echo "")
  else
    STATUS=$(echo "$TASK_JSON" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
    FAILURE_REASON=""
  fi

  log "  elapsed=${ELAPSED}s  status=${STATUS}"

  case "$STATUS" in
    completed)
      log "PASS — pipeline 跑完 (status=completed, task_id=${TASK_ID})"
      exit 0
      ;;
    failed)
      [[ -n "$FAILURE_REASON" ]] && log "  failure_reason: ${FAILURE_REASON}"
      log "PASS — pipeline 跑完 (status=failed，不卡死即为通过, task_id=${TASK_ID})"
      exit 0
      ;;
    cancelled|error)
      fail "非预期终止 status=${STATUS} (task_id=${TASK_ID})"
      ;;
    queued|in_progress|"")
      # 继续等
      ;;
    *)
      log "⚠ 未知 status=${STATUS}，继续等..."
      ;;
  esac

  sleep "$POLL_INTERVAL"
done
```

- [ ] **Step 5: 运行脚本，确认 skip guard 或完整流程可跑**

```bash
bash /Users/administrator/worktrees/cecelia/harness-e2e-smoke/packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh
```

**若 Brain 正在运行**：应看到：
```
[smoke:harness-pipeline-lifecycle] 前置 OK — Brain 健康, PRD 存在
[smoke:harness-pipeline-lifecycle] 创建 harness_initiative 任务 (sprint_dir=sprints/w19-playground-sum)...
[smoke:harness-pipeline-lifecycle] 任务已创建: task_id=xxxxxxxx-...
[smoke:harness-pipeline-lifecycle] 开始轮询 (每 60s，最多 5400s)...
```
然后等待轮询（可 Ctrl+C 中断，exit code 会是非 0，但这是手动中断，不算失败）。

**若 Brain 未运行**：应看到 SKIP 消息 + exit 0。

验证命令：`echo "exit code: $?"`

- [ ] **Step 6: Commit 完整实现**

```bash
cd /Users/administrator/worktrees/cecelia/harness-e2e-smoke
git add packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh
git commit -m "feat(smoke): harness pipeline lifecycle smoke — 完整轮询逻辑"
```

---

### Task 2: Learning 文件 + push + PR

**Files:**
- Create: `docs/learnings/cp-0518143337-harness-e2e-smoke.md`

- [ ] **Step 1: 写 Learning 文件**

创建 `/Users/administrator/worktrees/cecelia/harness-e2e-smoke/docs/learnings/cp-0518143337-harness-e2e-smoke.md`：

```markdown
# Learning: 缺乏 harness pipeline E2E smoke（2026-05-18）

### 根本原因
所有 harness 测试全是 mock + 单元测试，没有任何测试能验证"真实 Brain 上 pipeline 跑完不卡死"。keepalive 挂了、fix loop 不接、routing 断裂等问题都无法被 CI 提前发现。

### 下次预防
- [ ] 新 harness 功能合并前，先在真实 Brain 跑一次 `harness-pipeline-lifecycle-smoke.sh` 验证流程不卡
- [ ] 每周定时或 release 前手动跑：`bash packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh`
- [ ] smoke 脚本成功标准：completed 或 failed 均为 PASS，超时才是 FAIL
```

- [ ] **Step 2: Commit Learning**

```bash
cd /Users/administrator/worktrees/cecelia/harness-e2e-smoke
git add docs/learnings/cp-0518143337-harness-e2e-smoke.md
git commit -m "docs: learning — harness E2E smoke 缺失根因"
```

- [ ] **Step 3: Push + 创建 PR**

```bash
cd /Users/administrator/worktrees/cecelia/harness-e2e-smoke
git push origin cp-0518143337-harness-e2e-smoke

gh pr create \
  --title "feat(smoke): harness pipeline lifecycle E2E smoke test" \
  --body "$(cat <<'PRBODY'
## 新增

`packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh`

向真实 Brain 注册 harness_initiative 任务（sprint: w19-playground-sum），等待跑完整流程。`completed` 或 `failed` 均为 PASS（验证「不卡死」而非「一定成功」）。90 分钟超时则报 FAIL。

## 使用

```bash
bash packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh
# 环境变量覆盖：
SPRINT_DIR=sprints/w24-playground-factorial MAX_WAIT=3600 bash ...
```

## 背景

此前所有 harness 测试全是 mock，无法检测"keepalive 挂了/fix loop 断了"等运行时问题（见 PR #3029 keepalive 修复 / #3035 fix loop 接线修复）。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)"
```

- [ ] **Step 4: 确认 PR 创建成功，记录 PR URL**

```bash
gh pr view --json url -q .url
```
