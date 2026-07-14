#!/usr/bin/env bash
# kv-route-smoke.sh — Brain KV 路由（/api/brain/kv/:key）真链路守卫
#
# 断言：
#   A GET 不存在的 key → 404
#   B POST 写入        → 200 {ok:true}
#   C GET 存在的 key   → 200 含 value
#
# 用法：bash scripts/smoke/kv-route-smoke.sh [BRAIN_URL]
# 退出码：0=全绿  1=有红

set -uo pipefail

BRAIN="${1:-http://localhost:5221}"

# skip guard：真 Brain 不在（或只是 stub/健康检查非 healthy）→ SKIP 不 FAIL
# （根池 smoke 惯例：放行闸等无 Brain 的 job 也会全量跑根池脚本）
HEALTH=$(curl -s -m 3 "$BRAIN/api/brain/health" 2>/dev/null) || HEALTH=""
if ! echo "$HEALTH" | grep -q '"status":"healthy"'; then
  echo "[smoke:kv-route] SKIP — $BRAIN 无真实 Brain（health: ${HEALTH:-不可达}）"
  exit 0
fi

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILED=0
pass() { echo -e "${GREEN}[OK]${NC} $1"; }
fail() { echo -e "${RED}[X]${NC} $1"; FAILED=$((FAILED + 1)); }

echo "=== Brain KV 路由 smoke (${BRAIN}) ==="
echo ""

TEST_KEY="smoke-kv-test-$(date +%s)"
TEST_VAL='{"smoke":true,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}'

# ── A: GET 不存在的 key → 404 ─────────────────────────────────────────
echo "── A: GET 不存在 key → 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "$BRAIN/api/brain/kv/$TEST_KEY")
if [[ "${STATUS}" == "404" ]]; then
  pass "GET 不存在 key 返回 404（实际: ${STATUS}）"
else
  fail "期望 404，实际: ${STATUS}"
fi
echo ""

# ── B: POST 写入 → 200 ok=true ────────────────────────────────────────
echo "── B: POST 写入"
RESP=$(curl -s -m 5 -X POST "$BRAIN/api/brain/kv/$TEST_KEY" \
  -H "Content-Type: application/json" \
  -d "$TEST_VAL")
if echo "${RESP}" | grep -q '"ok":true'; then
  pass "POST 写入成功（ok=true）"
else
  fail "POST 写入失败: ${RESP}"
fi
echo ""

# ── C: GET 存在的 key → 200 含 value ──────────────────────────────────
echo "── C: GET 刚写入的 key"
GRESP=$(curl -s -m 5 "$BRAIN/api/brain/kv/$TEST_KEY")
if echo "${GRESP}" | grep -q '"value"'; then
  pass "GET 返回含 value 字段"
else
  fail "GET 响应格式异常: ${GRESP}"
fi
echo ""

# ── 清理 ───────────────────────────────────────────────────────────────
# 不清理（smoke key 会留在 working_memory，定期 janitor 清）

# ── 总结 ───────────────────────────────────────────────────────────────
echo "────────────────────────────────────"
if [[ ${FAILED} -eq 0 ]]; then
  echo -e "${GREEN}=== 全绿 ✅ ===${NC}"
  exit 0
else
  echo -e "${RED}=== ${FAILED} 条失败 ❌ ===${NC}"
  exit 1
fi
