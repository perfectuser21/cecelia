#!/usr/bin/env bash
# warroom-smoke.sh
# 验收：战情室统一 feed 端点 GET /api/brain/warroom/feed 真环境可用
# 验证端点返回 200 + 响应含 stats / areas / total 结构（CI 空库也能通过——只验端点+结构）
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. GET /warroom/feed → 200（route 已挂载）
echo "── warroom feed 端点 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/warroom/feed")
[[ "$code" == "200" ]] \
  && ok "GET /warroom/feed → 200" \
  || fail "GET /warroom/feed → 期望 200，得 $code"

# 2. 响应结构含 stats / areas / total（用 node 解析校验，不依赖具体数据）
echo "── 响应结构 ──"
resp=$(curl -sf "$API/warroom/feed" 2>/dev/null) || resp=""
shape_ok=$(printf '%s' "$resp" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { const j=JSON.parse(s);
      const good = j && typeof j==="object"
        && j.stats && typeof j.stats.active==="number"
        && Array.isArray(j.areas)
        && typeof j.total==="number";
      process.stdout.write(good ? "1" : "0");
    } catch { process.stdout.write("0"); }
  });
' 2>/dev/null || echo 0)
[[ "$shape_ok" == "1" ]] \
  && ok "响应含 stats.active / areas[] / total" \
  || fail "响应结构不符（stats/areas/total 缺失）"

# 3. days 参数被接受（边界：合法查询不报 500）
echo "── days 查询参数 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/warroom/feed?days=1")
[[ "$code" == "200" ]] \
  && ok "GET /warroom/feed?days=1 → 200" \
  || fail "GET /warroom/feed?days=1 → 期望 200，得 $code"

echo "──────────────"
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
