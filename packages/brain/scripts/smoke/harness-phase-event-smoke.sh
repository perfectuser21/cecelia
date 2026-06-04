#!/usr/bin/env bash
# smoke test: POST + PATCH /api/brain/harness/phase-event 路由可用性
# 不依赖 psql/真实 initiative_run；用 400/404 响应验证路由已挂载
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

# Brain 不可达时优雅跳过（不阻断 CI）
curl -sf "${BRAIN}/api/brain/harness/ping" >/dev/null 2>&1 || { echo "SKIP: Brain not running at ${BRAIN}"; exit 0; }
echo "Brain reachable at ${BRAIN}"

# 1. POST /phase-event 缺必填字段 → 400（路由已注册 + 校验逻辑正确）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BRAIN}/api/brain/harness/phase-event" \
  -H 'Content-Type: application/json' -d '{}')
[ "$STATUS" = "400" ] && ok "POST /phase-event 缺字段 → 400" || fail "POST /phase-event 缺字段 → $STATUS (期望 400)"

# 2. POST /phase-event 带合法格式 UUID（FK 不存在 → 500；路由未挂载 → 404）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BRAIN}/api/brain/harness/phase-event" \
  -H 'Content-Type: application/json' \
  -d '{"initiative_id":"00000000-0000-0000-0000-000000000001","node":"smoke","status":"running","model":"smoke-test"}')
[ "$STATUS" != "404" ] \
  && ok "POST /phase-event 路由已挂载 (HTTP ${STATUS} ≠ 404)" \
  || fail "POST /phase-event 路由未挂载 (404)"

# 3. PATCH /phase-event/:id 不存在 ID → 404 含 "not found"（路由层给出，而非 Express 默认）
PATCH_OUT=$(curl -s -w '\n%{http_code}' -X PATCH "${BRAIN}/api/brain/harness/phase-event/999999999" \
  -H 'Content-Type: application/json' \
  -d '{"status":"completed","ts_end":0,"cost_usd":0}')
PATCH_BODY=$(echo "$PATCH_OUT" | head -1)
PATCH_STATUS=$(echo "$PATCH_OUT" | tail -1)
echo "PATCH /phase-event/999999999 → HTTP ${PATCH_STATUS} body: ${PATCH_BODY}"
if echo "${PATCH_BODY}" | node -e "
const b=require('fs').readFileSync(0,'utf8').trim();
if(b.includes('Cannot PATCH')){console.error('PATCH 路由未注册');process.exit(1);}
if(!b.includes('not found')){console.error('PATCH body 不含 not found: '+b);process.exit(1);}
" 2>/dev/null; then
  ok "PATCH /phase-event/:id 已挂载，返回 not found (HTTP ${PATCH_STATUS})"
else
  fail "PATCH /phase-event/:id 路由未注册或响应异常"
fi

echo ""
echo "smoke 结果：${PASS} 通过，${FAIL} 失败"
[ "$FAIL" = "0" ] && exit 0 || exit 1
