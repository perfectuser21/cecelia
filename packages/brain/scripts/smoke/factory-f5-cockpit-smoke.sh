#!/usr/bin/env bash
# factory-f5-cockpit-smoke.sh — 工厂 GP 五件套第一刀：F5 驾驶舱 最薄守卫
#
# ⚠️ 诚实声明（假绿灯纪律）：本闸为结构/契约级为主 + 少量运行时断言的最薄层。
#   - [结构] 断言只证明代码/注册表形态存在，不代表运行时行为已验证
#   - CI 环境 CECELIA_TICK_ENABLED=false：不断言任何"调度已真实执行"
#   - 决策 2a8bf656：工厂 journey 的 mvp 标签自此开始有机器背书，加厚走后续刀
#   前端渲染不在本闸
# FIRE_TEST=1 为开发期自炸口（proven-to-fire 验证守卫非恒真），CI 不设。
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }
psql_q() { psql -qtAc "$1"; }

echo "== F5 驾驶舱：/health + /healthz 聚合视图 =="

curl -fsm 10 "$BRAIN_URL/api/brain/health" | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.exit(j.organs&&j.organs.scheduler&&j.organs.circuit_breaker?0:1)})
' && ok "[运行时] /health 200 且 organs 含 scheduler/circuit_breaker 子键" || fail "/health organs 断言失败"

curl -fsm 10 "$BRAIN_URL/api/brain/healthz" | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.exit(["ok","degraded","critical"].includes(j.status)?0:1)})
' && ok "[运行时] /healthz status ∈ {ok, degraded, critical}" || fail "/healthz status 断言失败"

if [ "${FIRE_TEST:-0}" = "1" ]; then
  fail "FIRE_TEST 自炸（proven-to-fire 验证口）"
fi

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
