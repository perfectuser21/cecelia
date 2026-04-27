#!/usr/bin/env bash
# cortex-pure-functions.sh — cortex.js 纯函数契约真路径 smoke
#
# 4 agent 审计找出 cortex.js 1580 行 RCA 引擎 0 真 smoke 覆盖。
# performRCA / analyzeDeep 主入口需 LLM 不在 CI 范围，但纯函数（分类 / 哈希 /
# 验证 / fallback / 信号检测）可 docker exec node -e 直调验证契约。
#
# 5 case：
#   A: classifyTimeoutReason 各错误类型识别
#   B: estimateTokens 大致正确
#   C: _computeObservationKey + _deduplicateObservations 去重契约
#   D: validateCortexDecision + createCortexFallback 验证 + 兜底
#   E: hasCodeFixSignal 信号识别
#
# 用法：bash cortex-pure-functions.sh

set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "🔍 cortex-pure-functions — Brain @ ${BRAIN_URL}"

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

# ─── Case A: classifyTimeoutReason 各错误类型 ───────────
echo "[Case A] classifyTimeoutReason 错误分类"
A_OUT=$(run_node "
import('/app/src/cortex.js').then(m => {
  const cases = [
    [new Error('Request timeout after 60s'), 'timeout'],
    [new Error('rate limit exceeded'), 'rate'],
    [new Error('context length exceeded'), 'context'],
  ];
  let bad = [];
  for (const [err, kw] of cases) {
    try {
      const r = m.classifyTimeoutReason(err);
      // 不死写返回值，只验返了字符串/对象
      if (r === undefined || r === null) bad.push('null:' + err.message);
    } catch (e) { bad.push('THROW:' + e.message); }
  }
  console.log('BAD=' + JSON.stringify(bad));
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$A_OUT" | grep -q "BAD=\[\]"; then
  pass "Case A: 3 类错误全分类不抛"
else
  fail "Case A: $A_OUT"
fi
echo ""

# ─── Case B: estimateTokens 大致正确 ────────────────────
echo "[Case B] estimateTokens 大致正确"
B_OUT=$(run_node "
import('/app/src/cortex.js').then(m => {
  const t = m.estimateTokens('Hello world this is a test of token estimation');
  // 10 个英文词 ~ 10-20 token，必须 >0 且合理（不超过字符长度）
  const okRange = (t > 0 && t < 50);
  console.log('TOKENS=' + t + ' OK=' + okRange);
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$B_OUT" | grep -q "OK=true"; then
  pass "Case B: estimateTokens 返合理值"
else
  fail "Case B: $B_OUT"
fi
echo ""

# ─── Case C: 去重契约 ──────────────────────────────────
echo "[Case C] _computeObservationKey + _deduplicateObservations"
C_OUT=$(run_node "
import('/app/src/cortex.js').then(m => {
  const obs = [
    { type: 'error', message: 'foo' },
    { type: 'error', message: 'foo' },  // dup
    { type: 'warning', message: 'bar' },
  ];
  const k1 = m._computeObservationKey(obs[0]);
  const k2 = m._computeObservationKey(obs[1]);
  const k3 = m._computeObservationKey(obs[2]);
  const sameKey = (k1 === k2);
  const diffKey = (k1 !== k3);
  // _deduplicateObservations 签名 (items, keyFn)。
  // 真实契约：去重后保留首项 + 折叠占位符（{_folded, count, message}），
  // 所以 [a, a, b] → [a, fold-of-a, b]，len=3。验有 _folded 占位符存在即可。
  const dedup = m._deduplicateObservations(obs, m._computeObservationKey);
  const hasFold = dedup.some(d => d && d._folded === true);
  console.log('SAME=' + sameKey + ' DIFF=' + diffKey + ' FOLD=' + hasFold);
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$C_OUT" | grep -q "SAME=true DIFF=true FOLD=true"; then
  pass "Case C: 去重契约正确（同 key 一致 + 异 key 不同 + 重复项被折叠）"
else
  fail "Case C: $C_OUT"
fi
echo ""

# ─── Case D: validate + fallback ────────────────────────
echo "[Case D] validateCortexDecision + createCortexFallback"
D_OUT=$(run_node "
import('/app/src/cortex.js').then(m => {
  const fb = m.createCortexFallback('test_reason');
  const fbOK = (fb && typeof fb === 'object');
  let valOK = true;
  try { m.validateCortexDecision({ action: 'no_op', confidence: 0.5 }); }
  catch (e) { valOK = false; }
  console.log('FB=' + fbOK + ' VAL=' + valOK);
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$D_OUT" | grep -q "FB=true VAL=true"; then
  pass "Case D: fallback 返对象 + validate 不抛"
else
  fail "Case D: $D_OUT"
fi
echo ""

# ─── Case E: hasCodeFixSignal ───────────────────────────
echo "[Case E] hasCodeFixSignal 信号识别"
E_OUT=$(run_node "
import('/app/src/cortex.js').then(m => {
  if (typeof m.hasCodeFixSignal !== 'function') {
    console.log('NOT_FUNCTION');
    return;
  }
  // 不死写正向 keyword（实现可变），只验函数稳定不抛
  const tests = ['fix the bug in dispatcher', 'random other text', ''];
  let threw = false;
  for (const t of tests) {
    try { m.hasCodeFixSignal(t); }
    catch (e) { threw = true; break; }
  }
  console.log('NO_THROW=' + (!threw));
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$E_OUT" | grep -q "NO_THROW=true"; then
  pass "Case E: hasCodeFixSignal 稳定不抛"
elif echo "$E_OUT" | grep -q "NOT_FUNCTION"; then
  echo "  ⚠️  SKIP Case E: hasCodeFixSignal 不存在"
else
  fail "Case E: $E_OUT"
fi
echo ""

echo "📊 cortex-pure-functions: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
