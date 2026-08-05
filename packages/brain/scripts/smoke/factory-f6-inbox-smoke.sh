#!/usr/bin/env bash
# factory-f6-inbox-smoke.sh — 工厂 GP 五件套第一刀：F6 收件箱 最薄守卫
#
# ⚠️ 诚实声明（假绿灯纪律）：本闸为结构/契约级为主 + 少量运行时断言的最薄层。
#   - [结构] 断言只证明代码/注册表形态存在，不代表运行时行为已验证
#   - CI 环境 CECELIA_TICK_ENABLED=false：不断言任何"调度已真实执行"
#   - 决策 2a8bf656：工厂 journey 的 mvp 标签自此开始有机器背书，加厚走后续刀
# FIRE_TEST=1 为开发期自炸口（proven-to-fire 验证守卫非恒真），CI 不设。
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }
psql_q() { psql -qtAc "$1"; }

echo "== F6 收件箱：分诊表 + API + 调度注册表 =="

[ "$(psql_q "SELECT to_regclass('capture_atoms') IS NOT NULL")" = "t" ] && [ "$(psql_q "SELECT to_regclass('captures') IS NOT NULL")" = "t" ] \
  && ok "[运行时] capture_atoms 与 captures 表均存在" || fail "capture_atoms 或 captures 表缺失"

curl -fsm 10 "$BRAIN_URL/api/brain/capture-atoms" >/dev/null \
  && ok "[运行时] GET /api/brain/capture-atoms 可达" || fail "/api/brain/capture-atoms 不可达"

_inbox_jobs_ok=1
for j in capture-triage triage-officer-rank triage-officer-15min; do
  grep -q "$j" packages/brain/src/scheduler-jobs.js || _inbox_jobs_ok=0
done
[ "$_inbox_jobs_ok" = "1" ] \
  && ok "[结构] scheduler-jobs.js 含 capture-triage / triage-officer-rank / triage-officer-15min 三条" \
  || fail "scheduler-jobs.js 缺 inbox 三条调度任务之一"

if [ "${FIRE_TEST:-0}" = "1" ]; then
  fail "FIRE_TEST 自炸（proven-to-fire 验证口）"
fi

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
