#!/usr/bin/env bash
# integration-nightly.sh
# 刀B：关键路由 + 回调贯通 E2E
#
# 验收项：
#   1. Brain 健康 (tick/status 200)
#   2. 任务类型端点（/task-types 含 dev + ci_patrol）
#   3. 全量 migrations 完整（executor_kind 字段存在）
#   4. 关键路由：POST /tasks → task_id 返回 + 路由决策
#   5. 路由端点：POST /route-task 返回 agent/location
#   6. 回调贯通：PATCH /tasks/:id status=completed → DB 最终态
#   7. executor_kind 字段：GET /tasks/:id 含 executor_kind
#
# 环境变量：
#   BRAIN_URL          — Brain HTTP 地址（默认 http://localhost:5221）
#   FIRE_TEST          — 传 1 则故意失败（proven-to-fire 验证）

set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
API="${BRAIN_URL}/api/brain"
FIRE_TEST="${FIRE_TEST:-0}"

PASS=0
FAIL=0

ok()   { echo "✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL + 1)); }

# ─── FIRE_TEST 故意失败（proven-to-fire 验证）────────────────────────────
if [ "$FIRE_TEST" = "1" ]; then
  echo "::error::FIRE_TEST=1 — 故意失败，验证 [integration-red] Issue 告警链路"
  exit 1
fi

echo "=============================="
echo "  Cecelia Integration Nightly"
echo "  刀B：关键路由 + 回调贯通 E2E"
echo "  Brain: $BRAIN_URL"
echo "=============================="
echo ""

# ─── 1. Brain 健康检查 ───────────────────────────────────────────────────
echo "── 1. Brain 健康检查 ──"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$API/tick/status" 2>/dev/null)
if [ "$CODE" = "200" ]; then
  ok "GET /tick/status → 200"
else
  fail "GET /tick/status → 期望 200，得 $CODE"
fi

# /health 端点
CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$API/health" 2>/dev/null)
if [ "$CODE" = "200" ]; then
  ok "GET /health → 200"
else
  fail "GET /health → 期望 200，得 $CODE（非阻断，可选端点）"
  FAIL=$((FAIL - 1))  # 可选端点，不计为失败
fi

echo ""

# ─── 2. 任务类型端点 ─────────────────────────────────────────────────────
echo "── 2. 任务类型端点 ──"
TYPES_RESP=$(curl -s -m 10 "$API/task-types" 2>/dev/null)
CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$API/task-types" 2>/dev/null)
if [ "$CODE" = "200" ]; then
  ok "GET /task-types → 200"
  echo "$TYPES_RESP" | grep -q '"dev"' \
    && ok "/task-types 含 'dev'" \
    || fail "/task-types 缺少 'dev'"
  echo "$TYPES_RESP" | grep -q '"ci_patrol"' \
    && ok "/task-types 含 'ci_patrol'" \
    || fail "/task-types 缺少 'ci_patrol'（migration 327 未跑？）"
else
  fail "GET /task-types → 期望 200，得 $CODE"
fi

echo ""

# ─── 3. 关键路由：POST /tasks ────────────────────────────────────────────
echo "── 3. 关键路由：任务创建 ──"
CREATE_RESP=$(curl -s -m 15 \
  -X POST "$API/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "integration-nightly: dev 路由贯通 E2E",
    "task_type": "dev",
    "priority": "P3",
    "created_by": "integration-nightly",
    "trigger_source": "integration-nightly"
  }' 2>/dev/null)

TASK_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
if [ -n "$TASK_ID" ]; then
  ok "POST /tasks → task_id=$TASK_ID"
else
  fail "POST /tasks → 未返回 id，响应: $CREATE_RESP"
fi

echo ""

# ─── 4. 路由端点：POST /route-task ──────────────────────────────────────
echo "── 4. 路由端点 POST /route-task ──"
ROUTE_RESP=$(curl -s -m 10 \
  -X POST "$API/route-task" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"dev","priority":"P2"}' 2>/dev/null)
ROUTE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 \
  -X POST "$API/route-task" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"dev","priority":"P2"}' 2>/dev/null)

if [ "$ROUTE_CODE" = "200" ]; then
  ok "POST /route-task → 200"
  echo "$ROUTE_RESP" | grep -q '"agent"\|"location"\|"skill"' \
    && ok "路由响应含 agent/location 字段" \
    || fail "路由响应缺少 agent/location 字段"
else
  fail "POST /route-task → 期望 200，得 $ROUTE_CODE"
fi

echo ""

# ─── 5. 回调贯通：PATCH /tasks/:id ──────────────────────────────────────
echo "── 5. 回调贯通：PATCH /tasks/:id ──"
if [ -n "$TASK_ID" ]; then
  CB_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 \
    -X PATCH "$API/tasks/$TASK_ID" \
    -H "Content-Type: application/json" \
    -d '{"status":"completed","result":{"source":"integration-nightly","verified":true}}' \
    2>/dev/null)
  if [ "$CB_CODE" = "200" ]; then
    ok "PATCH /tasks/$TASK_ID status=completed → 200"
  else
    fail "PATCH /tasks/$TASK_ID → 期望 200，得 $CB_CODE"
  fi

  # 验证最终态
  GET_RESP=$(curl -s -m 10 "$API/tasks/$TASK_ID" 2>/dev/null)
  FINAL_STATUS=$(echo "$GET_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
  if [ "$FINAL_STATUS" = "completed" ]; then
    ok "GET /tasks/$TASK_ID → status=completed（回调贯通）"
  else
    fail "GET /tasks/$TASK_ID → 期望 status=completed，得 '$FINAL_STATUS'"
  fi
else
  fail "跳过回调贯通（任务创建失败）"
fi

echo ""

# ─── 6. executor_kind 字段（migration 329 验证）─────────────────────────
echo "── 6. executor_kind 字段（migration 329）──"
if [ -n "$TASK_ID" ]; then
  GET_RESP=$(curl -s -m 10 "$API/tasks/$TASK_ID" 2>/dev/null)
  # executor_kind 字段应存在（值可为 null）
  HAS_KIND=$(echo "$GET_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('yes' if 'executor_kind' in d else 'no')
" 2>/dev/null || echo "no")
  if [ "$HAS_KIND" = "yes" ]; then
    ok "GET /tasks/:id 响应含 executor_kind 字段（migration 329 已跑）"
  else
    fail "GET /tasks/:id 响应缺少 executor_kind 字段（migration 329 未跑？）"
  fi
else
  fail "跳过 executor_kind 检查（任务创建失败）"
fi

echo ""

# ─── 7. ci_patrol 路由（cross-component 验证）───────────────────────────
echo "── 7. ci_patrol 类型任务路由 ──"
CIPATROL_ROUTE=$(curl -s -m 10 \
  -X POST "$API/route-task" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"ci_patrol","priority":"P2"}' 2>/dev/null)
CIPATROL_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 \
  -X POST "$API/route-task" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"ci_patrol","priority":"P2"}' 2>/dev/null)

if [ "$CIPATROL_CODE" = "200" ]; then
  ok "POST /route-task ci_patrol → 200"
else
  fail "POST /route-task ci_patrol → 期望 200，得 $CIPATROL_CODE"
fi

echo ""

# ─── 汇总 ───────────────────────────────────────────────────────────────
echo "=============================="
echo "  PASS=$PASS  FAIL=$FAIL"
echo "=============================="

if [ "$FAIL" -gt 0 ]; then
  echo "::error::integration-nightly 失败 $FAIL 项"
  exit 1
fi

echo "✅ 关键路由 + 回调贯通 E2E 全部通过"
exit 0
