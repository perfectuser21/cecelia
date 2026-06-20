#!/usr/bin/env bash
# sprint-result-contract-smoke.sh — Sprint 产物契约真环境验证
# 在真实 node 运行时加载契约模块，断言：四段字段齐全 + 校验通过 + node_telemetry 时序映射正确 + total_cost 汇总正确。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_SRC="$SCRIPT_DIR/../../src/sprint-result-contract.js"

echo "🔍 sprint-result-contract smoke — module: $BRAIN_SRC"

node -e "
import('file://$BRAIN_SRC').then((m) => {
  const c = m.buildSprintResultContract({
    initiativeId: 'smoke', verdict: 'PASS',
    stepTiming: [{ node: 'planner', started_at: '2026-06-20T00:00:00.000Z', duration_ms: 1000 }],
    wsCosts: [{ ws_id: 'ws1', cost_usd: 0.5 }], costUsd: 0.5,
  });
  m.validateSprintResultContract(c);
  for (const k of ['verdict', 'produced_assets', 'incidental_bugs', 'node_telemetry']) {
    if (!(k in c)) { console.error('缺段: ' + k); process.exit(1); }
  }
  if (c.contract_version !== m.SPRINT_RESULT_CONTRACT_VERSION) { console.error('version 不符'); process.exit(1); }
  if (c.node_telemetry[0].end_ts !== '2026-06-20T00:00:01.000Z') { console.error('node_telemetry 映射错'); process.exit(1); }
  if (c.total_cost !== 0.5) { console.error('total_cost 汇总错'); process.exit(1); }
  console.log('✅ 契约 v' + c.contract_version + ' 四段齐全 + 校验通过 + node_telemetry 映射正确 + total_cost=' + c.total_cost);
}).catch((e) => { console.error(e); process.exit(1); });
"

echo "✅ sprint-result-contract smoke 通过"
