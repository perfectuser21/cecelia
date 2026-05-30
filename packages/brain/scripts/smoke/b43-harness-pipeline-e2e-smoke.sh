#!/usr/bin/env bash
# b43-harness-pipeline-e2e-smoke.sh
# B43 regression guard：harness pipeline A→B→C 静态 + routing 函数验证
# Case 1: buildHarnessFullGraph 支持 nodeOverrides（runSubTaskFn）
# Case 2: routeFromPickSubTask 路由逻辑正确（单一 evaluator 设计，tasks done → report）
# Case 3: compileHarnessFullGraph export 存在（静态 grep）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$BRAIN_ROOT"

# ── Case 1: buildHarnessFullGraph 支持 nodeOverrides ─────────────────────────
echo "[smoke:b43] Case 1: buildHarnessFullGraph 接受 nodeOverrides 参数"
node --input-type=module << 'JS'
import { buildHarnessFullGraph } from './src/workflows/harness-initiative.graph.js';

// 验证无参数调用（默认值）返回 StateGraph
const g0 = buildHarnessFullGraph();
if (!g0 || typeof g0.compile !== 'function') {
  throw new Error('Case 1 FAIL: buildHarnessFullGraph() must return a StateGraph');
}

// 验证传入 nodeOverrides 也返回 StateGraph（单一 evaluator：不再接受 finalEvaluateFn，额外属性被忽略）
const g1 = buildHarnessFullGraph({ runSubTaskFn: async () => ({}) });
if (!g1 || typeof g1.compile !== 'function') {
  throw new Error('Case 1 FAIL: buildHarnessFullGraph({ runSubTaskFn }) must return a StateGraph');
}

console.log('[smoke:b43] Case 1 PASS: buildHarnessFullGraph 支持 nodeOverrides');
JS

# ── Case 2: routeFromPickSubTask routing logic ────────────────────────────────
# 单一 evaluator 设计：tasks done → 直接 report（不再经 final_evaluate 节点）
echo "[smoke:b43] Case 2: routeFromPickSubTask routing 正确（单一 evaluator：done→report）"
node --input-type=module << 'JS'
import { routeFromPickSubTask } from './src/workflows/harness-initiative.graph.js';

// tasks done (idx >= len) → report（单一 evaluator 在 run_sub_task 子图内完成）
const r1 = routeFromPickSubTask({ taskPlan: { tasks: ['t1'] }, task_loop_index: 1 });
if (r1 !== 'report') throw new Error(`Case 2a FAIL: expected report (single evaluator), got ${r1}`);

// idx < len → run_sub_task
const r2 = routeFromPickSubTask({ taskPlan: { tasks: ['t1'] }, task_loop_index: 0 });
if (r2 !== 'run_sub_task') throw new Error(`Case 2b FAIL: expected run_sub_task, got ${r2}`);

// error → end
const r3 = routeFromPickSubTask({ error: 'boom', taskPlan: { tasks: ['t1'] }, task_loop_index: 0 });
if (r3 !== 'end') throw new Error(`Case 2c FAIL: expected end on error, got ${r3}`);

console.log('[smoke:b43] Case 2 PASS: routeFromPickSubTask routing 正确（done→report）');
JS

# ── Case 3: compileHarnessFullGraph export exists ─────────────────────────────
echo "[smoke:b43] Case 3: compileHarnessFullGraph export 存在"
if ! grep -q 'export async function compileHarnessFullGraph' src/workflows/harness-initiative.graph.js; then
  echo "[smoke:b43] FAIL Case 3: compileHarnessFullGraph 未 export"
  exit 1
fi
echo "[smoke:b43] Case 3 PASS: compileHarnessFullGraph 已 export"

echo "✅ [smoke:b43] All 3 cases PASS (nodeOverrides + routing + export)"
exit 0
