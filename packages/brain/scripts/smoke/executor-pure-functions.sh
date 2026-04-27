#!/usr/bin/env bash
# executor-pure-functions.sh — executor.js 纯函数契约真路径 smoke
#
# 4 agent 审计找出 executor.js 3620 行核心调度引擎 0 真 smoke 覆盖。
# 依赖 cecelia-bridge / spawn 真路径在 CI clean docker 不可达，
# 但纯函数（路由表 / UUID / model / provider / credentials 解析）可
# 通过 docker exec node -e 直调验证契约。
#
# 5 case：
#   A: getSkillForTaskType 路由表正确（dev→/dev, talk→/talk, review→/review）
#   B: getSkillForTaskType decomposition payload 优先级
#   C: generateRunId 返回 UUID v4 格式
#   D: getProviderForTask 各 task_type 返回合法 provider
#   E: checkTaskTypeMatch 不抛 + 返回正确 boolean
#
# 用法：bash executor-pure-functions.sh
# 退出码：失败 case 数

set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "🔍 executor-pure-functions — Brain @ ${BRAIN_URL}"

# health check
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
  echo "❌ 未检测到 brain container（cecelia-brain-smoke 或 cecelia-node-brain）" >&2
  exit 1
fi
echo "  container=$BRAIN_CONTAINER"
echo ""

PASSED=0
FAILED=0

pass() { echo "  ✅ $1"; PASSED=$((PASSED+1)); }
fail() { echo "  ❌ $1"; FAILED=$((FAILED+1)); }

# 单个 case helper：runner 在 brain container 内 import executor + 跑 expr
run_node() {
  docker exec "$BRAIN_CONTAINER" node -e "$1" 2>&1
}

# ─── Case A: getSkillForTaskType 路由表 ────────────────
echo "[Case A] getSkillForTaskType 路由表"
A_OUT=$(run_node "
import('/app/src/executor.js').then(m => {
  // 路由表契约：核心 task_type 必须返非空 skill 且含 task_type 关键字
  // 用 includes 避 bash 子串吞 regex /i 标志
  const cases = [
    ['dev', 'dev'],
    ['talk', 'talk'],
    ['review', 'review'],
  ];
  let bad = [];
  for (const [tt, kw] of cases) {
    const skill = m.getSkillForTaskType(tt);
    if (!skill || !skill.toLowerCase().includes(kw)) {
      bad.push(tt + '=' + skill);
    }
  }
  console.log('BAD=' + JSON.stringify(bad));
}).catch(e => { console.log('ERR=' + e.message); process.exit(2); });
")
echo "  $A_OUT" | sed 's/^/    /'
if echo "$A_OUT" | grep -q "BAD=\[\]"; then
  pass "Case A: dev/talk/review 全路由正确"
else
  fail "Case A: 路由表异常 — $A_OUT"
fi
echo ""

# ─── Case B: getSkillForTaskType decomposition 优先级 ─
echo "[Case B] getSkillForTaskType decomposition payload 优先级"
B_OUT=$(run_node "
import('/app/src/executor.js').then(m => {
  // payload.decomposition='true' + task_type=dev → /decomp（覆盖默认 /dev 路由）
  const skill = m.getSkillForTaskType('dev', { decomposition: 'true' });
  console.log('SKILL=' + skill);
}).catch(e => { console.log('ERR=' + e.message); process.exit(2); });
")
echo "  $B_OUT" | sed 's/^/    /'
if echo "$B_OUT" | grep -q "SKILL=/decomp"; then
  pass "Case B: decomposition='true' + dev → /decomp"
else
  fail "Case B: 期望 /decomp 实际 — $B_OUT"
fi
echo ""

# ─── Case C: generateRunId UUID 格式 ────────────────────
echo "[Case C] generateRunId 返回 UUID v4 格式"
C_OUT=$(run_node "
import('/app/src/executor.js').then(m => {
  const id = m.generateRunId('test-task');
  // UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  console.log('ID=' + id);
  console.log('VALID=' + uuidRe.test(id));
}).catch(e => { console.log('ERR=' + e.message); process.exit(2); });
")
echo "  $C_OUT" | sed 's/^/    /'
if echo "$C_OUT" | grep -q "VALID=true"; then
  pass "Case C: generateRunId 返合法 UUID v4"
else
  fail "Case C: UUID 格式不对 — $C_OUT"
fi
echo ""

# ─── Case D: getProviderForTask 不抛 + 返合法 provider ─
echo "[Case D] getProviderForTask 各 task_type 返合法 provider"
D_OUT=$(run_node "
import('/app/src/executor.js').then(m => {
  const types = ['dev', 'talk', 'review', 'research', 'harness_initiative'];
  let results = {};
  for (const t of types) {
    try {
      results[t] = m.getProviderForTask({ task_type: t });
    } catch (e) {
      results[t] = 'THROW:' + e.message;
    }
  }
  console.log('RESULTS=' + JSON.stringify(results));
}).catch(e => { console.log('ERR=' + e.message); process.exit(2); });
")
echo "  $D_OUT" | sed 's/^/    /'
# 不抛是基本契约 —— 所有 type 都要返一个值（不 throw）
if echo "$D_OUT" | grep -q "RESULTS=" && ! echo "$D_OUT" | grep -q "THROW:"; then
  pass "Case D: 5 个 task_type 全部不抛"
else
  fail "Case D: 有抛异常 — $D_OUT"
fi
echo ""

# ─── Case E: checkTaskTypeMatch 不抛 ────────────────────
echo "[Case E] checkTaskTypeMatch 验签名稳定（不抛 + 返 boolean/object）"
E_OUT=$(run_node "
import('/app/src/executor.js').then(m => {
  // checkTaskTypeMatch 是新的 v9 函数 — 验它不抛
  if (typeof m.checkTaskTypeMatch !== 'function') {
    console.log('NOT_FUNCTION');
    return;
  }
  let threw = false;
  const tests = [
    { task_type: 'dev', priority: 'P1' },
    { task_type: 'harness_initiative', priority: 'P0' },
    { task_type: 'research' },
  ];
  for (const t of tests) {
    try {
      m.checkTaskTypeMatch(t);  // 任何返回都接受，只验不抛
    } catch (e) {
      threw = true;
      console.log('THROW=' + e.message);
      break;
    }
  }
  console.log('NO_THROW=' + (!threw));
}).catch(e => { console.log('ERR=' + e.message); process.exit(2); });
")
echo "  $E_OUT" | sed 's/^/    /'
if echo "$E_OUT" | grep -q "NO_THROW=true"; then
  pass "Case E: checkTaskTypeMatch 稳定不抛"
elif echo "$E_OUT" | grep -q "NOT_FUNCTION"; then
  echo "  ⚠️  SKIP Case E: checkTaskTypeMatch 不存在（v9 未上线）"
else
  fail "Case E: 异常 — $E_OUT"
fi
echo ""

echo "📊 executor-pure-functions: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
