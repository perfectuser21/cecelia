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
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

# ── Skip guard ──────────────────────────────────────────────────────────────

command -v curl >/dev/null 2>&1 || skip "curl 未安装"

if ! curl -sf -m 5 "${BRAIN_URL}/api/brain/health" -o /dev/null 2>&1; then
  skip "Brain ${BRAIN_URL} 不健康"
fi

PRD_PATH="${REPO_ROOT}/${SPRINT_DIR}/sprint-prd.md"
if [[ ! -f "$PRD_PATH" ]]; then
  skip "sprint PRD 不存在: ${PRD_PATH}"
fi

log "前置 OK — Brain 健康, PRD 存在"

# ── 创建 harness_initiative 任务 ─────────────────────────────────────────────

log "创建 harness_initiative 任务 (sprint_dir=${SPRINT_DIR})..."

TASK_JSON=$(curl -sf -m 10 -X POST "${BRAIN_URL}/api/brain/tasks" \
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
    LAST_JSON=$(curl -sf -m 10 "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null || echo '{}')
    if command -v jq >/dev/null 2>&1; then
      LAST_STATUS=$(echo "$LAST_JSON" | jq -r '.status // "unknown"')
    else
      LAST_STATUS=$(echo "$LAST_JSON" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
    fi
    fail "超时（${MAX_WAIT}s），pipeline 疑似卡死。最后 status=${LAST_STATUS}, task_id=${TASK_ID}"
  fi

  TASK_JSON=$(curl -sf -m 10 "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null || echo "")
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
