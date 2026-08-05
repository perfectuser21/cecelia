#!/usr/bin/env bash
# factory-f4-selfheal-smoke.sh — 工厂 GP 五件套第一刀：F4 故障自愈 最薄守卫
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

echo "== F4 故障自愈：liveness 合同层 =="
node -e '
import("./packages/brain/src/executor-contracts.js").then(m => {
  if (!Array.isArray(m.VALID_EXECUTOR_KINDS) || m.VALID_EXECUTOR_KINDS.length !== 7)
    { console.error("VALID_EXECUTOR_KINDS 应为 7 kind，实际 " + m.VALID_EXECUTOR_KINDS.length); process.exit(1); }
  for (const k of m.VALID_EXECUTOR_KINDS) {
    const c = m.EXECUTOR_CONTRACTS[k];
    if (!c || typeof c.probe !== "function") { console.error("kind 缺 probe: " + k); process.exit(1); }
  }
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); })
' && ok "[结构] executor-contracts 七 kind 各有 probe（进程级导入）" || fail "executor-contracts 结构断言失败"

node -e '
import("./packages/brain/src/lib/codex-review-liveness.js").then(m => {
  if (typeof m.probeCodexReviewLock !== "function" || !m.CODEX_REVIEW_LOCK_DIR) process.exit(1);
  process.exit(0);
}).catch(() => process.exit(1))
' && ok "[结构] codex-review-liveness SSOT 导出完整" || fail "codex-review-liveness SSOT 缺失"

grep -q "codex-review-liveness" packages/brain/src/executor-contracts.js \
  && ok "[结构] 合同层引用 lock SSOT" || fail "合同层未引用 lock SSOT"

[ "$(psql_q "SELECT to_regclass('circuit_breaker_states') IS NOT NULL")" = "t" ] \
  && ok "[运行时] circuit_breaker_states 表存在" || fail "circuit_breaker_states 表缺失"

curl -fsm 10 "$BRAIN_URL/api/brain/health" | node -e '
let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{ const j=JSON.parse(d); process.exit(j.organs?0:1); })
' && ok "[运行时] /health 200 且含 organs" || fail "/health 断言失败"

grep -q "requeueTask" packages/brain/src/executor.js \
  && ok "[结构] executor 含 requeueTask（回队出路）" || fail "requeueTask 缺失"

if [ "${FIRE_TEST:-0}" = "1" ]; then
  fail "FIRE_TEST 自炸（proven-to-fire 验证口）"
fi

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
