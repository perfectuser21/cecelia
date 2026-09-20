#!/usr/bin/env bash
#
# openclaw-runner-pool-smoke.sh — codex 跑场池选机的机械守卫
#
# 锁死一条铁律：**MMV 不能参与 codex 的常规竞争**。
# 理由：Claude 与 Grok 的凭据只在 MMV，OpenClaw 用 auth.profiles 的 token 直连
# （clawdbot.json: xai:manual / anthropic:manual）——MMV 是这两家唯一的执行机。
# 而 codex 走 agentRuntime → ssh 到 session-runner 跑 CLI，哪台机都行。
# 谁要是把 MMV 改回 codex-primary，codex 就又会回去和 Claude/Grok 抢窝。
#
# 本脚本不碰真机（CI 里没有到 M4/M1 的 ssh），只做纯静态 + 单测校验。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
GUARDS="$REPO_ROOT/packages/brain/src/openclaw-guards.js"

fail() { echo "❌ $1" >&2; exit 1; }

echo "[openclaw-runner-pool-smoke] 1. 源文件存在且导出选机 API"
[ -f "$GUARDS" ] || fail "openclaw-guards.js 不存在: $GUARDS"
grep -q 'export const RUNNERS' "$GUARDS" || fail "RUNNERS 未导出（机械校验需要它可被外部引用）"
grep -q 'export function pickRunner' "$GUARDS" || fail "pickRunner 未导出"
grep -q 'export function parseRunnerLoad' "$GUARDS" || fail "parseRunnerLoad 未导出"
echo "  ✓ RUNNERS / pickRunner / parseRunnerLoad 均已导出"

echo "[openclaw-runner-pool-smoke] 2. 角色分配：M4/M1 主力，MMV 仅兜底"
node --input-type=module -e "
import { RUNNERS, pickRunner } from '$GUARDS';
const by = Object.fromEntries(RUNNERS.map((r) => [r.name, r]));
for (const n of ['XIAN-M4', 'XIAN-M1', 'MMV']) {
  if (!by[n]) { console.error('跑场池缺少 ' + n); process.exit(1); }
}
if (by['XIAN-M4'].role !== 'codex-primary') { console.error('XIAN-M4 必须是 codex-primary'); process.exit(1); }
if (by['XIAN-M1'].role !== 'codex-primary') { console.error('XIAN-M1 必须是 codex-primary'); process.exit(1); }
if (by['MMV'].role !== 'fallback') { console.error('MMV 必须是 fallback —— 它要留给 Claude/Grok'); process.exit(1); }
console.log('  ✓ 角色分配正确');
" || fail "角色分配校验未通过"

echo "[openclaw-runner-pool-smoke] 3. MMV 再闲也不被选去干 codex 的活"
node --input-type=module -e "
import { pickRunner } from '$GUARDS';
// MMV 全场最闲，两台主力都很忙 —— 仍然不许选 MMV
const loadFn = (t) => (t.includes('100.71.151.105')
  ? { codexSessions: 0, load1: 0 }
  : { codexSessions: 99, load1: 50 });
const picked = pickRunner(() => true, { loadFn });
if (!picked) { console.error('三台都活着却没选出跑场'); process.exit(1); }
if (picked.name === 'MMV') { console.error('MMV 被选中 —— 它会和 Claude/Grok 抢唯一的执行机'); process.exit(1); }
console.log('  ✓ 选中 ' + picked.name + '，MMV 未被抢占');
" || fail "MMV 抢占防线被突破"

echo "[openclaw-runner-pool-smoke] 4. 主力全挂才回落 MMV（兜底仍要保住 codex 可用）"
node --input-type=module -e "
import { pickRunner } from '$GUARDS';
const onlyMMV = (t) => t.includes('100.71.151.105');
const picked = pickRunner(onlyMMV, { loadFn: () => ({ codexSessions: 0, load1: 0 }) });
if (!picked || picked.name !== 'MMV') { console.error('主力全挂时未回落 MMV，codex 将彻底不可用'); process.exit(1); }
const none = pickRunner(() => false, { loadFn: () => null });
if (none !== null) { console.error('三台全灭时应返回 null 让调用方保持现状'); process.exit(1); }
console.log('  ✓ 兜底与全灭行为正确');
" || fail "兜底行为校验未通过"

echo "[openclaw-runner-pool-smoke] 5. 负载探针是 macOS 写法（三台跑场都是 mac）"
grep -q 'vm.loadavg' "$GUARDS" || fail "探针未使用 macOS 的 sysctl vm.loadavg"
grep -q "grep -c '\[c\]odex'" "$GUARDS" || fail "探针未统计 codex 会话数"
echo "  ✓ 探针命令形态正确"

echo "[openclaw-runner-pool-smoke] 6. 单测全绿（12 条选机断言 + 既有用例）"
(
  cd "$REPO_ROOT/packages/brain"
  npx vitest run src/__tests__/openclaw-guards.test.js --pool=forks --maxWorkers=1
) || fail "openclaw-guards 单测未通过"

echo "✅ openclaw-runner-pool-smoke 全部通过"
