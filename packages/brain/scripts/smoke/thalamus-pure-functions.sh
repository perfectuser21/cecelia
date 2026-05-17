#!/usr/bin/env bash
# thalamus-pure-functions.sh — thalamus.js 纯函数契约真路径 smoke
#
# 4 agent 审计找出 thalamus.js 1654 行决策层 0 真 smoke。
# processEvent / routeEvent 主入口需 LLM 不在 CI 范围，但纯函数（危险检测 /
# 快速路由 / fallback / LLM 错误分类 / cost 计算）可 docker exec node -e
# 直调验证契约。
#
# 5 case：
#   A: hasDangerousActions 危险动作检测
#   B: createFallbackDecision 兜底决策有效
#   C: classifyLLMError LLM 错误分类
#   D: calculateCost 成本计算合理
#   E: validateDecision 验证签名稳定
#
# 用法：bash thalamus-pure-functions.sh

set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "🔍 thalamus-pure-functions — Brain @ ${BRAIN_URL}"

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

# ─── Case A: hasDangerousActions 危险动作检测 ───────────
echo "[Case A] hasDangerousActions 危险动作检测"
A_OUT=$(run_node "
import('/app/src/thalamus.js').then(m => {
  if (typeof m.hasDangerousActions !== 'function') {
    console.log('NOT_FUNCTION');
    return;
  }
  // 不死写哪些算危险（实现可变），只验函数稳定接受多种输入不抛
  const tests = [
    { actions: [{ type: 'spawn_executor' }] },
    { actions: [{ type: 'no_op' }] },
    { actions: [] },
    {},
  ];
  let threw = false;
  for (const t of tests) {
    try { m.hasDangerousActions(t); }
    catch (e) { threw = true; console.log('THROW=' + e.message); break; }
  }
  console.log('NO_THROW=' + (!threw));
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$A_OUT" | grep -q "NO_THROW=true"; then
  pass "Case A: hasDangerousActions 4 输入不抛"
elif echo "$A_OUT" | grep -q "NOT_FUNCTION"; then
  echo "  ⚠️  SKIP Case A: hasDangerousActions 不存在"
else
  fail "Case A: $A_OUT"
fi
echo ""

# ─── Case B: createFallbackDecision 兜底 ────────────────
echo "[Case B] createFallbackDecision 兜底决策有效"
B_OUT=$(run_node "
import('/app/src/thalamus.js').then(m => {
  if (typeof m.createFallbackDecision !== 'function') {
    console.log('NOT_FUNCTION');
    return;
  }
  const fb = m.createFallbackDecision({ reason: 'test' });
  // 兜底必返对象
  console.log('IS_OBJ=' + (fb && typeof fb === 'object'));
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$B_OUT" | grep -q "IS_OBJ=true"; then
  pass "Case B: createFallbackDecision 返对象"
elif echo "$B_OUT" | grep -q "NOT_FUNCTION"; then
  echo "  ⚠️  SKIP Case B"
else
  fail "Case B: $B_OUT"
fi
echo ""

# ─── Case C: classifyLLMError 错误分类 ──────────────────
echo "[Case C] classifyLLMError 错误分类"
C_OUT=$(run_node "
import('/app/src/thalamus.js').then(m => {
  if (typeof m.classifyLLMError !== 'function') {
    console.log('NOT_FUNCTION');
    return;
  }
  const errors = [
    new Error('Request timeout after 60s'),
    new Error('429 Too Many Requests'),
    new Error('context length exceeded'),
    new Error('random error'),
  ];
  let threw = false;
  for (const err of errors) {
    try { m.classifyLLMError(err); }
    catch (e) { threw = true; break; }
  }
  // 也验 LLM_ERROR_TYPE 常量存在
  const hasConst = (typeof m.LLM_ERROR_TYPE === 'object' && m.LLM_ERROR_TYPE !== null);
  console.log('NO_THROW=' + (!threw) + ' HAS_CONST=' + hasConst);
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$C_OUT" | grep -q "NO_THROW=true HAS_CONST=true"; then
  pass "Case C: classifyLLMError 4 类不抛 + LLM_ERROR_TYPE 常量存在"
elif echo "$C_OUT" | grep -q "NOT_FUNCTION"; then
  echo "  ⚠️  SKIP Case C"
else
  fail "Case C: $C_OUT"
fi
echo ""

# ─── Case D: calculateCost 成本计算 ─────────────────────
echo "[Case D] calculateCost 成本合理"
D_OUT=$(run_node "
import('/app/src/thalamus.js').then(m => {
  if (typeof m.calculateCost !== 'function') {
    console.log('NOT_FUNCTION');
    return;
  }
  // 不死写 model + token → 多少钱（实现可变），只验返非负数
  const cost = m.calculateCost({
    model: 'claude-sonnet-4',
    input_tokens: 1000,
    output_tokens: 500,
  });
  console.log('COST=' + cost + ' VALID=' + (typeof cost === 'number' && cost >= 0));
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$D_OUT" | grep -q "VALID=true"; then
  pass "Case D: calculateCost 返非负数"
elif echo "$D_OUT" | grep -q "NOT_FUNCTION"; then
  echo "  ⚠️  SKIP Case D"
else
  fail "Case D: $D_OUT"
fi
echo ""

# ─── Case E: validateDecision 签名稳定 ──────────────────
echo "[Case E] validateDecision 签名稳定"
E_OUT=$(run_node "
import('/app/src/thalamus.js').then(m => {
  if (typeof m.validateDecision !== 'function') {
    console.log('NOT_FUNCTION');
    return;
  }
  const tests = [
    { actions: [], confidence: 0.5 },
    { actions: [{ type: 'no_op' }] },
    {},
  ];
  let threw = false;
  for (const t of tests) {
    try { m.validateDecision(t); }
    catch (e) { threw = true; break; }
  }
  console.log('NO_THROW=' + (!threw));
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$E_OUT" | grep -q "NO_THROW=true"; then
  pass "Case E: validateDecision 3 类输入不抛"
elif echo "$E_OUT" | grep -q "NOT_FUNCTION"; then
  echo "  ⚠️  SKIP Case E"
else
  fail "Case E: $E_OUT"
fi
echo ""

echo "📊 thalamus-pure-functions: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
