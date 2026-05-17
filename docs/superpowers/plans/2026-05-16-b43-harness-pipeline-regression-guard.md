# B43 — Harness Pipeline A→B→C Regression Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 写 vitest 集成测试 + smoke shell，永久保护 harness pipeline A→B→C 状态机不回归。

**Architecture:** Task 1 先写红测试（`buildHarnessFullGraph` 当前忽略 nodeOverrides 导致 test FAIL）；Task 2 加 `nodeOverrides` 参数让测试变绿，同时写 smoke。两个文件改动，一个文件新建。

**Tech Stack:** vitest、@langchain/langgraph MemorySaver、bash、Node.js ESM

---

## 文件结构

- **Modify:** `packages/brain/src/workflows/harness-initiative.graph.js` — `buildHarnessFullGraph` 加 `nodeOverrides = {}` 参数（3 行改动）
- **Create:** `packages/brain/src/workflows/__tests__/harness-pipeline-b43-integration.test.js` — 全图集成测试
- **Create:** `packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh` — 静态 + routing 函数验证

---

## Task 1: 写红测试（全图集成 + smoke 骨架）

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-pipeline-b43-integration.test.js`
- Create: `packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh` (骨架，Cases 2-3 only)

- [ ] **Step 1: 写集成测试文件**

创建 `packages/brain/src/workflows/__tests__/harness-pipeline-b43-integration.test.js`：

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';

const {
  mockSpawn, mockEnsureWt, mockResolveTok, mockParseTaskPlan, mockUpsertTaskPlan,
  mockRunGan, mockReadFile, mockClient, mockPool,
} = vi.hoisted(() => {
  const client = { query: vi.fn(), release: vi.fn() };
  return {
    mockSpawn: vi.fn(),
    mockEnsureWt: vi.fn(),
    mockResolveTok: vi.fn(),
    mockParseTaskPlan: vi.fn(),
    mockUpsertTaskPlan: vi.fn(),
    mockRunGan: vi.fn(),
    mockReadFile: vi.fn(),
    mockClient: client,
    mockPool: {
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn(),
    },
  };
});

vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../spawn/index.js', () => ({ spawn: (...a) => mockSpawn(...a) }));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: (...a) => mockEnsureWt(...a) }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: (...a) => mockResolveTok(...a) }));
vi.mock('../../docker-executor.js', () => ({
  writeDockerCallback: vi.fn(),
  executeInDocker: (...a) => mockSpawn(...a),
}));
vi.mock('../../spawn/detached.js', () => ({
  spawnDockerDetached: vi.fn(async (o) => ({ containerId: o.containerId })),
}));
vi.mock('../../shepherd.js', () => ({
  checkPrStatus: vi.fn(),
  executeMerge: vi.fn(),
  classifyFailedChecks: vi.fn(),
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: (...a) => mockParseTaskPlan(...a),
  upsertTaskPlan: (...a) => mockUpsertTaskPlan(...a),
}));
vi.mock('../../harness-gan-graph.js', () => ({
  runGanContractGraph: (...a) => mockRunGan(...a),
}));
vi.mock('../../harness-graph.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL',
  extractField: () => null,
}));
vi.mock('node:fs/promises', () => ({
  default: { readFile: (...a) => mockReadFile(...a) },
  readFile: (...a) => mockReadFile(...a),
}));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue(new MemorySaver()),
}));
vi.mock('../../harness-final-e2e.js', () => ({
  runScenarioCommand: vi.fn(() => ({ exitCode: 0, output: 'ok' })),
  bootstrapE2E: vi.fn(() => ({ exitCode: 0, output: 'ok' })),
  teardownE2E: vi.fn(() => ({ exitCode: 0, output: '' })),
  normalizeAcceptance: (a) => a,
  attributeFailures: () => new Map(),
}));

import { buildHarnessFullGraph } from '../harness-initiative.graph.js';

describe('B43 — harness pipeline A→B→C regression guard', () => {
  beforeEach(() => {
    [mockSpawn, mockEnsureWt, mockResolveTok, mockParseTaskPlan, mockUpsertTaskPlan,
      mockRunGan, mockReadFile, mockPool.query, mockClient.query, mockClient.release,
    ].forEach((m) => m.mockReset());
    mockClient.release.mockReturnValue(undefined);
    mockClient.query.mockResolvedValue({ rows: [] });
    mockPool.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(mockClient);
  });

  it('full graph A→B→C: nodeOverrides inject mock run_sub_task + final_evaluate → PASS', async () => {
    // Phase A mocks
    mockEnsureWt.mockResolvedValue('/wt-b43');
    mockResolveTok.mockResolvedValue('tok-b43');
    mockSpawn.mockResolvedValue({ exit_code: 0, stdout: 'planner output', stderr: '' });
    mockReadFile.mockResolvedValue('# Sprint PRD b43');
    mockParseTaskPlan.mockReturnValue({
      initiative_id: 'b43-init',
      tasks: [{ id: 'ws1', title: 'T1', dod: [], files: [] }],
    });
    mockRunGan.mockResolvedValue({
      contract_content: '# Contract',
      rounds: 2,
      propose_branch: 'cp-b43-test',
    });
    // dbUpsert DB transaction mocks
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                    // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'cid-b43' }] })  // INSERT initiative_contracts
      .mockResolvedValueOnce({ rows: [{ id: 'rid-b43' }] })  // INSERT initiative_runs
      .mockResolvedValueOnce({ rows: [] });                   // COMMIT
    mockUpsertTaskPlan.mockResolvedValue({ idMap: {}, insertedTaskIds: ['ws1'] });

    // Phase B+C injectable mocks — THIS IS WHAT b43 IS TESTING
    const mockRunSubTaskFn = vi.fn(async (state) => ({
      sub_tasks: [{ id: state.sub_task?.id, status: 'merged', pr_url: 'https://github.com/fake/pr/1' }],
    }));
    const mockFinalEvaluateFn = vi.fn(async () => ({
      final_e2e_verdict: 'PASS',
      final_e2e_failed_scenarios: [],
    }));

    // buildHarnessFullGraph must accept nodeOverrides — RED if it doesn't
    const compiled = buildHarnessFullGraph({
      runSubTaskFn: mockRunSubTaskFn,
      finalEvaluateFn: mockFinalEvaluateFn,
    }).compile({ checkpointer: new MemorySaver() });

    const final = await compiled.invoke(
      { task: { id: 'b43-init', payload: { initiative_id: 'b43-init' } } },
      { configurable: { thread_id: 'b43:1' }, recursionLimit: 500 }
    );

    // B→C transition assertions
    expect(mockRunSubTaskFn).toHaveBeenCalledTimes(1);
    expect(mockRunSubTaskFn.mock.calls[0][0].sub_task?.id).toBe('ws1');
    expect(mockFinalEvaluateFn).toHaveBeenCalledTimes(1);
    expect(final.final_e2e_verdict).toBe('PASS');
    expect(final.final_e2e_failed_scenarios).toEqual([]);
    expect(final.report_path).toBeTruthy();
  }, 15000);
});
```

- [ ] **Step 2: 运行测试，确认红**

```bash
cd /Users/administrator/worktrees/cecelia/b43-harness-pipeline-integration-smoke
npx vitest run packages/brain/src/workflows/__tests__/harness-pipeline-b43-integration.test.js 2>&1 | tail -30
```

期望输出：**FAIL**（因为 `buildHarnessFullGraph` 当前不接受 `nodeOverrides`，`mockRunSubTaskFn` 不会被调用，`expect(mockRunSubTaskFn).toHaveBeenCalledTimes(1)` 失败）

- [ ] **Step 3: 写 smoke 骨架（Cases 2-3，无需 nodeOverrides 功能）**

创建 `packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh`：

```bash
#!/usr/bin/env bash
# b43-harness-pipeline-e2e-smoke.sh
# B43 regression guard：harness pipeline A→B→C 静态 + routing 函数验证
# Case 1: buildHarnessFullGraph 支持 nodeOverrides（加 Task 2 后补）
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

// idx >= tasks.length → 'final_evaluate'
const r1 = routeFromPickSubTask({ taskPlan: { tasks: ['t1'] }, task_loop_index: 1 });
if (r1 !== 'final_evaluate') throw new Error(`Case 2a FAIL: expected final_evaluate, got ${r1}`);

// idx < tasks.length → 'run_sub_task'
const r2 = routeFromPickSubTask({ taskPlan: { tasks: ['t1'] }, task_loop_index: 0 });
if (r2 !== 'run_sub_task') throw new Error(`Case 2b FAIL: expected run_sub_task, got ${r2}`);

// error in state → 'end'
const r3 = routeFromPickSubTask({ error: 'something', taskPlan: { tasks: ['t1'] }, task_loop_index: 0 });
if (r3 !== 'end') throw new Error(`Case 2c FAIL: expected end on error, got ${r3}`);

console.log('[smoke:b43] Case 2 PASS: routeFromPickSubTask routing 正确');
JS

# ── Case 3: compileHarnessFullGraph export exists ──────────────────────────────
echo "[smoke:b43] Case 3: compileHarnessFullGraph export 存在"
if ! grep -q 'export async function compileHarnessFullGraph' src/workflows/harness-initiative.graph.js; then
  echo "[smoke:b43] FAIL Case 3: compileHarnessFullGraph 未 export"
  exit 1
fi
echo "[smoke:b43] Case 3 PASS: compileHarnessFullGraph 已 export"

echo "⚠️  [smoke:b43] Case 1 (nodeOverrides) 待 Task 2 补充"
echo "✅ [smoke:b43] Cases 2-3 PASS"
exit 0
```

```bash
chmod +x packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh
```

- [ ] **Step 4: 运行 smoke，确认 Cases 2-3 绿**

```bash
bash packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh
```

期望输出：
```
[smoke:b43] Case 2 PASS: routeFromPickSubTask routing 正确
[smoke:b43] Case 3 PASS: compileHarnessFullGraph 已 export
⚠️  [smoke:b43] Case 1 (nodeOverrides) 待 Task 2 补充
✅ [smoke:b43] Cases 2-3 PASS
```

- [ ] **Step 5: commit-1（红测试 + smoke 骨架）**

```bash
cd /Users/administrator/worktrees/cecelia/b43-harness-pipeline-integration-smoke
git add packages/brain/src/workflows/__tests__/harness-pipeline-b43-integration.test.js
git add packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh
git commit -m "test(b43): 红测试 — 全图 A→B→C nodeOverrides 集成测试 + smoke 骨架

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: 实现 nodeOverrides + 让测试变绿 + 完善 smoke Case 1

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:1516-1557`
- Modify: `packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh` (加 Case 1)

- [ ] **Step 1: 改 `buildHarnessFullGraph` 加 `nodeOverrides` 参数**

打开 `packages/brain/src/workflows/harness-initiative.graph.js`，找到 line 1516：

**改前：**
```javascript
export function buildHarnessFullGraph() {
  // 节点级 RetryPolicy（W2）—— 见 packages/brain/src/workflows/retry-policies.js
  // LLM_RETRY: planner / ganLoop / run_sub_task / final_evaluate
  // DB_RETRY:  dbUpsert / report
  // NO_RETRY:  prep / parsePrd / inferTaskPlan / pick_sub_task / advance / retry / terminal_fail
  // NOTE: per-task `evaluate` 节点已下沉到 harness-task.graph.js 子图内（evaluate_contract 节点），
  //       initiative graph 不再有 evaluate 节点。
  return new StateGraph(FullInitiativeState)
    .addNode('prep', prepInitiativeNode, { retryPolicy: NO_RETRY })
    .addNode('planner', runPlannerNode, { retryPolicy: LLM_RETRY })
    .addNode('parsePrd', parsePrdNode, { retryPolicy: NO_RETRY })
    .addNode('ganLoop', runGanLoopNode, { retryPolicy: LLM_RETRY })
    .addNode('inferTaskPlan', inferTaskPlanNode, { retryPolicy: NO_RETRY })
    .addNode('dbUpsert', dbUpsertNode, { retryPolicy: DB_RETRY })
    .addNode('pick_sub_task', pickSubTaskNode, { retryPolicy: NO_RETRY })
    .addNode('run_sub_task', runSubTaskNode, { retryPolicy: LLM_RETRY })
    .addNode('advance', advanceTaskIndexNode, { retryPolicy: NO_RETRY })
    // NOTE: 'retry' / 'terminal_fail' 节点删除 — 它们 originally 由 routeAfterEvaluate 路由进入，
    // 但 per-task evaluator 下沉到 harness-task.graph.js 的 evaluate_contract 子图后，
    // initiative 层的 evaluate 节点+routeAfterEvaluate 路由都被删除，这两个节点变成 orphan。
    // retryTaskNode / terminalFailNode 函数定义保留（其他地方可能调用）。
    // Golden Path 终验 — 跨 ws E2E 聚合验证，区别于 task 子图内的 evaluate_contract（per-task pre-merge gate）。
    .addNode('final_evaluate', finalEvaluateDispatchNode, { retryPolicy: LLM_RETRY })
    .addNode('report', reportNode, { retryPolicy: DB_RETRY })
```

**改后：**
```javascript
export function buildHarnessFullGraph(nodeOverrides = {}) {
  const {
    runSubTaskFn = runSubTaskNode,
    finalEvaluateFn = finalEvaluateDispatchNode,
  } = nodeOverrides;
  // 节点级 RetryPolicy（W2）—— 见 packages/brain/src/workflows/retry-policies.js
  // LLM_RETRY: planner / ganLoop / run_sub_task / final_evaluate
  // DB_RETRY:  dbUpsert / report
  // NO_RETRY:  prep / parsePrd / inferTaskPlan / pick_sub_task / advance / retry / terminal_fail
  // NOTE: per-task `evaluate` 节点已下沉到 harness-task.graph.js 子图内（evaluate_contract 节点），
  //       initiative graph 不再有 evaluate 节点。
  return new StateGraph(FullInitiativeState)
    .addNode('prep', prepInitiativeNode, { retryPolicy: NO_RETRY })
    .addNode('planner', runPlannerNode, { retryPolicy: LLM_RETRY })
    .addNode('parsePrd', parsePrdNode, { retryPolicy: NO_RETRY })
    .addNode('ganLoop', runGanLoopNode, { retryPolicy: LLM_RETRY })
    .addNode('inferTaskPlan', inferTaskPlanNode, { retryPolicy: NO_RETRY })
    .addNode('dbUpsert', dbUpsertNode, { retryPolicy: DB_RETRY })
    .addNode('pick_sub_task', pickSubTaskNode, { retryPolicy: NO_RETRY })
    .addNode('run_sub_task', runSubTaskFn, { retryPolicy: LLM_RETRY })
    .addNode('advance', advanceTaskIndexNode, { retryPolicy: NO_RETRY })
    // NOTE: 'retry' / 'terminal_fail' 节点删除 — 它们 originally 由 routeAfterEvaluate 路由进入，
    // 但 per-task evaluator 下沉到 harness-task.graph.js 的 evaluate_contract 子图后，
    // initiative 层的 evaluate 节点+routeAfterEvaluate 路由都被删除，这两个节点变成 orphan。
    // retryTaskNode / terminalFailNode 函数定义保留（其他地方可能调用）。
    // Golden Path 终验 — 跨 ws E2E 聚合验证，区别于 task 子图内的 evaluate_contract（per-task pre-merge gate）。
    .addNode('final_evaluate', finalEvaluateFn, { retryPolicy: LLM_RETRY })
    .addNode('report', reportNode, { retryPolicy: DB_RETRY })
```

注意：`compileHarnessFullGraph`（line 1554）调用 `buildHarnessFullGraph()` 不传参，默认值保证生产行为不变：
```javascript
export async function compileHarnessFullGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildHarnessFullGraph().compile({ checkpointer, durability: 'sync' });
}
```
这一行**不需要修改**。

- [ ] **Step 2: 运行测试，确认绿**

```bash
cd /Users/administrator/worktrees/cecelia/b43-harness-pipeline-integration-smoke
npx vitest run packages/brain/src/workflows/__tests__/harness-pipeline-b43-integration.test.js 2>&1 | tail -30
```

期望输出：**PASS**
- `mockRunSubTaskFn` called 1 time ✓
- `mockFinalEvaluateFn` called 1 time ✓
- `final.final_e2e_verdict === 'PASS'` ✓
- `final.report_path` is truthy ✓

如果有报错，常见原因：
- `state.sub_task` 为 null：检查 `pickSubTaskNode` 是否正确返回 `sub_task`
- DB transaction mock 顺序错：`mockClient.query` 的 mockResolvedValueOnce 调用顺序需匹配 `dbUpsertNode` 内的 BEGIN/INSERT/INSERT/COMMIT

- [ ] **Step 3: 运行完整测试套件确认无回归**

```bash
npx vitest run packages/brain/src/workflows/__tests__/ 2>&1 | tail -20
```

期望：所有 tests PASS（新测试 1 个绿，原有测试不受影响）

- [ ] **Step 4: 完善 smoke，加 Case 1（nodeOverrides 功能验证）**

编辑 `packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh`，在 Case 2 之前加入 Case 1，并改最后的 summary：

**在 `set -euo pipefail` 之后、Case 2 之前插入 Case 1：**

```bash
# ── Case 1: buildHarnessFullGraph 支持 nodeOverrides ─────────────────────────
echo "[smoke:b43] Case 1: buildHarnessFullGraph 接受 nodeOverrides 参数"
node --input-type=module << 'JS'
import { buildHarnessFullGraph } from './src/workflows/harness-initiative.graph.js';

let runSubTaskCalled = false;
const mockRunSubTask = async () => { runSubTaskCalled = true; return {}; };

// 传入 nodeOverrides — 不抛错，返回 StateGraph
const g = buildHarnessFullGraph({ runSubTaskFn: mockRunSubTask, finalEvaluateFn: async () => ({}) });
if (!g || typeof g.compile !== 'function') {
  throw new Error('Case 1 FAIL: buildHarnessFullGraph({ nodeOverrides }) must return a StateGraph');
}

// 验证函数签名：length=1（接受 1 个参数）
if (buildHarnessFullGraph.length !== 1) {
  throw new Error(`Case 1 FAIL: buildHarnessFullGraph.length should be 1 (has nodeOverrides param), got ${buildHarnessFullGraph.length}`);
}

console.log('[smoke:b43] Case 1 PASS: buildHarnessFullGraph 支持 nodeOverrides');
JS
```

**把文件末尾的 warning + summary 改为：**

```bash
echo "✅ [smoke:b43] All 3 cases PASS (nodeOverrides + routing + export)"
exit 0
```

完整修改后的 `b43-harness-pipeline-e2e-smoke.sh` 内容（覆盖整个文件）：

```bash
#!/usr/bin/env bash
# b43-harness-pipeline-e2e-smoke.sh
# B43 regression guard：harness pipeline A→B→C 静态 + routing 函数验证
# Case 1: buildHarnessFullGraph 支持 nodeOverrides（B43 新增参数）
# Case 2: routeFromPickSubTask 路由逻辑正确（纯函数，不需要服务）
# Case 3: compileHarnessFullGraph export 存在（静态 grep）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$BRAIN_ROOT"

# ── Case 1: buildHarnessFullGraph 支持 nodeOverrides ─────────────────────────
echo "[smoke:b43] Case 1: buildHarnessFullGraph 接受 nodeOverrides 参数"
node --input-type=module << 'JS'
import { buildHarnessFullGraph } from './src/workflows/harness-initiative.graph.js';

const g = buildHarnessFullGraph({ runSubTaskFn: async () => ({}), finalEvaluateFn: async () => ({}) });
if (!g || typeof g.compile !== 'function') {
  throw new Error('Case 1 FAIL: buildHarnessFullGraph({ nodeOverrides }) must return a StateGraph');
}
if (buildHarnessFullGraph.length !== 1) {
  throw new Error(`Case 1 FAIL: expected length=1, got ${buildHarnessFullGraph.length}`);
}
console.log('[smoke:b43] Case 1 PASS: buildHarnessFullGraph 支持 nodeOverrides');
JS

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

# ── Case 3: compileHarnessFullGraph export exists ──────────────────────────────
echo "[smoke:b43] Case 3: compileHarnessFullGraph export 存在"
if ! grep -q 'export async function compileHarnessFullGraph' src/workflows/harness-initiative.graph.js; then
  echo "[smoke:b43] FAIL Case 3: compileHarnessFullGraph 未 export"
  exit 1
fi
echo "[smoke:b43] Case 3 PASS: compileHarnessFullGraph 已 export"

echo "✅ [smoke:b43] All 3 cases PASS (nodeOverrides + routing + export)"
exit 0
```

- [ ] **Step 5: 运行完整 smoke，确认 All 3 PASS**

```bash
bash packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh
```

期望输出：
```
[smoke:b43] Case 1 PASS: buildHarnessFullGraph 支持 nodeOverrides
[smoke:b43] Case 2 PASS: routeFromPickSubTask routing 正确
[smoke:b43] Case 3 PASS: compileHarnessFullGraph 已 export
✅ [smoke:b43] All 3 cases PASS (nodeOverrides + routing + export)
```

- [ ] **Step 6: 写 Brain version bump（feat: PR 要求）**

Brain 改了 `src/` 文件（harness-initiative.graph.js），需要 version bump：

```bash
# 查当前版本
node -p "require('./packages/brain/package.json').version"
```

如果当前是 `1.230.8`，bump 到 `1.230.9`：

```bash
cd packages/brain && npm version patch --no-git-tag-version && cd ../..
# 验证
node -p "require('./packages/brain/package.json').version"
```

- [ ] **Step 7: commit-2（实现 + smoke 完善 + version bump）**

```bash
cd /Users/administrator/worktrees/cecelia/b43-harness-pipeline-integration-smoke
git add packages/brain/src/workflows/harness-initiative.graph.js
git add packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh
git add packages/brain/package.json packages/brain/package-lock.json
git commit -m "feat(b43): buildHarnessFullGraph nodeOverrides + A→B→C regression guard smoke

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: 写 Learning 文件并验证 DoD

**Files:**
- Create: `docs/learnings/cp-0516103049-b43-harness-pipeline-integration-smoke.md`

- [ ] **Step 1: 写 Learning 文件**

创建 `docs/learnings/cp-0516103049-b43-harness-pipeline-integration-smoke.md`：

```markdown
## B43 — Harness Pipeline A→B→C Regression Guard（2026-05-16）

### 根本原因

`harness-initiative.graph.full.test.js` 中的 3 个关键 e2e 测试全被 `it.skip`（标注 `LAYER_3_SMOKE_COVERED`），原因是 `runSubTaskNode` 使用 spawn-and-interrupt 架构，单进程 vitest 无法模拟 callback router resume。

这导致 Phase B→C 的状态机转移（`pick_sub_task → run_sub_task → advance → pick_sub_task(loop) → final_evaluate → report`）**完全没有自动化保护**。B40/B41/B42 三个 bug 修复后，pipeline 端到端才首次 PASS，但下次有人修改 graph 拓扑时没有任何回归保护。

### 下次预防

- [ ] 每次修改 `buildHarnessFullGraph` 的 edge 定义，必须先跑 `npx vitest run packages/brain/src/workflows/__tests__/harness-pipeline-b43-integration.test.js`
- [ ] 新增的 graph node 或 conditional edge，必须在集成测试中验证 mock 被调用
- [ ] `nodeOverrides` 参数只用于测试，生产代码 `compileHarnessFullGraph()` 永远不传 override
- [ ] 如果将来 `run_sub_task` 节点的接口变化（返回格式改变），同步更新 `mockRunSubTaskFn` 的返回值（特别是 `sub_tasks[].id` 必须来自 `state.sub_task?.id`）
```

- [ ] **Step 2: 运行所有相关测试**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-pipeline-b43-integration.test.js packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js 2>&1 | tail -20
```

期望：所有 tests PASS

- [ ] **Step 3: 运行 smoke**

```bash
bash packages/brain/scripts/smoke/b43-harness-pipeline-e2e-smoke.sh
```

期望：`✅ [smoke:b43] All 3 cases PASS`

- [ ] **Step 4: commit-3（Learning）**

```bash
cd /Users/administrator/worktrees/cecelia/b43-harness-pipeline-integration-smoke
git add docs/learnings/cp-0516103049-b43-harness-pipeline-integration-smoke.md
git commit -m "docs(b43): learning — harness pipeline A→B→C regression guard

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
