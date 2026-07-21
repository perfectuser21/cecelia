#!/usr/bin/env bash
# dispatch-allocation-guide-smoke.sh
# 验收：dispatcher 前置引导员（allocation guide）三条核心行为
#   1) tight 预算的 dev 任务 → payload.executor=codex + allocation 账本
#   2) abundant 预算的 dev 任务 → 不写 executor（默认 claude），仍写 allocation 账本
#   3) 显式 payload.executor 永不被覆盖
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_SRC="$SCRIPT_DIR/../../src"

node --input-type=module -e "
import { applyDispatchAllocationGuide } from '$BRAIN_SRC/dispatch-allocation-guide.js';

let pass = 0, fail = 0;
const ok = (m) => { console.log('✅ ' + m); pass++; };
const bad = (m) => { console.log('❌ ' + m); fail++; };

// 1. tight → codex + allocation
const tight = applyDispatchAllocationGuide(
  { id: 't1', task_type: 'dev', payload: {} },
  { budgetState: 'tight' }
);
(tight.task.payload.executor === 'codex'
  && tight.task.payload.allocation?.selected_executor === 'codex'
  && tight.task.payload.allocation?.budget_state === 'tight')
  ? ok('tight 预算 dev → executor=codex + allocation 账本')
  : bad('tight 预算 dev 未按预期写 executor/allocation: ' + JSON.stringify(tight.task.payload));

// 2. abundant → 默认 claude，不写 executor，仍留账本
const abundant = applyDispatchAllocationGuide(
  { id: 't2', task_type: 'dev', payload: {} },
  { budgetState: 'abundant' }
);
(abundant.task.payload.executor === undefined
  && abundant.task.payload.allocation?.selected_executor === 'claude')
  ? ok('abundant 预算 dev → 保持 claude 默认，allocation 账本在')
  : bad('abundant 预算 dev 行为异常: ' + JSON.stringify(abundant.task.payload));

// 3. 显式 executor 不被覆盖
const explicit = applyDispatchAllocationGuide(
  { id: 't3', task_type: 'dev', payload: { executor: 'claude' } },
  { budgetState: 'critical' }
);
(explicit.changed === false && explicit.task.payload.executor === 'claude')
  ? ok('显式 executor=claude 在 critical 预算下不被覆盖')
  : bad('显式 executor 被覆盖: ' + JSON.stringify(explicit));

console.log(\`── \${pass} pass / \${fail} fail ──\`);
process.exit(fail === 0 ? 0 : 1);
"
