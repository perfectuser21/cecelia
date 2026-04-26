#!/usr/bin/env bash
# retire-harness-planner-smoke.sh
# 真环境验证：派一个 harness_planner task 到 Brain → 必须立即 terminal_failure（退役行为）
#
# 不依赖 cecelia-bridge / claude executor — dispatcher.js 在 checkCeceliaRunAvailable
# 之前就拦截 retired task_type，标 pipeline_terminal_failure 后返回。
# 这让本 smoke 在 CI clean docker（无 bridge）也能跑过。
#
# CI 环境（brain container 起在 CECELIA_TICK_ENABLED=false 下）需主动 POST /api/brain/tick
# 触发派发；生产环境 tick loop 自走，无需主动触发。

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
MAX_WAIT_SEC="${RETIRE_SMOKE_MAX_WAIT_SEC:-180}"

echo "🔍 retire-harness-planner-smoke — Brain @ ${BRAIN_URL} (max_wait=${MAX_WAIT_SEC}s)"

# 0. health check
if ! curl -sf "${BRAIN_URL}/api/brain/tick/status" >/dev/null 2>&1; then
  echo "❌ Brain not healthy at ${BRAIN_URL}/api/brain/tick/status" >&2
  exit 1
fi

# 1. 注册一个 harness_planner task
echo "▶ 注册测试 task..."
TASK_ID=$(curl -sS -X POST "${BRAIN_URL}/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"[smoke] retire-harness-planner verify","description":"smoke test — should be terminal_failure (subsumed by harness_initiative full graph)","task_type":"harness_planner","priority":"P2","trigger_source":"manual"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")

if [ -z "$TASK_ID" ]; then
  echo "❌ 注册 task 失败" >&2
  exit 1
fi
echo "  task_id: $TASK_ID"

# 2. 主动触发一次 tick — CI 关掉了 auto tick loop（CECELIA_TICK_ENABLED=false），
#    生产环境 tick 会按 TICK_INTERVAL_MINUTES 自走（默认 2 分钟，可能比 wait 超时长）。
#    无论环境如何主动 trigger 一次都是 idempotent + 加速的。
echo "▶ 主动触发 tick（manual dispatch）..."
TICK_RESULT=$(curl -sS -X POST "${BRAIN_URL}/api/brain/tick" -H "Content-Type: application/json" -d '{}' 2>&1 || echo '{"error":"tick_request_failed"}')
echo "  tick result: ${TICK_RESULT}"

# 3. 轮询 task status（最多 MAX_WAIT_SEC，5s 间隔）
ATTEMPTS=$(( MAX_WAIT_SEC / 5 ))
echo "▶ 轮询 task status（${ATTEMPTS} attempts × 5s = ${MAX_WAIT_SEC}s）..."
STATUS=""
ERR=""
for i in $(seq 1 "${ATTEMPTS}"); do
  RESP=$(curl -sS "${BRAIN_URL}/api/brain/tasks/${TASK_ID}")
  STATUS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))")
  case "$STATUS" in
    failed)
      ERR=$(echo "$RESP" | python3 -c "import json,sys; print((json.load(sys.stdin).get('error_message') or '').strip())")
      if echo "$ERR" | grep -qiE "retired|subsumed|terminal"; then
        echo "✅ harness_planner task → status=failed + error_message='$ERR'"
        echo "✅ retire-harness-planner smoke PASS"
        exit 0
      else
        echo "❌ status=failed but error_message 未含 retired/subsumed/terminal: '$ERR'" >&2
        exit 1
      fi
      ;;
    in_progress|completed)
      echo "❌ harness_planner task 不应进 in_progress/completed (status=$STATUS) — retire 失败" >&2
      echo "  full task body: $RESP" >&2
      exit 1
      ;;
    queued)
      # 每 30s 重 trigger 一次 tick，防止 CI 环境永远没 tick 的角落情况
      if [ $((i % 6)) -eq 0 ]; then
        echo "  attempt ${i}: 仍 queued，重 trigger tick..."
        curl -sS -X POST "${BRAIN_URL}/api/brain/tick" -H "Content-Type: application/json" -d '{}' >/dev/null 2>&1 || true
      fi
      sleep 5
      ;;
    *)
      sleep 5
      ;;
  esac
done

echo "❌ ${MAX_WAIT_SEC}s 内 task 未被派发处理 (last status=$STATUS)" >&2
echo "  task body: $(curl -sS "${BRAIN_URL}/api/brain/tasks/${TASK_ID}")" >&2
exit 1
