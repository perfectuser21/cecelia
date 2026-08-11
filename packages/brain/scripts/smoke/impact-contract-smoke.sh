#!/usr/bin/env bash
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── impact-contract smoke ──"
RESP_FILE=$(mktemp)
trap 'rm -f "$RESP_FILE"' EXIT

# Case 1: change_kind 映射正确（change_kind=bugfix 与 payload.gear=segmented 独立存在）
# task_type=dev(合法枚举), change_kind=bugfix(显式), payload.gear=segmented(通过 payload 传入)
TASK=$(curl -sf -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"smoke:impact-contract","task_type":"dev","change_kind":"bugfix","payload":{"gear":"segmented","orchestrator":"skill-relay"}}' 2>/dev/null) || \
  { fail "POST /tasks 创建失败"; TASK="{}"; }

TASK_ID=$(echo "$TASK" | jq -r '.id // empty' 2>/dev/null)
CK=$(echo "$TASK" | jq -r '.change_kind // empty' 2>/dev/null)
GR=$(echo "$TASK" | jq -r '.payload.gear // empty' 2>/dev/null)

[[ -n "$TASK_ID" ]] && ok "POST /tasks 返回 id=$TASK_ID" || fail "POST /tasks 无 id"
[[ "$CK" == "bugfix" ]] && ok "change_kind=bugfix 已存储" || fail "change_kind 错误: $CK"
[[ "$GR" == "segmented" ]] && ok "payload.gear=segmented 已存储（与 change_kind 独立）" || fail "gear 错误: $GR"
[[ "$CK" != "$GR" ]] && ok "change_kind 与 payload.gear 值不同（未互相赋值）" || fail "change_kind == gear，字段可能交叉污染"

# Case 2: 非法合同被 Structure Gate 拒绝（缺必填字段）
if [[ -n "$TASK_ID" ]]; then
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks/$TASK_ID/impact-contract" \
    -H "Content-Type: application/json" \
    -d '{"change_kind":"bugfix"}' 2>/dev/null) || HTTP="000"
  [[ "$HTTP" == "400" ]] && ok "非法合同被拒绝 HTTP 400" || fail "非法合同响应码错误: $HTTP（期望 400）"
fi

# Case 3: 合法合同必须经过真实 Mapper；Mapper 未上线时 503，绝不靠 stub 创建 active 合同
if [[ -n "$TASK_ID" ]]; then
  HTTP=$(curl -s -o "$RESP_FILE" -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks/$TASK_ID/impact-contract" \
    -H "Content-Type: application/json" \
    -d "{\"change_kind\":\"bugfix\",\"repo\":\"perfectuser21/cecelia\",\"base_revision\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"affected_capabilities\":[{\"capability_id\":\"brain\"}],\"required_assertions\":[]}" 2>/dev/null) || HTTP="000"
  if [[ "$HTTP" == "503" ]]; then
    jq -e '.gate == "blocked" and .reason == "mapper_unavailable" and .retryable == true' "$RESP_FILE" >/dev/null \
      && ok "Mapper 不可用时合同 fail-closed" \
      || fail "Mapper 503 响应合同异常: $(tr -d '\n' < "$RESP_FILE")"
  elif [[ "$HTTP" == "201" || "$HTTP" == "200" ]]; then
    jq -e '.manifest_digest != null and .projection_digest != null and .projection_digest != "stub_projection_digest"' "$RESP_FILE" >/dev/null \
      && ok "合同由真实 Mapper digest 放行" \
      || fail "合同出现空或 stub Mapper 证据: $(tr -d '\n' < "$RESP_FILE")"
  else
    fail "合法合同响应码异常: $HTTP body=$(tr -d '\n' < "$RESP_FILE")"
  fi
fi

# Case 4: Gap 列表路由可达
GAPS=$(curl -sf "$BRAIN/api/brain/harness/gaps?status=open" 2>/dev/null) || \
  { fail "GET /harness/gaps 不可达"; GAPS="{}"; }
echo "$GAPS" | jq -e 'type == "array"' >/dev/null 2>&1 && ok "GET /harness/gaps 返回数组" || \
  fail "GET /harness/gaps 结构异常"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
