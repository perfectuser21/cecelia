#!/usr/bin/env bash
# factory-f1-devloop-smoke.sh — 工厂 GP 五件套第一刀：F1 开发循环 最薄守卫
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

echo "== F1 开发循环：审查任务类型 SSOT + 调度事件 =="

node -e '
import("./packages/brain/src/lib/review-task-types.js").then(m=>{
  const a=m.REVIEW_TASK_TYPES;
  process.exit(Array.isArray(a)&&a.includes("code_review")&&a.includes("arch_review")?0:1)
}).catch(()=>process.exit(1))
' && ok "[结构] review-task-types.js REVIEW_TASK_TYPES 含 code_review/arch_review" || fail "REVIEW_TASK_TYPES 结构断言失败"

_devloop_ssot_ok=1
for f in packages/brain/src/executor.js packages/brain/src/callback-processor.js packages/brain/src/routes/execution.js; do
  grep -q "review-task-types" "$f" || _devloop_ssot_ok=0
done
[ "$_devloop_ssot_ok" = "1" ] \
  && ok "[结构] executor/callback-processor/execution 三处引用 review-task-types SSOT（防复制漂移）" \
  || fail "review-task-types SSOT 三处引用缺失（存在复制漂移风险）"

[ "$(psql_q "SELECT to_regclass('dispatch_events') IS NOT NULL")" = "t" ] \
  && ok "[运行时] dispatch_events 表存在" || fail "dispatch_events 表缺失"

grep -q "triggerCodexReview" packages/brain/src/executor.js && grep -q "requeueTask" packages/brain/src/executor.js \
  && ok "[结构] executor 含 triggerCodexReview 与 requeueTask" || fail "executor 缺 triggerCodexReview 或 requeueTask"

if [ "${FIRE_TEST:-0}" = "1" ]; then
  fail "FIRE_TEST 自炸（proven-to-fire 验证口）"
fi

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
