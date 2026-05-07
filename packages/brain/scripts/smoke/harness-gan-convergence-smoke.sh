#!/usr/bin/env bash
# harness-gan-convergence-smoke.sh — GAN 收敛检测真路径 smoke
#
# 验证 packages/brain/src/workflows/harness-gan.graph.js 的 detectConvergenceTrend
# 纯函数在真容器里能 import + 跑出预期 4 个返回值，且 MAX_ROUNDS 已彻底删除。
#
# 与单测互补：单测在 vitest 沙箱里 mock；smoke 在真 brain image 里
# 用 docker exec node -e 直接 import ESM module，验证文件能被 Node ESM 加载。
#
# 4 case：
#   A: detectConvergenceTrend([]) → 'insufficient_data'
#   B: 5 维度持平上升 → 'converging'
#   C: 任一维度连续走低 → 'diverging'
#   D: ARTIFACT — module 不再 export MAX_ROUNDS
#
# 用法：bash harness-gan-convergence-smoke.sh

set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "🔍 harness-gan-convergence-smoke — Brain @ ${BRAIN_URL}"

if ! curl -sf -m 5 "${BRAIN_URL}/api/brain/tick/status" >/dev/null 2>&1; then
  echo "❌ Brain not healthy at ${BRAIN_URL}" >&2
  exit 1
fi

BRAIN_CONTAINER="${BRAIN_CONTAINER:-}"
if [ -z "$BRAIN_CONTAINER" ]; then
  for c in cecelia-brain-smoke cecelia-node-brain; do
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$c"; then
      BRAIN_CONTAINER="$c"; break
    fi
  done
fi
if [ -z "$BRAIN_CONTAINER" ]; then
  echo "❌ 未检测到 brain container" >&2
  exit 1
fi
echo "  container=$BRAIN_CONTAINER"
echo ""

PASSED=0
FAILED=0
pass() { echo "  ✅ $1"; PASSED=$((PASSED+1)); }
fail() { echo "  ❌ $1"; FAILED=$((FAILED+1)); }
run_node() { docker exec "$BRAIN_CONTAINER" node -e "$1" 2>&1; }

# ─── Case A: insufficient_data ─────────────────────────────
echo "[Case A] detectConvergenceTrend([]) → insufficient_data"
A_OUT=$(run_node "
import('/app/src/workflows/harness-gan.graph.js').then(m => {
  const r = m.detectConvergenceTrend([]);
  console.log('TREND=' + r);
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$A_OUT" | grep -q "TREND=insufficient_data"; then
  pass "Case A: 空 history → insufficient_data"
else
  fail "Case A: $A_OUT"
fi
echo ""

# ─── Case B: converging ────────────────────────────────────
echo "[Case B] 5 维度持平上升 → converging"
B_OUT=$(run_node "
import('/app/src/workflows/harness-gan.graph.js').then(m => {
  const hist = [
    { round: 1, scores: { dod_machineability: 5, scope_match_prd: 5, test_is_red: 5, internal_consistency: 5, risk_registered: 5 } },
    { round: 2, scores: { dod_machineability: 6, scope_match_prd: 6, test_is_red: 5, internal_consistency: 6, risk_registered: 6 } },
    { round: 3, scores: { dod_machineability: 7, scope_match_prd: 7, test_is_red: 6, internal_consistency: 7, risk_registered: 7 } },
  ];
  console.log('TREND=' + m.detectConvergenceTrend(hist));
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$B_OUT" | grep -q "TREND=converging"; then
  pass "Case B: 上升趋势 → converging"
else
  fail "Case B: $B_OUT"
fi
echo ""

# ─── Case C: diverging ─────────────────────────────────────
echo "[Case C] 一维连续走低 → diverging"
C_OUT=$(run_node "
import('/app/src/workflows/harness-gan.graph.js').then(m => {
  const hist = [
    { round: 1, scores: { dod_machineability: 8, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
    { round: 2, scores: { dod_machineability: 7, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
    { round: 3, scores: { dod_machineability: 6, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
  ];
  console.log('TREND=' + m.detectConvergenceTrend(hist));
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$C_OUT" | grep -q "TREND=diverging"; then
  pass "Case C: 持续走低 → diverging"
else
  fail "Case C: $C_OUT"
fi
echo ""

# ─── Case D: MAX_ROUNDS 已删除 ─────────────────────────────
echo "[Case D] ARTIFACT — module 不再 export MAX_ROUNDS"
D_OUT=$(run_node "
import('/app/src/workflows/harness-gan.graph.js').then(m => {
  const has = (typeof m.MAX_ROUNDS !== 'undefined');
  console.log('HAS_MAX_ROUNDS=' + has);
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$D_OUT" | grep -q "HAS_MAX_ROUNDS=false"; then
  pass "Case D: MAX_ROUNDS export 已删除"
else
  fail "Case D: $D_OUT"
fi
echo ""

echo "📊 harness-gan-convergence-smoke: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
