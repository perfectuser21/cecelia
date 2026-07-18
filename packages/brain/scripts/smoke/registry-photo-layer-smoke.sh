#!/usr/bin/env bash
# registry-photo-layer-smoke.sh — 照相层复活验收(刀0,2026-07-18)
#
# 验收项：GET /api/brain/registry?type=api|db_schema|test 返回 { items, freshness } 包装形状，
# 而非旧 system_registry 原始数组；freshness.stale 字段必须存在（哨兵基础）。
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
MAX_WAIT_SEC="${SMOKE_MAX_WAIT_SEC:-30}"

PASS=0
FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "── registry-photo-layer-smoke — Brain @ ${BRAIN_URL} ──"

# 等待 Brain 就绪（等待预算内轮询 /health）
waited=0
until curl -sf "${BRAIN_URL}/api/brain/health" >/dev/null 2>&1; do
  waited=$((waited+2))
  if [ "$waited" -ge "$MAX_WAIT_SEC" ]; then
    echo "FAIL: Brain 在 ${MAX_WAIT_SEC}s 内未就绪 (${BRAIN_URL})"
    exit 1
  fi
  sleep 2
done

check_type() {
  local type="$1"
  local resp
  resp=$(curl -sf "${BRAIN_URL}/api/brain/registry?type=${type}&limit=3" 2>/dev/null || echo "")
  if [ -z "$resp" ]; then
    fail "type=${type} 请求失败"
    return
  fi
  if echo "$resp" | node -e "
    let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
      let j;
      try { j = JSON.parse(d); } catch (e) { console.error('FAIL: 非法 JSON'); process.exit(1); }
      if(!Array.isArray(j.items)) { console.error('FAIL: items 不是数组'); process.exit(1); }
      if(!('stale' in (j.freshness||{}))) { console.error('FAIL: freshness.stale 缺失'); process.exit(1); }
      console.log('OK: photo-layer 包装形状正确');
    })"; then
    ok "type=${type} 包装形状正确 (items[] + freshness.stale)"
  else
    fail "type=${type} 包装形状异常"
  fi
}

check_type "api"
check_type "db_schema"
check_type "test"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部通过"
  exit 0
else
  echo "❌ 有 $FAIL 项失败"
  exit 1
fi
