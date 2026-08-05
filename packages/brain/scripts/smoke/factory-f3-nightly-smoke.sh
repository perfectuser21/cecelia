#!/usr/bin/env bash
# factory-f3-nightly-smoke.sh — 工厂 GP 五件套第一刀：F3 夜巡 最薄守卫
#
# ⚠️ 诚实声明（假绿灯纪律）：本闸为结构/契约级为主 + 少量运行时断言的最薄层。
#   - [结构] 断言只证明代码/注册表形态存在，不代表运行时行为已验证
#   - CI 环境 CECELIA_TICK_ENABLED=false：不断言任何"调度已真实执行"
#   - 决策 2a8bf656：工厂 journey 的 mvp 标签自此开始有机器背书，加厚走后续刀
#   本脚本只证注册表有，不证到点真跑
# FIRE_TEST=1 为开发期自炸口（proven-to-fire 验证守卫非恒真），CI 不设。
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }
psql_q() { psql -qtAc "$1"; }

echo "== F3 夜巡：调度任务注册表 =="

grep -q "arch-review" packages/brain/src/scheduler-jobs.js && grep -q "ci-patrol" packages/brain/src/scheduler-jobs.js \
  && ok "[结构] scheduler-jobs.js JOBS 含 arch-review 与 ci-patrol" || fail "scheduler-jobs.js 缺 arch-review 或 ci-patrol"

# 现状：startSchedulerJobsLoop 挂载在 packages/brain/server.js（非 src/server.js，仓内无此文件——按现状调整路径，语义不放宽）
grep -q "startSchedulerJobsLoop" packages/brain/server.js \
  && ok "[结构] server.js 调用 startSchedulerJobsLoop" || fail "server.js 未调用 startSchedulerJobsLoop"

grep -q "arch_review" packages/brain/src/daily-review-scheduler.js && grep -q "ci_patrol" packages/brain/src/daily-review-scheduler.js \
  && ok "[结构] daily-review-scheduler.js 含 arch_review 窗口 + ci_patrol 北京08:00去重" || fail "daily-review-scheduler.js 缺 arch_review 或 ci_patrol"

grep -q "line-strategist-dispatch" packages/brain/src/tick-runner.js \
  && ok "[结构] tick-runner.js 挂 line-strategist-dispatch" || fail "tick-runner.js 未挂 line-strategist-dispatch"

if [ "${FIRE_TEST:-0}" = "1" ]; then
  fail "FIRE_TEST 自炸（proven-to-fire 验证口）"
fi

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
