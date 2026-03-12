#!/usr/bin/env bash
# verify-billing-pause.sh — 验证 billing pause 熔断端到端路径
# PR #874 — quota_exhausted → setBillingPause → tick 熔断 → requeue
#
# 用法：bash packages/brain/scripts/verify-billing-pause.sh
# 前提：Brain 服务运行中（localhost:5221），PostgreSQL 可访问
#
# 退出码：
#   0 — 所有验证通过
#   1 — 验证失败（输出失败原因）

set -euo pipefail

BRAIN_URL="localhost:5221/api/brain"
PASS_COUNT=0
FAIL_COUNT=0
CLEANUP_TASK_ID=""

pass() { echo "✅ $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "❌ $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
info() { echo "   → $1"; }

cleanup() {
  if [[ -n "$CLEANUP_TASK_ID" ]]; then
    psql -h localhost -U cecelia -d cecelia -q \
      -c "UPDATE tasks SET status='completed' WHERE id='$CLEANUP_TASK_ID'" 2>/dev/null || true
    curl -s "$BRAIN_URL/billing-pause?clear=true" > /dev/null 2>&1 || true
    info "清理完成（测试任务 $CLEANUP_TASK_ID 已完成，billing pause 已清除）"
  fi
}
trap cleanup EXIT

echo "============================================"
echo "  Billing Pause 熔断端到端验证"
echo "  PR #874 - quota_exhausted → tick 熔断 → requeue"
echo "============================================"
echo ""

# ─────────────────────────────────────────────
# Step 1: billing-pause 初始状态为 inactive
# ─────────────────────────────────────────────
echo "--- Step 1: billing-pause 初始状态 ---"

BP_STATUS=$(curl -sf "$BRAIN_URL/billing-pause" 2>/dev/null)
if [[ -z "$BP_STATUS" ]]; then
  fail "Step 1: Brain 服务不可达（$BRAIN_URL）"
  exit 1
fi

BP_ACTIVE=$(echo "$BP_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('active', 'PARSE_ERROR'))" 2>/dev/null)
if [[ "$BP_ACTIVE" == "False" || "$BP_ACTIVE" == "false" ]]; then
  pass "Step 1: /api/brain/billing-pause 返回 active=false"
else
  fail "Step 1: 预期 active=false，实际: $BP_STATUS"
  curl -s "$BRAIN_URL/billing-pause?clear=true" > /dev/null 2>&1 || true
  info "已尝试清除 billing pause，继续..."
fi

# ─────────────────────────────────────────────
# Step 2: 创建测试任务并触发 quota_exhausted 回调
# ─────────────────────────────────────────────
echo ""
echo "--- Step 2: 创建测试任务并触发 quota_exhausted ---"

TEST_TITLE="[TEST] billing-pause-verify-$(date +%s)"
CREATE_RESP=$(curl -sf -X POST "$BRAIN_URL/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"$TEST_TITLE\",\"priority\":\"P2\",\"task_type\":\"dev\",\"description\":\"自动验证脚本创建，用完即删\"}" 2>/dev/null)

TASK_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
if [[ -z "$TASK_ID" ]]; then
  fail "Step 2: 创建测试任务失败: $CREATE_RESP"
  exit 1
fi
CLEANUP_TASK_ID="$TASK_ID"
info "测试任务创建成功: $TASK_ID"

# 通过 DB 设置为 in_progress（execution-callback 要求 WHERE status='in_progress'）
UPDATE_RESULT=$(psql -h localhost -U cecelia -d cecelia -tAq \
  -c "UPDATE tasks SET status='in_progress' WHERE id='$TASK_ID' RETURNING id" 2>/dev/null)
if [[ -z "$UPDATE_RESULT" ]]; then
  fail "Step 2: 无法将任务设为 in_progress（DB 更新失败）"
  exit 1
fi
info "任务已设为 in_progress"

# 触发 quota_exhausted 回调（reset_at = 5 分钟后）
RESET_AT=$(python3 -c "from datetime import datetime, timedelta; print((datetime.utcnow()+timedelta(minutes=5)).strftime('%Y-%m-%dT%H:%M:%SZ'))")

CALLBACK_RESP=$(curl -sf -X POST "$BRAIN_URL/execution-callback" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"status\":\"AI Quota Exhausted\",\"result\":{\"quota_reset_at\":\"$RESET_AT\"}}" 2>/dev/null)

CALLBACK_STATUS=$(echo "$CALLBACK_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('new_status',''))" 2>/dev/null)
if [[ "$CALLBACK_STATUS" == "quota_exhausted" ]]; then
  pass "Step 2: execution-callback 成功，任务状态 → quota_exhausted"
else
  fail "Step 2: 回调响应异常: $CALLBACK_RESP"
fi

# ─────────────────────────────────────────────
# Step 3: 验证 billing pause 已激活
# ─────────────────────────────────────────────
echo ""
echo "--- Step 3: 验证 billing pause 激活 ---"

BP_AFTER=$(curl -sf "$BRAIN_URL/billing-pause" 2>/dev/null)
BP_ACTIVE_AFTER=$(echo "$BP_AFTER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('active', 'PARSE_ERROR'))" 2>/dev/null)
BP_REASON=$(echo "$BP_AFTER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('reason',''))" 2>/dev/null)

if [[ "$BP_ACTIVE_AFTER" == "True" || "$BP_ACTIVE_AFTER" == "true" ]]; then
  pass "Step 3: billing pause active=true（reason=$BP_REASON）"
else
  fail "Step 3: quota_exhausted 后 billing pause 未激活: $BP_AFTER"
fi

# ─────────────────────────────────────────────
# Step 4: 验证 tick 熔断（通过 dispatch_stats 事件计数验证）
# ─────────────────────────────────────────────
echo ""
echo "--- Step 4: 验证 tick 熔断（dispatch_stats billing_pause 事件）---"

# 记录当前 billing_pause 事件数量（基准线）
BP_EVENTS_BEFORE=$(psql -h localhost -U cecelia -d cecelia -tAq \
  -c "SELECT COALESCE(jsonb_array_length(value_json->'events'), 0) FROM working_memory WHERE key='dispatch_stats'" 2>/dev/null | tr -d ' ')
BP_EVENTS_BEFORE=${BP_EVENTS_BEFORE:-0}

# 等待 tick 不在运行中（最多等 30 秒）
info "等待 tick 完成..."
for i in $(seq 1 6); do
  TICK_RUNNING=$(curl -sf "$BRAIN_URL/tick/status" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('tick_running', True))" 2>/dev/null)
  if [[ "$TICK_RUNNING" == "False" || "$TICK_RUNNING" == "false" ]]; then
    break
  fi
  sleep 5
done

# 触发手动 tick（billing pause 激活，预期 dispatch.last.reason=billing_pause）
TICK_RESP=$(curl -sf -X POST "$BRAIN_URL/tick" 2>/dev/null)
TICK_SKIPPED=$(echo "$TICK_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('skipped', False))" 2>/dev/null)
DISPATCH_REASON=$(echo "$TICK_RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
dispatch=d.get('dispatch',{})
last=dispatch.get('last',{})
print(last.get('reason',''))
" 2>/dev/null)

if [[ "$DISPATCH_REASON" == "billing_pause" ]]; then
  pass "Step 4: tick 熔断正常（dispatch.last.reason=billing_pause）"
elif [[ "$TICK_SKIPPED" == "True" || "$TICK_SKIPPED" == "true" ]]; then
  # Tick 被 skip（already_running），通过 dispatch_stats 验证
  info "Tick skip，等待自动 tick 后通过 dispatch_stats 验证..."
  sleep 15
  BP_EVENTS_AFTER=$(psql -h localhost -U cecelia -d cecelia -tAq \
    -c "SELECT COALESCE(jsonb_array_length(value_json->'events'), 0) FROM working_memory WHERE key='dispatch_stats'" 2>/dev/null | tr -d ' ')
  BP_EVENTS_AFTER=${BP_EVENTS_AFTER:-0}

  LATEST_REASON=$(psql -h localhost -U cecelia -d cecelia -tAq \
    -c "SELECT value_json->'events'->-1->>'reason' FROM working_memory WHERE key='dispatch_stats'" 2>/dev/null | tr -d ' ')

  if [[ "$LATEST_REASON" == "billing_pause" ]]; then
    pass "Step 4: tick 熔断正常（dispatch_stats 最新事件 reason=billing_pause）"
  elif [[ "$BP_EVENTS_AFTER" -gt "$BP_EVENTS_BEFORE" ]]; then
    pass "Step 4: tick 熔断生效（dispatch_stats 新增事件数: $BP_EVENTS_BEFORE → $BP_EVENTS_AFTER）"
  else
    fail "Step 4: 无法确认 billing_pause 熔断（dispatch_stats 无新事件，latest_reason=$LATEST_REASON）"
  fi
else
  fail "Step 4: 意外响应: reason='$DISPATCH_REASON', skipped=$TICK_SKIPPED"
fi

# ─────────────────────────────────────────────
# Step 5: 清除 pause，验证任务自动 requeue
# ─────────────────────────────────────────────
echo ""
echo "--- Step 5: 清除 billing pause，验证 requeue ---"

CLEAR_RESP=$(curl -sf "$BRAIN_URL/billing-pause?clear=true" 2>/dev/null)
CLEAR_OK=$(echo "$CLEAR_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cleared',''))" 2>/dev/null)
if [[ "$CLEAR_OK" != "True" && "$CLEAR_OK" != "true" ]]; then
  fail "Step 5: 清除 billing pause 失败: $CLEAR_RESP"
else
  info "Billing pause 已清除"
fi

# 触发手动 tick（触发 step 6.5 requeue 逻辑）
curl -sf -X POST "$BRAIN_URL/tick" > /dev/null 2>&1 || true

# 轮询任务状态（最多等 30 秒）
info "等待任务 requeue..."
TASK_STATUS=""
for i in $(seq 1 6); do
  sleep 5
  TASK_STATUS=$(psql -h localhost -U cecelia -d cecelia -tAq \
    -c "SELECT status FROM tasks WHERE id='$TASK_ID'" 2>/dev/null | tr -d ' ')
  if [[ "$TASK_STATUS" == "queued" ]]; then
    break
  fi
done

if [[ "$TASK_STATUS" == "queued" ]]; then
  pass "Step 5: 任务从 quota_exhausted 自动 requeue → queued"
else
  fail "Step 5: 任务状态为 '$TASK_STATUS'，预期 'queued'"
fi

# ─────────────────────────────────────────────
# 最终结果
# ─────────────────────────────────────────────
echo ""
echo "============================================"
echo "  验证结果：$PASS_COUNT 通过，$FAIL_COUNT 失败"
echo "============================================"

if [[ $FAIL_COUNT -eq 0 ]]; then
  echo "🎉 所有验证通过！billing pause 熔断端到端路径正常。"
  exit 0
else
  echo "🚨 验证失败，请检查 Brain 日志：pm2 logs brain --lines 50"
  exit 1
fi
