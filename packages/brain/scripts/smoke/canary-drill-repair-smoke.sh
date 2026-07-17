#!/usr/bin/env bash
# Smoke: canary-drill-repair — 验证三处哑炮修复后的基本可调用性
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== canary-drill-repair smoke ==="

# 1. Brain 健康检查（不可达时跳过，不阻断 CI）
curl -sf "${BRAIN_URL}/api/brain/health" > /dev/null && echo "Brain reachable: OK" || echo "Brain not reachable (skipped)"

# 2. canary-drill-scheduler 模块可正常 import，且 maybeScheduleCanaryDrill 已导出
node -e "
import('./packages/brain/src/canary-drill-scheduler.js').then(m => {
  if (typeof m.maybeScheduleCanaryDrill !== 'function') throw new Error('maybeScheduleCanaryDrill not exported');
  if (typeof m.runCanaryDrillIfNeeded !== 'function') throw new Error('runCanaryDrillIfNeeded not exported');
  console.log('canary-drill-scheduler: exports OK');
}).catch(e => { console.error(e.message); process.exit(1); });
"

# 3. harness-relay-watchdog resumeStalledRelayRuns 可正常 import
node -e "
import('./packages/brain/src/harness-relay-watchdog.js').then(m => {
  if (typeof m.resumeStalledRelayRuns !== 'function') throw new Error('resumeStalledRelayRuns not exported');
  console.log('harness-relay-watchdog: exports OK');
}).catch(e => { console.error(e.message); process.exit(1); });
"

# 4. canary-drill-scheduler 支持 existsFn 注入参数（接口兼容性）
node -e "
import('./packages/brain/src/canary-drill-scheduler.js').then(async m => {
  // 时间窗口外调用，不需要 existsFn 也能返回 skipped
  const result = await m.maybeScheduleCanaryDrill({ now: new Date('2026-01-01T00:00:00Z'), existsFn: () => false });
  if (!result || typeof result.triggered === 'undefined') throw new Error('bad return shape');
  console.log('canary-drill-scheduler existsFn param: OK');
}).catch(e => { console.error(e.message); process.exit(1); });
"

echo "=== canary-drill-repair smoke PASS ==="
