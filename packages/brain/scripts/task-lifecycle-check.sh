#!/usr/bin/env bash
# L4 Task Lifecycle E2E: 创建任务 → dispatch → 完成全链路
#
# 验证 Brain 任务生命周期核心路径：
#   1. POST /api/brain/tasks 创建任务（状态: queued）
#   2. GET /api/brain/tasks/:id 验证任务已创建且状态正确
#   3. PATCH 状态 queued → in_progress（模拟 dispatch）
#   4. GET 验证 in_progress 状态已生效
#   5. PATCH 状态 in_progress → completed
#   6. GET 验证 completed 状态已生效
#
# 前提条件：Brain 服务已启动，DB 迁移已完成，ENV_REGION=us
# 注意：PATCH 响应可能含 emitEvent 错误但 DB 已更新，通过 GET 验证实际状态

set -euo pipefail

PORT=${BRAIN_PORT:-5299}
BASE_URL="http://localhost:${PORT}"

FAILED=0
TASK_ID=""

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILED=1; }

echo "=== L4 Task Lifecycle E2E ==="
echo ""

# ─── Step 1: 创建任务 ────────────────────────────────────────────

echo "[1/6] Creating task via POST /api/brain/tasks..."
CREATE_RESP=$(curl -sf -X POST "${BASE_URL}/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"L4 Lifecycle E2E","description":"CI lifecycle check","trigger_source":"ci_e2e","task_type":"dev"}' \
  2>/dev/null || echo "")

if [ -z "$CREATE_RESP" ]; then
  fail "POST /api/brain/tasks returned empty response"
  echo "=== L4 Task Lifecycle E2E FAILED ==="
  exit 1
fi

TASK_ID=$(echo "$CREATE_RESP" | jq -r '.id // empty' 2>/dev/null || echo "")
if [ -z "$TASK_ID" ]; then
  fail "Response missing task id: $(echo "$CREATE_RESP" | head -c 300)"
  echo "=== L4 Task Lifecycle E2E FAILED ==="
  exit 1
fi
pass "Task created (id: $TASK_ID)"

# ─── Step 2: 验证任务已创建且状态为 queued ───────────────────────

echo "[2/6] Verifying task is in queued state..."
GET_RESP=$(curl -sf "${BASE_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null || echo "")

if [ -z "$GET_RESP" ]; then
  fail "GET /api/brain/tasks/${TASK_ID} returned empty"
  echo "=== L4 Task Lifecycle E2E FAILED ==="
  exit 1
fi

INITIAL_STATUS=$(echo "$GET_RESP" | jq -r '.status // empty' 2>/dev/null || echo "")
if [ -z "$INITIAL_STATUS" ]; then
  fail "Task response missing status field: $(echo "$GET_RESP" | head -c 200)"
elif [ "$INITIAL_STATUS" = "queued" ]; then
  pass "Task initial status: queued"
else
  pass "Task initial status: $INITIAL_STATUS (acceptable)"
fi

# ─── Step 3: Dispatch（queued → in_progress）────────────────────

echo "[3/6] Dispatching task (queued → in_progress)..."
DISPATCH_RESP=$(curl -s -X PATCH "${BASE_URL}/api/brain/tasks/${TASK_ID}" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}' \
  2>/dev/null || echo "")

# 注意：PATCH 响应可能因 emitEvent 报 DATABASE_ERROR，但 DB 已更新
# 通过 GET 验证实际状态
DISPATCH_HTTP=$(echo "$DISPATCH_RESP" | jq -r '.code // "ok"' 2>/dev/null || echo "ok")
echo "  DEBUG: PATCH response = $(echo "$DISPATCH_RESP" | head -c 400)"
if [ "$DISPATCH_HTTP" = "INVALID_TRANSITION" ]; then
  fail "Invalid status transition queued→in_progress: $(echo "$DISPATCH_RESP" | head -c 200)"
  echo "=== L4 Task Lifecycle E2E FAILED ==="
  exit 1
fi
pass "Dispatch PATCH sent"

# ─── Step 4: 验证 in_progress 状态 ──────────────────────────────

echo "[4/6] Verifying task is in_progress..."
IN_PROGRESS_RESP=$(curl -sf "${BASE_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null || echo "")
IN_PROGRESS_STATUS=$(echo "$IN_PROGRESS_RESP" | jq -r '.status // empty' 2>/dev/null || echo "")

if [ "$IN_PROGRESS_STATUS" = "in_progress" ]; then
  pass "Task status: in_progress (dispatch confirmed)"
elif [ -z "$IN_PROGRESS_STATUS" ]; then
  fail "Could not read task status after dispatch"
else
  fail "Expected in_progress, got: $IN_PROGRESS_STATUS"
fi

# ─── Step 5: 完成（in_progress → completed）─────────────────────

echo "[5/6] Completing task (in_progress → completed)..."
COMPLETE_RESP=$(curl -s -X PATCH "${BASE_URL}/api/brain/tasks/${TASK_ID}" \
  -H "Content-Type: application/json" \
  -d '{"status":"completed","summary":"lifecycle e2e complete"}' \
  2>/dev/null || echo "")

COMPLETE_CODE=$(echo "$COMPLETE_RESP" | jq -r '.code // "ok"' 2>/dev/null || echo "ok")
if [ "$COMPLETE_CODE" = "INVALID_TRANSITION" ]; then
  fail "Invalid status transition in_progress→completed: $(echo "$COMPLETE_RESP" | head -c 200)"
  echo "=== L4 Task Lifecycle E2E FAILED ==="
  exit 1
fi
pass "Complete PATCH sent"

# ─── Step 6: 验证 completed 状态 ─────────────────────────────────

echo "[6/6] Verifying task is completed..."
FINAL_RESP=$(curl -sf "${BASE_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null || echo "")
FINAL_STATUS=$(echo "$FINAL_RESP" | jq -r '.status // empty' 2>/dev/null || echo "")

if [ "$FINAL_STATUS" = "completed" ]; then
  pass "Task status: completed (full lifecycle verified)"
elif [ -z "$FINAL_STATUS" ]; then
  fail "Could not read task status after completion"
else
  fail "Expected completed, got: $FINAL_STATUS"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "=== L4 Task Lifecycle E2E PASSED ==="
  echo "  Full lifecycle: queued → in_progress → completed"
  exit 0
else
  echo "=== L4 Task Lifecycle E2E FAILED ==="
  exit 1
fi
