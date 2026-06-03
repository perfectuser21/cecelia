#!/usr/bin/env bash
# routing-phase2-smoke.sh
# 验收（phase 2）：机器+执行器显式 override 路由真行为
#   1. GET /api/brain/machines 端点存活（DB 设备表可读；无 live Brain 时优雅跳过 exit 0）
#   2. node 跑 resolveExecutor 显式 {machine:'xian-m4', executor:'codex'} → url 含 13458
#      （triggerCeceliaRun 单元1 override 分支据此调 triggerCodexBridge(task, route.url)）
#   3. node 跑 resolveExecutor 非法显式组合 → 抛 ExecutorRouteError（loud-fail，不静默改派）
#   4. 死代码回归：executor.js 不再导出 MACHINE_REGISTRY / selectBestMachine
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_ROOT="$(cd "$HERE/../.." && pwd)"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

# ── 1. machines 端点存活（无 live Brain → 优雅跳过，不算失败）────────────
echo "── GET /api/brain/machines ──"
code=$(curl -s -o /dev/null -m 5 -w "%{http_code}" "$API/machines" 2>/dev/null || echo "000")
if [[ "$code" == "000" ]]; then
  echo "⏭️  无 live Brain（curl $API/machines 不可达），跳过端点检查（CI 离线友好）"
elif [[ "$code" == "200" ]]; then
  ok "GET /machines → 200（machines 设备表端点存活）"
else
  fail "GET /machines → 期望 200，得 $code"
fi

# ── 2. resolveExecutor 显式 codex 路由 → url 含 13458 ───────────────────
echo "── node: resolveExecutor 显式 {xian-m4, codex} ──"
node --input-type=module -e "
import { resolveExecutor } from '$BRAIN_ROOT/src/routing/resolve-executor.js';
const machines = [{
  name: 'xian-m4', status: 'active',
  metadata: { tags: ['general'], executors: [
    { executor: 'codex', url: 'http://host.docker.internal:13458', default: true },
  ] },
}];
const deps = { loadMachines: async () => machines, taskRequirements: {}, selectLoadBalanced: async (c) => c[0] };
const route = await resolveExecutor({ task_type: 'dev', payload: { machine: 'xian-m4', executor: 'codex' } }, deps);
if (route.executor !== 'codex') { console.error('executor != codex:', route.executor); process.exit(1); }
if (!String(route.url).includes('13458')) { console.error('url 不含 13458:', route.url); process.exit(1); }
console.log('route ok:', JSON.stringify(route));
" && ok "resolveExecutor 显式 codex → url 含 13458（codex daemon）" \
  || fail "resolveExecutor 显式 codex 路由失败"

# ── 3. resolveExecutor 非法显式组合 → 抛 ExecutorRouteError（loud-fail）──
echo "── node: resolveExecutor 非法组合 → 抛错 ──"
node --input-type=module -e "
import { resolveExecutor, ExecutorRouteError } from '$BRAIN_ROOT/src/routing/resolve-executor.js';
const machines = [{
  name: 'xian-m4', status: 'active',
  metadata: { tags: ['general'], executors: [{ executor: 'codex', url: 'http://host.docker.internal:13458', default: true }] },
}];
const deps = { loadMachines: async () => machines, taskRequirements: {}, selectLoadBalanced: async (c) => c[0] };
try {
  await resolveExecutor({ task_type: 'dev', payload: { machine: 'xian-m4', executor: 'claude' } }, deps);
  console.error('期望抛 ExecutorRouteError 但没抛'); process.exit(1);
} catch (err) {
  if (!(err instanceof ExecutorRouteError)) { console.error('错误类型不对:', err.name); process.exit(1); }
  console.log('正确抛 ExecutorRouteError:', err.message);
}
" && ok "resolveExecutor 非法组合 → ExecutorRouteError（不静默改派）" \
  || fail "resolveExecutor 非法组合未正确抛错"

# ── 4. 死代码回归：executor.js 不再导出 MACHINE_REGISTRY/selectBestMachine ─
echo "── node: executor 不再导出死代码 ──"
node --input-type=module -e "
import * as ex from '$BRAIN_ROOT/src/executor.js';
const dead = ['MACHINE_REGISTRY', 'selectBestMachine'].filter((k) => ex[k] !== undefined);
if (dead.length) { console.error('仍导出死代码:', dead.join(',')); process.exit(1); }
console.log('死代码已删除');
" >/dev/null 2>&1 && ok "executor.js 不再导出 MACHINE_REGISTRY/selectBestMachine" \
  || fail "executor.js 仍导出死代码（或加载失败）"

echo ""
echo "── 结果：PASS=$PASS FAIL=$FAIL ──"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
