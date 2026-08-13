#!/usr/bin/env bash
# t4-claim-protocol-smoke.sh
# 验收：T4 认领协议统一——PATCH in_progress 自动写 claimed_by + executor_kind
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
BASE_SHA="$(git rev-parse HEAD)"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. POST /tasks 创建一个 queued 任务
echo "── 创建测试任务 ──"
resp=$(curl -s -X POST "$API/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"smoke-t4-claim-protocol\",\"task_type\":\"dev\",\"priority\":\"P2\",\"change_kind\":\"bugfix\",\"base_sha\":\"$BASE_SHA\"}")
TASK_ID=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

if [[ -z "$TASK_ID" ]]; then
  fail "创建任务失败: $resp"
  echo "── 结果: $PASS 通过, $FAIL 失败 ──"
  exit 1
fi
ok "创建任务 $TASK_ID"

# 2. PATCH status → in_progress（带 X-Session-Id），验证 claimed_by + executor_kind 被写入
echo "── PATCH in_progress → 验证 claimed_by/executor_kind ──"
patch_resp=$(curl -s -X PATCH "$API/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: smoke-session-t4" \
  -d '{"status":"in_progress"}')
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$API/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: smoke-session-t4-check" \
  -d '{"status":"in_progress"}' 2>/dev/null || echo "000")

# 查询任务验证字段
task_resp=$(curl -s "$API/tasks/$TASK_ID" 2>/dev/null || echo "{}")
claimed_by=$(echo "$task_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('claimed_by',''))" 2>/dev/null || echo "")
executor_kind=$(echo "$task_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('executor_kind',''))" 2>/dev/null || echo "")

[[ "$claimed_by" == session:* ]] \
  && ok "claimed_by 写入正确: $claimed_by" \
  || fail "claimed_by 未正确写入，得: '$claimed_by'"

[[ "$executor_kind" == "headed-session" ]] \
  && ok "executor_kind=headed-session" \
  || fail "executor_kind 未正确写入，得: '$executor_kind'"

# 3. POST /:id/claim（新任务）验证 executor_kind 可传入
echo "── POST /claim 含 executor_kind ──"
resp2=$(curl -s -X POST "$API/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"smoke-t4-claim-endpoint\",\"task_type\":\"dev\",\"priority\":\"P2\",\"change_kind\":\"bugfix\",\"base_sha\":\"$BASE_SHA\"}")
TASK_ID2=$(echo "$resp2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

if [[ -n "$TASK_ID2" ]]; then
  claim_resp=$(curl -s -X POST "$API/tasks/$TASK_ID2/claim" \
    -H "Content-Type: application/json" \
    -d '{"claimer":"smoke-runner","executor_kind":"bridge"}')
  ek=$(echo "$claim_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('executor_kind',''))" 2>/dev/null || echo "")
  [[ "$ek" == "bridge" ]] \
    && ok "POST /claim executor_kind=bridge 写入正确" \
    || fail "POST /claim executor_kind 期望 bridge，得: '$ek' (resp=$claim_resp)"
else
  fail "创建 claim-test 任务失败"
fi

echo ""
echo "── 结果: $PASS 通过, $FAIL 失败 ──"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
