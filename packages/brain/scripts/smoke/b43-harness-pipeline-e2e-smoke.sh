#!/usr/bin/env bash
# b43-harness-pipeline-e2e-smoke.sh
# B43 regression guard：harness pipeline A→B→C 静态 + routing 函数验证
# Case 1: buildHarnessFullGraph 支持 nodeOverrides（Task 2 后补）
# Case 2: routeFromPickSubTask 路由逻辑正确（纯函数，不需要服务）
# Case 3: compileHarnessFullGraph export 存在（静态 grep）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$BRAIN_ROOT"

# ── Case 2: routeFromPickSubTask routing logic ────────────────────────────────
echo "[smoke:b43] Case 2: routeFromPickSubTask routing 正确"
node --input-type=module << 'JS'
import { routeFromPickSubTask } from './src/workflows/harness-initiative.graph.js';

const r1 = routeFromPickSubTask({ taskPlan: { tasks: ['t1'] }, task_loop_index: 1 });
if (r1 !== 'final_evaluate') throw new Error(`Case 2a FAIL: expected final_evaluate, got ${r1}`);

const r2 = routeFromPickSubTask({ taskPlan: { tasks: ['t1'] }, task_loop_index: 0 });
if (r2 !== 'run_sub_task') throw new Error(`Case 2b FAIL: expected run_sub_task, got ${r2}`);

const r3 = routeFromPickSubTask({ error: 'boom', taskPlan: { tasks: ['t1'] }, task_loop_index: 0 });
if (r3 !== 'end') throw new Error(`Case 2c FAIL: expected end on error, got ${r3}`);

console.log('[smoke:b43] Case 2 PASS: routeFromPickSubTask routing 正确');
JS

# ── Case 3: compileHarnessFullGraph export exists ─────────────────────────────
echo "[smoke:b43] Case 3: compileHarnessFullGraph export 存在"
if ! grep -q 'export async function compileHarnessFullGraph' src/workflows/harness-initiative.graph.js; then
  echo "[smoke:b43] FAIL Case 3: compileHarnessFullGraph 未 export"
  exit 1
fi
echo "[smoke:b43] Case 3 PASS: compileHarnessFullGraph 已 export"

echo "⚠️  [smoke:b43] Case 1 (nodeOverrides) 待 Task 2 补充"
echo "✅ [smoke:b43] Cases 2-3 PASS"
exit 0
