#!/usr/bin/env bash
# seven-ring-audit-smoke.sh
# 验收：刀3-T6 七环对账巡检 — KV 端点 + 七环路由 + 调度接入
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

echo "── 1. Brain health ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/health")
[[ "$code" == "200" ]] \
  && ok "GET /health → 200" \
  || fail "GET /health → 期望 200，得 $code"

echo "── 2. GET /api/brain/quality/seven-ring-audit 可访问 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/quality/seven-ring-audit")
[[ "$code" == "200" ]] \
  && ok "GET /quality/seven-ring-audit → 200" \
  || fail "GET /quality/seven-ring-audit → 期望 200，得 $code"

echo "── 3. GET /api/brain/kv/seven-ring-audit-last 端点存在 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5221/api/brain/kv/seven-ring-audit-last")
# 404 = 还没运行过（正常），200 = 已有数据，均视为端点存在
[[ "$code" == "200" || "$code" == "404" ]] \
  && ok "GET /api/brain/kv/seven-ring-audit-last → 端点存在（$code）" \
  || fail "GET /api/brain/kv/seven-ring-audit-last → 意外状态 $code"

echo "── 4. POST /api/brain/quality/seven-ring-audit/run 可触发 ──"
RESULT=$(curl -s -X POST "$API/quality/seven-ring-audit/run" \
  -H "Content-Type: application/json" 2>/dev/null)
RINGS_COUNT=$(echo "$RESULT" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try {
      const r = JSON.parse(d);
      console.log((r.result && r.result.rings) ? r.result.rings.length : 0);
    } catch { console.log(0); }
  });
" 2>/dev/null || echo "0")
[[ "$RINGS_COUNT" == "7" ]] \
  && ok "七环对账返回 7 条环结果" \
  || fail "七环对账环数 = $RINGS_COUNT（期望 7）"

echo "── 5. KV 端点 /api/brain/kv/seven-ring-audit-last 有数据（上一步已运行）──"
KV_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5221/api/brain/kv/seven-ring-audit-last")
[[ "$KV_CODE" == "200" ]] \
  && ok "KV 端点有数据 (200)" \
  || fail "KV 端点无数据（$KV_CODE）"

echo "── 6. 棘轮文件存在 ──"
RATCHET_FILE="$(dirname "$(dirname "$(dirname "$(dirname "$0")")")")/scripts/seven-ring-audit-ratchet.json"
if [ -f "$RATCHET_FILE" ]; then
  ok "棘轮文件存在: $RATCHET_FILE"
else
  fail "棘轮文件不存在: $RATCHET_FILE"
fi

echo ""
echo "──────────────────────────────"
echo "PASS=$PASS  FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
