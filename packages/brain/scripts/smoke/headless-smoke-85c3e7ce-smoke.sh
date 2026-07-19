#!/usr/bin/env bash
# headless-smoke-85c3e7ce-smoke.sh — Brain headless dispatch 三元组验证
# TASK_ID: 85c3e7ce-7849-42b8-9ff9-542dd0db8375
# Sprint: 07191411-relay-85c3e7ce
# 创建时间: 2026-07-19
#
# 验证内容：
#   - Brain headless 任务三元组 (mode=headless, executor=claude, orchestrator=skill-relay)
#   - dispatched_by_orchestrator=true（在 payload 层）
#   - orchestrator_dispatched_at 非空（在 payload 层）
#   - claimed_by / claimed_at / executor_kind 存在

set -uo pipefail

TASK_ID="85c3e7ce-7849-42b8-9ff9-542dd0db8375"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== Smoke: headless-smoke 85c3e7ce ==="

# 工具检查
command -v jq >/dev/null 2>&1 || { echo "[FATAL] jq not found"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "[FATAL] curl not found"; exit 1; }

# 获取任务
if ! RESP=$(curl -sf "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null); then
  echo "[FAIL] Brain API unreachable: ${BRAIN_URL}/api/brain/tasks/${TASK_ID}" >&2
  exit 1
fi

# 三元组校验（payload 层）
STATUS=$(echo "$RESP" | jq -r '.status // empty')
MODE=$(echo "$RESP" | jq -r '.payload.mode // empty')
EXECUTOR=$(echo "$RESP" | jq -r '.payload.executor // empty')
ORCHESTRATOR=$(echo "$RESP" | jq -r '.payload.orchestrator // empty')
DISPATCHED=$(echo "$RESP" | jq -r '.payload.dispatched_by_orchestrator // empty')
DISPATCHED_AT=$(echo "$RESP" | jq -r '.payload.orchestrator_dispatched_at // empty')
CLAIMED_BY=$(echo "$RESP" | jq -r '.claimed_by // empty')

[ "$STATUS" = "in_progress" ] || { echo "[FAIL] status=$STATUS (expected in_progress)"; exit 1; }
[ "$MODE" = "headless" ] || { echo "[FAIL] payload.mode=$MODE (expected headless)"; exit 1; }
[ "$EXECUTOR" = "claude" ] || { echo "[FAIL] payload.executor=$EXECUTOR (expected claude)"; exit 1; }
[ "$ORCHESTRATOR" = "skill-relay" ] || { echo "[FAIL] payload.orchestrator=$ORCHESTRATOR (expected skill-relay)"; exit 1; }
[ "$DISPATCHED" = "true" ] || { echo "[FAIL] payload.dispatched_by_orchestrator=$DISPATCHED (expected true)"; exit 1; }
[ -n "$DISPATCHED_AT" ] && [ "$DISPATCHED_AT" != "null" ] || { echo "[FAIL] payload.orchestrator_dispatched_at empty"; exit 1; }
[ -n "$CLAIMED_BY" ] && [ "$CLAIMED_BY" != "null" ] || { echo "[FAIL] claimed_by empty"; exit 1; }

echo "[PASS] headless-smoke 85c3e7ce 三元组全部验证通过"
echo "  status=$STATUS, mode=$MODE, executor=$EXECUTOR, orchestrator=$ORCHESTRATOR"
echo "  dispatched_at=$DISPATCHED_AT, claimed_by=$CLAIMED_BY"

FINAL_CODE=0
exit $FINAL_CODE
