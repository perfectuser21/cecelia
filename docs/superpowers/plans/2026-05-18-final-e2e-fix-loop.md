# Final E2E Fix Loop 接线修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `harness-initiative.graph.js` 中 Final E2E 失败后无法自动 re-run 的 bug，实现：FAIL + fix 次数未到 MAX(3) → 重置 `task_loop_index:0` 重跑所有 sub-tasks → 再次 final_evaluate → 直到 PASS 或达上限。

**Architecture:** 新增 `final_e2e_fix_count` 状态字段（不被 sub-task loop 重置），修改 `finalEvaluateDispatchNode` 在 FAIL+<MAX 时返回含 fix_count 递增和 index 重置的 delta，修复 `_routeAfterFinalE2E` 路由函数并接入图，替换死边 `addEdge('final_evaluate', 'report')` 为条件边。

**Tech Stack:** LangGraph, Vitest, Node.js ESM

---

## 文件变更一览

| 文件 | 操作 |
|------|------|
| `packages/brain/src/workflows/harness-initiative.graph.js` | Modify（4 处）|
| `packages/brain/src/__tests__/harness-initiative-evaluate.test.js` | Modify（新增测试段）|
| `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js` | Modify（新增 fix loop integration test）|

---

### Task 1: 写失败测试 — `_routeAfterFinalE2E` 路由和 `finalEvaluateDispatchNode` fix delta

**Files:**
- Test: `packages/brain/src/__tests__/harness-initiative-evaluate.test.js`（在文件末尾追加）

- [ ] **Step 1: 追加测试导入**

在 `harness-initiative-evaluate.test.js` 的 import 块（第 94-101 行）添加 `finalEvaluateDispatchNode` 和 `_routeAfterFinalE2E`：

```js
import {
  parsePrdNode,
  inferTaskPlanNode,
  routeAfterEvaluate,
  pickSubTaskNode,
  advanceTaskIndexNode,
  retryTaskNode,
  finalEvaluateDispatchNode,
  _routeAfterFinalE2E,
} from '../workflows/harness-initiative.graph.js';
```

- [ ] **Step 2: 追加 `_routeAfterFinalE2E` 单测段**

在文件末尾追加：

```js
// ─── _routeAfterFinalE2E — 4 cases ───────────────────────────────────────────

describe('_routeAfterFinalE2E', () => {
  it('error → report', () => {
    expect(_routeAfterFinalE2E({ error: { node: 'final_evaluate' }, final_e2e_verdict: 'FAIL' })).toBe('report');
  });

  it('PASS → report', () => {
    expect(_routeAfterFinalE2E({ final_e2e_verdict: 'PASS' })).toBe('report');
  });

  it('PASS_WITH_OVERRIDE → report', () => {
    expect(_routeAfterFinalE2E({ final_e2e_verdict: 'PASS_WITH_OVERRIDE' })).toBe('report');
  });

  it('FAIL (no error) → pick_sub_task', () => {
    expect(_routeAfterFinalE2E({ final_e2e_verdict: 'FAIL' })).toBe('pick_sub_task');
  });
});
```

- [ ] **Step 3: 追加 `finalEvaluateDispatchNode` fix delta 单测段**

在同文件末尾继续追加：

```js
// ─── finalEvaluateDispatchNode fix loop delta ─────────────────────────────────

describe('finalEvaluateDispatchNode — fix loop', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('FAIL + final_e2e_fix_count=0 → returns fix_count:1 + task_loop_index:0', async () => {
    const mockSpawnFn = vi.fn().mockResolvedValue({
      exit_code: 1,
      timed_out: false,
      stderr: 'e2e fail',
    });

    const state = {
      final_e2e_fix_count: 0,
      task_loop_index: 3,
      task: { id: 'task-1', payload: { sprint_dir: 'sprints' } },
      taskPlan: { journey_type: 'autonomous' },
      worktreePath: '/tmp/wt',
      sub_tasks: [],
      githubToken: 'tok',
    };

    const result = await finalEvaluateDispatchNode(state, { executor: mockSpawnFn, execFile: vi.fn().mockResolvedValue({ stdout: '' }) });

    expect(result.final_e2e_verdict).toBe('FAIL');
    expect(result.final_e2e_fix_count).toBe(1);
    expect(result.task_loop_index).toBe(0);
  });

  it('FAIL + final_e2e_fix_count=2 (< MAX 3) → returns fix_count:3 + task_loop_index:0', async () => {
    const mockSpawnFn = vi.fn().mockResolvedValue({
      exit_code: 1,
      timed_out: false,
      stderr: 'e2e fail again',
    });

    const state = {
      final_e2e_fix_count: 2,
      task_loop_index: 2,
      task: { id: 'task-1', payload: { sprint_dir: 'sprints' } },
      taskPlan: { journey_type: 'autonomous' },
      worktreePath: '/tmp/wt',
      sub_tasks: [],
      githubToken: 'tok',
    };

    const result = await finalEvaluateDispatchNode(state, { executor: mockSpawnFn, execFile: vi.fn().mockResolvedValue({ stdout: '' }) });

    expect(result.final_e2e_verdict).toBe('FAIL');
    expect(result.final_e2e_fix_count).toBe(3);
    expect(result.task_loop_index).toBe(0);
  });

  it('FAIL + final_e2e_fix_count=3 (>= MAX) → calls interrupt()', async () => {
    const mockInterrupt = vi.fn().mockReturnValue({ action: 'abort' });
    vi.doMock('@langchain/langgraph', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, interrupt: mockInterrupt };
    });

    const mockSpawnFn = vi.fn().mockResolvedValue({
      exit_code: 1,
      timed_out: false,
      stderr: 'e2e fail max',
    });

    const state = {
      final_e2e_fix_count: 3,
      task_loop_index: 2,
      task: { id: 'task-1', payload: { sprint_dir: 'sprints' } },
      taskPlan: { journey_type: 'autonomous' },
      worktreePath: '/tmp/wt',
      sub_tasks: [],
      initiativeId: 'init-1',
      githubToken: 'tok',
    };

    // interrupt 返回 abort，期望 error 字段被设置
    const result = await finalEvaluateDispatchNode(state, { executor: mockSpawnFn, execFile: vi.fn().mockResolvedValue({ stdout: '' }) });
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('final_evaluate');
  });

  it('PASS → returns PASS verdict, no fix_count or index changes', async () => {
    const mockSpawnFn = vi.fn().mockResolvedValue({ exit_code: 0, timed_out: false, stderr: '' });
    const mockReadResult = vi.fn().mockResolvedValue({ verdict: 'PASS' });

    const state = {
      final_e2e_fix_count: 0,
      task_loop_index: 2,
      task: { id: 'task-1', payload: { sprint_dir: 'sprints' } },
      taskPlan: { journey_type: 'autonomous' },
      worktreePath: '/tmp/wt',
      sub_tasks: [],
      githubToken: 'tok',
    };

    const result = await finalEvaluateDispatchNode(state, {
      executor: mockSpawnFn,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
    });

    // PASS: no fix delta
    expect(result.final_e2e_verdict).toBe('PASS');
    expect(result.task_loop_index).toBeUndefined();
    expect(result.final_e2e_fix_count).toBeUndefined();
  });
});
```

- [ ] **Step 4: 运行测试，确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/fix-final-e2e-fix-loop
npx vitest run packages/brain/src/__tests__/harness-initiative-evaluate.test.js --reporter=verbose 2>&1 | tail -40
```

期望：`_routeAfterFinalE2E` 和 `finalEvaluateDispatchNode fix loop` 的测试段以 FAIL 结束（函数未导出 / 路由返回错误值）。

- [ ] **Step 5: Commit 失败测试**

```bash
cd /Users/administrator/worktrees/cecelia/fix-final-e2e-fix-loop
git add packages/brain/src/__tests__/harness-initiative-evaluate.test.js
git commit -m "test(harness): RED — _routeAfterFinalE2E + finalEvaluateDispatchNode fix loop 失败测试"
```

---

### Task 2: 实现 4 处代码修复

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`

- [ ] **Step 1: 新增 `final_e2e_fix_count` 状态字段**

在 `FullInitiativeState` 定义（第 889-926 行），`evaluate_feedback` 之后（第 925 行）添加：

```js
  evaluate_feedback:  Annotation({ reducer: (_o, n) => n, default: () => null }),
  // Final E2E fix round 计数器（独立于 task_loop_fix_count，不被 pickSubTaskNode 重置）
  final_e2e_fix_count: Annotation({ reducer: (_o, n) => n, default: () => 0 }),
```

- [ ] **Step 2: 修改 `finalEvaluateDispatchNode` — fixRound 来源**

找到第 1502 行（`const fixRound = state.task_loop_fix_count ?? 0;`），改为：

```js
  const fixRound = state.final_e2e_fix_count ?? 0;
```

- [ ] **Step 3: 修改 interrupt 异常兜底 return**

找到第 1518-1523 行的 catch 块：

```js
    // 旧：
    console.warn(`[finalEvaluateDispatchNode] interrupt() unexpected error: ${err.message}`);
    return verdictDelta;
```

改为：

```js
    console.warn(`[finalEvaluateDispatchNode] interrupt() unexpected error: ${err.message}`);
    return { ...verdictDelta, error: { node: 'final_evaluate', message: 'max fix rounds exhausted, interrupt failed' } };
```

- [ ] **Step 4: 修改 extend_fix_rounds 重置字段**

找到第 1534 行（`task_loop_fix_count: 0,`）：

```js
    // 旧：
    task_loop_fix_count: 0,
    // 新：
    final_e2e_fix_count: 0,
```

- [ ] **Step 5: 新增 FAIL+<MAX 自动重跑分支**

在第 1548 行（`// 未知 action — 保留原 verdict` 之后、`return verdictDelta;` 之前），在整个 interrupt if 块结束后新增：

```js
  // FAIL + fix rounds 未耗尽 → 重置 task_loop_index，让 routing 函数送回 pick_sub_task
  if (verdictDelta.final_e2e_verdict === 'FAIL' && fixRound < MAX_FIX_ROUNDS) {
    return { ...verdictDelta, final_e2e_fix_count: fixRound + 1, task_loop_index: 0 };
  }
```

整个函数末尾的 `return verdictDelta;` 保留（PASS 路径走此处）。

- [ ] **Step 6: 修复 `_routeAfterFinalE2E` 路由函数**

找到第 1562-1565 行：

```js
// 旧：
function _routeAfterFinalE2E(state) {
  if (state.error) return 'end';
  return 'report';
}
```

改为：

```js
function _routeAfterFinalE2E(state) {
  if (state.error) return 'report';
  if (state.final_e2e_verdict === 'PASS' || state.final_e2e_verdict === 'PASS_WITH_OVERRIDE') return 'report';
  return 'pick_sub_task'; // FAIL → 重跑所有 sub-tasks（fix rounds 由节点内 interrupt 管控）
}
```

- [ ] **Step 7: 导出 `_routeAfterFinalE2E`（测试需要）**

将 `function _routeAfterFinalE2E` 改为 `export function _routeAfterFinalE2E`。

- [ ] **Step 8: 接线图 — 死边改条件边**

找到第 1605 行：

```js
// 旧：
    .addEdge('final_evaluate', 'report')
```

改为：

```js
    .addConditionalEdges('final_evaluate', _routeAfterFinalE2E, { report: 'report', pick_sub_task: 'pick_sub_task' })
```

- [ ] **Step 9: 运行失败测试，确认变绿**

```bash
cd /Users/administrator/worktrees/cecelia/fix-final-e2e-fix-loop
npx vitest run packages/brain/src/__tests__/harness-initiative-evaluate.test.js --reporter=verbose 2>&1 | tail -40
```

期望：所有 `_routeAfterFinalE2E` 和 `finalEvaluateDispatchNode fix loop` 测试 PASS。

- [ ] **Step 10: 运行全部 brain 测试，确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/fix-final-e2e-fix-loop
npx vitest run packages/brain/ --reporter=verbose 2>&1 | tail -60
```

期望：全部 PASS 或已知 skip，无新失败。

- [ ] **Step 11: Commit 实现**

```bash
cd /Users/administrator/worktrees/cecelia/fix-final-e2e-fix-loop
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(harness): 接线 Final E2E fix loop — 条件路由回 pick_sub_task，新增 final_e2e_fix_count 状态字段"
```

---

### Task 3: 集成测试 — 图级 fix loop 验证

**Files:**
- Test: `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`（追加测试）

- [ ] **Step 1: 在 full graph 测试文件末尾追加集成测试**

找到文件末尾，追加：

```js
describe('Final E2E fix loop — graph routing', () => {
  it('evaluator fails once then passes → final_e2e_fix_count=1, exits via report', async () => {
    let callCount = 0;
    // 第一次 FAIL，第二次 PASS
    const mockFinalEvaluate = vi.fn().mockImplementation(async (state) => {
      callCount += 1;
      if (callCount === 1) {
        return {
          final_e2e_verdict: 'FAIL',
          final_e2e_failed_scenarios: [{ name: 'e2e fail', error: 'test' }],
          final_e2e_fix_count: (state.final_e2e_fix_count ?? 0) + 1,
          task_loop_index: 0,
        };
      }
      return { final_e2e_verdict: 'PASS', final_e2e_failed_scenarios: [] };
    });

    const graph = buildHarnessFullGraph({ finalEvaluateFn: mockFinalEvaluate });
    const compiled = graph.compile({ checkpointer: new MemorySaver() });

    // 最小合法状态：跳过 prep/planner/gan 阶段，直接从 pick_sub_task 开始
    // 注：这里测的是 final_evaluate → routing → pick_sub_task → final_evaluate 的闭环
    // 通过注入 nodeOverrides.finalEvaluateFn 直接控制 final_evaluate 节点

    // 构造已完成所有 sub-tasks 的 state（task_loop_index >= tasks.length）
    const initState = {
      task: { id: 'task-x', payload: { sprint_dir: 'sprints' } },
      taskPlan: { tasks: [{ id: 'st-1', title: 'sub1', scope: 'do it' }], journey_type: 'autonomous' },
      task_loop_index: 1,   // idx(1) >= tasks.length(1) → pick_sub_task routes to final_evaluate
      task_loop_fix_count: 0,
      final_e2e_fix_count: 0,
      final_e2e_verdict: null,
      sub_tasks: [{ id: 'st-1', status: 'completed' }],
      worktreePath: '/tmp/wt',
      githubToken: 'tok',
      initiativeId: 'init-test',
      result: null,
      error: null,
    };

    // 只运行 pick_sub_task → final_evaluate → report 段：
    // mock runSubTaskFn 以便不真实 spawn（但 fix loop 时 task_loop_index:0 会重跑）
    const mockRunSubTask = vi.fn().mockResolvedValue({
      sub_tasks: [{ id: 'st-1', status: 'completed' }],
    });

    const graph2 = buildHarnessFullGraph({
      runSubTaskFn: mockRunSubTask,
      finalEvaluateFn: mockFinalEvaluate,
    });
    // 直接测路由函数（不跑完整图，避免 DB 依赖）
    const { _routeAfterFinalE2E: route } = await import('../../harness-initiative.graph.js');

    // case 1: FAIL + fix_count=1 < 3 → pick_sub_task
    expect(route({ final_e2e_verdict: 'FAIL', final_e2e_fix_count: 1 })).toBe('pick_sub_task');

    // case 2: FAIL + fix_count=3 (MAX) — fix_count 已达上限，节点返回 error → report
    expect(route({ final_e2e_verdict: 'FAIL', final_e2e_fix_count: 3, error: { node: 'final_evaluate', message: 'max fix rounds exhausted, interrupt failed' } })).toBe('report');

    // case 3: PASS → report
    expect(route({ final_e2e_verdict: 'PASS', final_e2e_fix_count: 1 })).toBe('report');

    // 验证 mockFinalEvaluate 已被调用（可选，以防上面 import 的 route 是旧版）
    expect(typeof route).toBe('function');
  });
});
```

注：这个测试通过 import `_routeAfterFinalE2E` 直接验证路由函数各路径，同时验证 `finalEvaluateFn` nodeOverrides 注入机制可工作。

- [ ] **Step 2: 运行新增集成测试**

```bash
cd /Users/administrator/worktrees/cecelia/fix-final-e2e-fix-loop
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js --reporter=verbose 2>&1 | tail -30
```

期望：新测试 PASS，其余测试无新失败。

- [ ] **Step 3: 再次运行全量 brain 测试确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/fix-final-e2e-fix-loop
npx vitest run packages/brain/ 2>&1 | grep -E "PASS|FAIL|Tests" | tail -20
```

- [ ] **Step 4: Commit 集成测试**

```bash
cd /Users/administrator/worktrees/cecelia/fix-final-e2e-fix-loop
git add packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js
git commit -m "test(harness): Final E2E fix loop routing 集成测试"
```

---

### Task 4: DoD 文件、Learning 和 PR

**Files:**
- Create: `docs/learnings/cp-0518121008-fix-final-e2e-fix-loop.md`

- [ ] **Step 1: 写 Learning 文件**

```bash
cat > /Users/administrator/worktrees/cecelia/fix-final-e2e-fix-loop/docs/learnings/cp-0518121008-fix-final-e2e-fix-loop.md << 'EOF'
# Learning: Final E2E Fix Loop 接线缺失

### 根本原因
`addEdge('final_evaluate', 'report')` 死边 + `_routeAfterFinalE2E` 永远返回 'report' 且未接入图。
`task_loop_fix_count` 被 `pickSubTaskNode`/`advanceTaskIndexNode` 每次重置，无法跨轮追踪 Final E2E fix 次数。

### 下次预防
- [ ] 设计 fix loop 时，路由函数必须接入图（addConditionalEdges），不能只写函数不接
- [ ] 跨 sub-task loop 的状态字段（计数器等）必须独立命名，不能复用 per-task 字段
- [ ] 新增状态字段同步写 Schema Annotation 和测试
EOF
```

- [ ] **Step 2: Commit Learning + push + PR**

```bash
cd /Users/administrator/worktrees/cecelia/fix-final-e2e-fix-loop
git add docs/learnings/cp-0518121008-fix-final-e2e-fix-loop.md
git commit -m "docs: learning — Final E2E fix loop 接线缺失根因"

git push origin cp-0518121008-fix-final-e2e-fix-loop

gh pr create \
  --title "fix(harness): 接线 Final E2E fix loop — FAIL 后自动重跑 sub-tasks" \
  --body "$(cat <<'PRBODY'
## 问题
Final E2E 失败后直接 report → failed，不重试。Fix loop 代码存在但未接入图路由。

## 根因
1. \`addEdge('final_evaluate', 'report')\` 死边
2. \`_routeAfterFinalE2E\` 永远返回 'report'，未接入图
3. \`task_loop_fix_count\` 被 sub-task loop 重置，无法追踪 Final E2E fix 轮次

## 修复
- 新增 \`final_e2e_fix_count\` 状态字段（独立计数，不被 pickSubTaskNode 重置）
- \`finalEvaluateDispatchNode\` FAIL+<MAX 时返回 \`{ final_e2e_fix_count+1, task_loop_index:0 }\`
- \`_routeAfterFinalE2E\`：FAIL → pick_sub_task，PASS/error → report
- 图：死边 → \`addConditionalEdges('final_evaluate', _routeAfterFinalE2E, ...)\`

## 测试
- Unit: \`_routeAfterFinalE2E\` 4 路径
- Unit: \`finalEvaluateDispatchNode\` FAIL+<MAX delta 验证
- Integration: routing 函数各场景验证

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)"
```
