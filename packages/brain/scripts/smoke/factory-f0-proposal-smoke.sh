#!/usr/bin/env bash
# factory-f0-proposal-smoke.sh — 工厂 GP 五件套第一刀：F0 提案 最薄守卫
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

echo "== F0 提案：golden_paths 蓝图实体 + 生命周期 =="

[ "$(psql_q "SELECT to_regclass('golden_paths') IS NOT NULL")" = "t" ] \
  && ok "[运行时] golden_paths 表存在" || fail "golden_paths 表缺失"

psql_q "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='golden_paths'::regclass AND contype='c'" | grep -q "candidate" \
  && ok "[运行时] golden_paths.status CHECK 含 candidate 生命周期态" || fail "golden_paths.status CHECK 未含 candidate"

[ "$(psql_q "SELECT count(*) FROM information_schema.columns WHERE table_name='golden_path' AND column_name='owner_task_id'")" = "1" ] \
  && ok "[运行时] golden_path（任务级台账）含 owner_task_id 列" || fail "golden_path.owner_task_id 列缺失"

curl -fsm 10 "$BRAIN_URL/api/brain/golden-paths" >/dev/null \
  && ok "[运行时] GET /api/brain/golden-paths 可达" || fail "/api/brain/golden-paths 不可达"

curl -fsm 10 "$BRAIN_URL/api/brain/decisions?limit=1" >/dev/null \
  && ok "[运行时] GET /api/brain/decisions?limit=1 可达" || fail "/api/brain/decisions 不可达"

grep -q "'/approve'\|/approve" packages/brain/src/routes/golden-paths.js && grep -q "/veto" packages/brain/src/routes/golden-paths.js \
  && ok "[结构] golden-paths 路由含 /approve + /veto" || fail "golden-paths 路由缺 /approve 或 /veto"

grep -q "golden_path_proposal" packages/brain/src/executor.js \
  && ok "[结构] executor 识别 golden_path_proposal 任务类型" || fail "executor 未识别 golden_path_proposal"

if [ "${FIRE_TEST:-0}" = "1" ]; then
  fail "FIRE_TEST 自炸（proven-to-fire 验证口）"
fi

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
