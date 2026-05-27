#!/usr/bin/env bash
# smoke test: POST /api/brain/harness/complete + POST /api/brain/harness/notify
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

# 1. /harness/complete 缺 initiative_id → 400
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/harness/complete" \
  -H "Content-Type: application/json" -d '{}' 2>/dev/null || echo "000")
[ "$STATUS" = "400" ] && ok "/harness/complete 无 initiative_id → 400" || fail "/harness/complete 无 initiative_id → $STATUS（期望 400）"

# 2. /harness/complete 正常请求 → 200
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/harness/complete" \
  -H "Content-Type: application/json" \
  -d '{"initiative_id":"smoke-test-initiative","pr_url":"https://github.com/org/repo/pull/1"}' 2>/dev/null || echo "000")
[ "$STATUS" = "200" ] && ok "/harness/complete 正常请求 → 200" || fail "/harness/complete 正常 → $STATUS（期望 200）"

# 3. /harness/notify 缺 type → 400
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/harness/notify" \
  -H "Content-Type: application/json" -d '{"title":"test"}' 2>/dev/null || echo "000")
[ "$STATUS" = "400" ] && ok "/harness/notify 无 type → 400" || fail "/harness/notify 无 type → $STATUS（期望 400）"

# 4. /harness/notify harness_complete → 200（飞书可能静音，但端点必须存在）
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/harness/notify" \
  -H "Content-Type: application/json" \
  -d '{"type":"harness_complete","title":"smoke test 完成","initiative_id":"smoke-test-initiative"}' 2>/dev/null || echo "000")
[ "$STATUS" = "200" ] && ok "/harness/notify harness_complete → 200" || fail "/harness/notify harness_complete → $STATUS（期望 200）"

# 5. /harness/notify general → 200
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/harness/notify" \
  -H "Content-Type: application/json" \
  -d '{"type":"general","title":"smoke 普通通知","message":"test"}' 2>/dev/null || echo "000")
[ "$STATUS" = "200" ] && ok "/harness/notify general → 200" || fail "/harness/notify general → $STATUS（期望 200）"

echo ""
echo "smoke 结果：${PASS} 通过，${FAIL} 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
