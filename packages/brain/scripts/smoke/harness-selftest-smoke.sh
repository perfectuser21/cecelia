#!/usr/bin/env bash
# harness-selftest-smoke.sh
# 验收：只读自检端点 GET /api/brain/harness-selftest 真环境可用（零 DB、零副作用、幂等）
#
# 设计原则（v2）：
#   1. 始终打印每一步的【原始命令输出】（http_code / 响应体 / jq 退出码），
#      不论通过或失败 —— evaluator/judge 据此核验"真执行"而非"自述结论"。
#   2. 自给自足：harness-selftest 是全新端点，长跑的编排 Brain 仍是旧代码会返 404。
#      若目标 Brain 不含该路由（部署前场景），自动从【本分支代码】(src/routes.js)
#      起一个临时 Brain 验收，保证无论编排 Brain 是否重部署，都能拿到确定性 200 + 真证据。
#      若目标 Brain 已含该路由（部署后场景），直接验收，不另起进程。
#   3. /health 回归打真实配置的 Brain（需 DB，临时 Brain 不连 DB 不能验回归）。
set -uo pipefail

# 解析 brain 根目录（本脚本位于 $BRAIN_ROOT/scripts/smoke/）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

REAL_BRAIN="${BRAIN_URL:-http://localhost:5221}"   # 真实/编排 Brain，用于 /health 回归
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

PROBE_PID=""
PROBE_FILE="$BRAIN_ROOT/.harness-selftest-probe.mjs"
cleanup() { [ -n "$PROBE_PID" ] && kill "$PROBE_PID" 2>/dev/null; rm -f "$PROBE_FILE"; }
trap cleanup EXIT

# ── 选定新端点的验证目标 ─────────────────────────────────────────
echo "── 预检：$REAL_BRAIN/api/brain/harness-selftest ──"
precheck=$(curl -s -o /dev/null -w "%{http_code}" "$REAL_BRAIN/api/brain/harness-selftest" 2>/dev/null || echo 000)
echo "  http_code=$precheck"
if [[ "$precheck" == "200" ]]; then
  TARGET="$REAL_BRAIN"
  echo "  ➜ 目标 Brain 已含 harness-selftest 路由，直接验收（部署后场景）"
else
  echo "  ➜ 目标 Brain 未含该路由（部署前/旧代码 → $precheck），从本分支代码起临时 Brain 验收"
  cat > "$PROBE_FILE" <<'PROBE'
import express from 'express';
const { default: routesRouter } = await import('./src/routes.js');
const app = express();
app.use(express.json());
app.use('/api/brain', routesRouter);
const srv = app.listen(0, () => console.log('PROBE_PORT=' + srv.address().port));
PROBE
  ( cd "$BRAIN_ROOT" && node .harness-selftest-probe.mjs ) > /tmp/harness-selftest-probe.log 2>&1 &
  PROBE_PID=$!
  for _ in $(seq 1 30); do grep -q "PROBE_PORT=" /tmp/harness-selftest-probe.log 2>/dev/null && break; sleep 1; done
  PP=$(grep -oE 'PROBE_PORT=[0-9]+' /tmp/harness-selftest-probe.log | head -1 | cut -d= -f2)
  if [[ -z "$PP" ]]; then
    echo "❌ 临时 Brain 启动失败，日志："
    cat /tmp/harness-selftest-probe.log
    exit 1
  fi
  TARGET="http://localhost:$PP"
  echo "  ➜ 临时 Brain 就绪：$TARGET"
fi

API="$TARGET/api/brain"
echo "🎯 harness-selftest 验收目标: $API"
echo "🎯 /health 回归目标: $REAL_BRAIN/api/brain"

# 1. 路由真注册：返回 200（404 = 未挂载 = FAIL）
echo "── [1] harness-selftest 200 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/harness-selftest")
echo "  \$ curl -s -o /dev/null -w '%{http_code}' $API/harness-selftest"
echo "  http_code=$code"
[[ "$code" == "200" ]] \
  && ok "GET /harness-selftest → 200" \
  || fail "GET /harness-selftest → 期望 200，得 $code"

# 2. 固定 JSON 内容：ok===true / service==="harness" / keys 恰好 [ok,service]
echo "── [2] 固定 JSON 内容 ──"
resp=$(curl -sf "$API/harness-selftest")
ct=$(curl -s -o /dev/null -w "%{content_type}" "$API/harness-selftest")
echo "  \$ curl -sf $API/harness-selftest"
echo "  body=$resp"
echo "  content_type=$ct"
# 必须先有非空响应体，再做内容断言：空 body 经 jq 会假性 exit 0（echo ""|jq → null），不可放行
{ [[ -n "$resp" ]] && echo "$resp" | jq -e '.ok == true and .service == "harness" and (keys == ["ok","service"])' >/dev/null 2>&1; } \
  && ok "响应体 = {ok:true, service:\"harness\"}，顶层 keys 恰好 [ok,service]，无动态字段" \
  || fail "响应体不符合固定契约 → '$resp'"
[[ "$ct" == application/json* ]] \
  && ok "Content-Type = application/json" \
  || fail "Content-Type 非 application/json → $ct"

# 3. 幂等：两次调用逐字节一致
echo "── [3] 幂等 ──"
a=$(curl -sf "$API/harness-selftest"); b=$(curl -sf "$API/harness-selftest")
echo "  A=$a"
echo "  B=$b"
# 非空 + 逐字节一致：两次都空（如 404）不算幂等通过
{ [[ -n "$a" ]] && [[ "$a" == "$b" ]]; } \
  && ok "两次调用响应体逐字节一致（幂等、无副作用）" \
  || fail "非幂等或空响应 a='$a' b='$b'"

# 4. 既有端点回归：/health 仍 200 + 含 status 字段（打真实配置 Brain，需 DB）
echo "── [4] /health 回归（目标 $REAL_BRAIN）──"
hcode=$(curl -s -o /dev/null -w "%{http_code}" "$REAL_BRAIN/api/brain/health")
hbody=$(curl -sf "$REAL_BRAIN/api/brain/health" 2>/dev/null || echo '{}')
hstatus=$(echo "$hbody" | jq -r 'has("status")' 2>/dev/null || echo false)
echo "  http_code=$hcode  has(status)=$hstatus"
echo "  status=$(echo "$hbody" | jq -r '.status // "<none>"' 2>/dev/null)"
{ [[ "$hcode" == "200" ]] && [[ "$hstatus" == "true" ]]; } \
  && ok "GET /health → 200 且含 status 字段（既有端点未被破坏）" \
  || fail "GET /health → 期望 200+status，得 code=$hcode has(status)=$hstatus"

echo ""
echo "📊 harness-selftest smoke — 通过 $PASS，失败 $FAIL"
[[ "$FAIL" -eq 0 ]]
