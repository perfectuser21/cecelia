#!/usr/bin/env bash
# retire-harness-planner-smoke.sh
# 真环境验证：派一个 harness_planner task 到 Brain → 必须立即 terminal_failure（退役行为）
# 不会 spawn docker，不进 LangGraph pipeline，不写 cecelia_events langgraph_step

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "🔍 retire-harness-planner-smoke — Brain @ ${BRAIN_URL}"

# 1. 注册一个 harness_planner task
echo "▶ 注册测试 task..."
TASK_ID=$(curl -sS -X POST "${BRAIN_URL}/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"[smoke] retire-harness-planner verify","description":"smoke test — should be terminal_failure","task_type":"harness_planner","priority":"P2","trigger_source":"manual"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")

if [ -z "$TASK_ID" ]; then
  echo "❌ 注册 task 失败" >&2
  exit 1
fi
echo "  task_id: $TASK_ID"

# 2. 等 Brain 派发一次（最多 90s）
echo "▶ 等 Brain 派发处理（max 90s）..."
for i in $(seq 1 18); do
  STATUS=$(curl -sS "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))")
  case "$STATUS" in
    failed)
      ERR=$(curl -sS "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" | python3 -c "import json,sys; print((json.load(sys.stdin).get('error_message') or '').strip())")
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
      exit 1
      ;;
    queued)
      sleep 5
      ;;
    *)
      sleep 5
      ;;
  esac
done

echo "❌ 90s 内 task 未被派发处理 (last status=$STATUS)" >&2
exit 1
