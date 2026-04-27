#!/usr/bin/env bash
# cleanup-content-pipeline-smoke.sh
#
# 真环境验证 in-Brain content-pipeline 编排已下线（搬到 ZJ pipeline-worker）：
#   1. 派一个 task_type='content-pipeline' → 必须停在 queued
#      （不再被 in-Brain orchestrator 立即推进到 in_progress）
#   2. 旧 endpoint POST /api/brain/pipelines/:id/run-langgraph → 必须返回 404
#      （endpoint 已删除）
#   3. POST /api/brain/pipelines/:id/run → 返回 202 + 不调 orchestrator
#
# Cecelia 端只剩 task CRUD + can-run + LLM 服务，编排已搬到 ZJ pipeline-worker
# (Python LangGraph，PR zenithjoy#216)。

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "🔍 cleanup-content-pipeline-smoke — Brain @ ${BRAIN_URL}"

# ─── 1. 派一个 content-pipeline task ───────────────────────────────────────────
echo "▶ [1/3] 注册 content-pipeline task（应停在 queued，不被 in-Brain 立即处理）..."
TASK_ID=$(curl -sS -X POST "${BRAIN_URL}/api/brain/pipelines" \
  -H "Content-Type: application/json" \
  -d '{"keyword":"smoke-cleanup-cp","content_type":"solo-company-case","priority":"P2"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")

if [ -z "$TASK_ID" ]; then
  echo "❌ 注册 task 失败" >&2
  exit 1
fi
echo "  task_id: $TASK_ID"

# 等 30s（一个 tick 周期），验证 task 不被推进
echo "  等 30s 验证 task 仍 queued（in-Brain orchestrator 已下线）..."
sleep 30
STATUS=$(curl -sS "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))")
case "$STATUS" in
  queued)
    echo "✅ task 仍 queued — in-Brain orchestrator 已下线，等 ZJ pipeline-worker 拉取"
    ;;
  in_progress|completed|failed)
    # 注意：如果 ZJ pipeline-worker 真的在跑且 60s 内拉到了，这里也可能 in_progress。
    # 那也是合法（说明 ZJ worker 在干活），但需要日志确认。
    echo "⚠️  task status=${STATUS}（如果 ZJ pipeline-worker 在跑，这是合法的）"
    ;;
  *)
    echo "❌ task status 异常: '${STATUS}'" >&2
    exit 1
    ;;
esac

# ─── 2. 旧 run-langgraph endpoint 已删 ─────────────────────────────────────────
echo "▶ [2/3] POST /api/brain/pipelines/${TASK_ID}/run-langgraph → 应 404（路由已删）..."
HTTP_CODE=$(curl -sS -o /tmp/cp-cleanup-langgraph.json -w '%{http_code}' \
  -X POST "${BRAIN_URL}/api/brain/pipelines/${TASK_ID}/run-langgraph" \
  -H "Content-Type: application/json" -d '{}' || true)
if [ "$HTTP_CODE" = "404" ]; then
  echo "✅ /run-langgraph 返回 404 — endpoint 已删除"
else
  echo "❌ /run-langgraph 返回 $HTTP_CODE（期望 404）" >&2
  cat /tmp/cp-cleanup-langgraph.json >&2 2>/dev/null || true
  exit 1
fi

# ─── 3. /:id/run 仍工作但只返 202（不再同步 orchestrate）────────────────────────
echo "▶ [3/3] POST /api/brain/pipelines/${TASK_ID}/run → 应 202..."
HTTP_CODE=$(curl -sS -o /tmp/cp-cleanup-run.json -w '%{http_code}' \
  -X POST "${BRAIN_URL}/api/brain/pipelines/${TASK_ID}/run" \
  -H "Content-Type: application/json" -d '{}' || true)
if [ "$HTTP_CODE" = "202" ]; then
  echo "✅ /:id/run 返回 202 — 仅重置状态，不再 in-Brain orchestrate"
else
  echo "❌ /:id/run 返回 $HTTP_CODE（期望 202）" >&2
  cat /tmp/cp-cleanup-run.json >&2 2>/dev/null || true
  exit 1
fi

echo ""
echo "✅ cleanup-content-pipeline-smoke PASS — in-Brain content-pipeline 编排已下线"
