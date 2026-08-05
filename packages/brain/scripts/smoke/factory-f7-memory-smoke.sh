#!/usr/bin/env bash
# factory-f7-memory-smoke.sh — 工厂 GP 五件套第一刀：F7 记忆 最薄守卫
#
# ⚠️ 诚实声明（假绿灯纪律）：本闸为结构/契约级为主 + 少量运行时断言的最薄层。
#   - [结构] 断言只证明代码/注册表形态存在，不代表运行时行为已验证
#   - CI 环境 CECELIA_TICK_ENABLED=false：不断言任何"调度已真实执行"
#   - 决策 2a8bf656：工厂 journey 的 mvp 标签自此开始有机器背书，加厚走后续刀
#   Notion 真推送无凭据不验证
# FIRE_TEST=1 为开发期自炸口（proven-to-fire 验证守卫非恒真），CI 不设。
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }
psql_q() { psql -qtAc "$1"; }

echo "== F7 记忆：工作记忆表 + Notion 推送 SSOT =="

[ "$(psql_q "SELECT to_regclass('working_memory') IS NOT NULL")" = "t" ] && [ "$(psql_q "SELECT to_regclass('memory_stream') IS NOT NULL")" = "t" ] \
  && ok "[运行时] working_memory 与 memory_stream 表均存在" || fail "working_memory 或 memory_stream 表缺失"

grep -q "runNotionPushSync" packages/brain/src/notion-push-sync.js && grep -q "buildDecisionNotionProperties" packages/brain/src/notion-push-sync.js \
  && ok "[结构] notion-push-sync.js 导出 runNotionPushSync + buildDecisionNotionProperties" || fail "notion-push-sync.js 缺 runNotionPushSync 或 buildDecisionNotionProperties"

if [ "${FIRE_TEST:-0}" = "1" ]; then
  fail "FIRE_TEST 自炸（proven-to-fire 验证口）"
fi

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
