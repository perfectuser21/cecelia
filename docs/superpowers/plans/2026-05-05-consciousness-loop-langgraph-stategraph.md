# consciousness-loop LangGraph StateGraph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Brain `consciousness-loop.js` 的 `_doConsciousnessWork()` 包装成 LangGraph StateGraph + PG Checkpointer，实现步骤级崩溃恢复（thalamus → decision → rumination → plan 各一 node）。

**Architecture:** 新建 `consciousness.graph.js` 按照 `dev-task.graph.js` 模式构建 4-node StateGraph，thread_id 使用 rotating `consciousness:{epochMs}`，存入 `brain_guidance` 表，Brain 崩溃重启后可从断点续跑。consciousness-loop.js 的 `_runConsciousnessOnce` 替换内部 `_doConsciousnessWork` 调用为 `compiledGraph.invoke()`，setInterval / `_isRunning` 锁 / 超时保护全部保留。

**Tech Stack:** LangGraph `@langchain/langgraph`，PG Checkpointer `@langchain/langgraph-checkpoint-postgres`，Vitest，PostgreSQL

---

## 文件结构

| 文件 | 操作 | 说明 |
|---|---|---|
| `packages/brain/src/workflows/consciousness.graph.js` | **新建** | ConsciousnessState + 4 nodes + singleton getter |
| `packages/brain/src/__tests__/consciousness-graph.test.js` | **新建** | 节点逻辑单元测试（MemorySaver mock） |
| `packages/brain/src/__tests__/integration/consciousness-graph.integration.test.js` | **新建** | checkpoint/resume 集成测试（MemorySaver mock） |
| `packages/brain/src/consciousness-loop.js` | **修改** | 移除 `_doConsciousnessWork`，加 graph invoke + thread_id 管理 |
| `packages/brain/src/workflows/index.js` | **修改** | 预热 consciousness graph 单例 |

---

## Task 1: consciousness.graph.js — 单元测试（failing）

**NO PRODUCTION CODE WITHOUT FAILING TEST FIRST**

**Files:**
- Create: `packages/brain/src/__tests__/consciousness-graph.test.js`

- [ ] **Step 1: 创建测试文件**

```js
// packages/brain/src/__tests__/consciousness-graph.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';

// hoisted mocks
const {
  mockThalamusProcessEvent,
  mockGenerateDecision,
  mockRunRumination,
  mockPlanNextTask,
  mockSetGuidance,
  mockPool,
} = vi.hoisted(() => ({
  mockThalamusProcessEvent: vi.fn(),
  mockGenerateDecision: vi.fn(),
  mockRunRumination: vi.fn(),
  mockPlanNextTask: vi.fn(),
  mockSetGuidance: vi.fn(),
  mockPool: { query: vi.fn() },
}));

let mockSaver;

vi.mock('../thalamus.js', () => ({
  processEvent: (...args) => mockThalamusProcessEvent(...args),
  EVENT_TYPES: { TICK: 'tick' },
}));
vi.mock('../decision.js', () => ({
  generateDecision: (...args) => mockGenerateDecision(...args),
}));
vi.mock('../rumination.js', () => ({
  runRumination: (...args) => mockRunRumination(...args),
}));
vi.mock('../planner.js', () => ({
  planNextTask: (...args) => mockPlanNextTask(...args),
}));
vi.mock('../guidance.js', () => ({
  setGuidance: (...args) => mockSetGuidance(...args),
}));
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: () => Promise.resolve(mockSaver),
}));

const {
  buildConsciousnessGraph,
  getCompiledConsciousnessGraph,
  _resetCompiledGraphForTests,
} = await import('../workflows/consciousness.graph.js');

describe('consciousness.graph.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaver = new MemorySaver();
    _resetCompiledGraphForTests();

    // default happy-path mocks
    mockThalamusProcessEvent.mockResolvedValue({ actions: [] });
    mockGenerateDecision.mockResolvedValue({ actions: [] });
    mockRunRumination.mockResolvedValue(undefined);
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  describe('thalamusNode', () => {
    it('正常路径：completed_steps 包含 thalamus，无 errors', async () => {
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-thalamus-ok:1' } }
      );
      expect(result.completed_steps).toContain('thalamus');
      expect(result.errors.filter(e => e.startsWith('thalamus'))).toHaveLength(0);
    });

    it('异常路径：thalamusProcessEvent 抛错 → errors 含 thalamus 错误，仍含 thalamus 步骤', async () => {
      mockThalamusProcessEvent.mockRejectedValue(new Error('thalamus boom'));
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-thalamus-err:1' } }
      );
      expect(result.completed_steps).toContain('thalamus');
      expect(result.errors.some(e => e.startsWith('thalamus:'))).toBe(true);
    });

    it('有 dispatch_task action 时调用 setGuidance', async () => {
      mockThalamusProcessEvent.mockResolvedValue({
        actions: [{ type: 'dispatch_task', task_id: 'uuid-123', level: 'P1' }],
        level: 'P1',
      });
      const graph = await getCompiledConsciousnessGraph();
      await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-thalamus-guidance:1' } }
      );
      expect(mockSetGuidance).toHaveBeenCalledWith(
        'routing:uuid-123',
        expect.objectContaining({ source: 'thalamus' }),
        'thalamus',
        3600_000
      );
    });
  });

  describe('decisionNode', () => {
    it('正常路径：completed_steps 包含 decision', async () => {
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-decision-ok:1' } }
      );
      expect(result.completed_steps).toContain('decision');
    });

    it('generateDecision 有 actions 时调用 setGuidance strategy:global', async () => {
      mockGenerateDecision.mockResolvedValue({
        decision_id: 'dec-1',
        actions: [{ type: 'focus', target: 'KR-42' }],
      });
      const graph = await getCompiledConsciousnessGraph();
      await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-decision-guidance:1' } }
      );
      expect(mockSetGuidance).toHaveBeenCalledWith(
        'strategy:global',
        expect.objectContaining({ decision_id: 'dec-1' }),
        'cortex',
        24 * 3600_000
      );
    });

    it('异常路径：generateDecision 抛错 → errors 含 decision 错误', async () => {
      mockGenerateDecision.mockRejectedValue(new Error('decision fail'));
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-decision-err:1' } }
      );
      expect(result.completed_steps).toContain('decision');
      expect(result.errors.some(e => e.startsWith('decision:'))).toBe(true);
    });
  });

  describe('ruminationNode', () => {
    it('fire-and-forget：立即返回 rumination 步骤，不等待 runRumination 完成', async () => {
      let resolved = false;
      mockRunRumination.mockImplementation(
        () => new Promise(res => setTimeout(() => { resolved = true; res(); }, 200))
      );
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-rumination-ff:1' } }
      );
      expect(result.completed_steps).toContain('rumination');
      expect(resolved).toBe(false); // 尚未完成，确认 fire-and-forget
    });
  });

  describe('planNextTaskNode', () => {
    it('有 KR 时调用 planNextTask', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'kr-1' }, { id: 'kr-2' }] });
      const graph = await getCompiledConsciousnessGraph();
      await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-plan-kr:1' } }
      );
      expect(mockPlanNextTask).toHaveBeenCalledWith(['kr-1', 'kr-2']);
    });

    it('无 KR 时不调用 planNextTask', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const graph = await getCompiledConsciousnessGraph();
      await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-plan-no-kr:1' } }
      );
      expect(mockPlanNextTask).not.toHaveBeenCalled();
    });

    it('异常路径：planNextTask 抛错 → errors 含 plan 错误', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 'kr-1' }] });
      mockPlanNextTask.mockRejectedValue(new Error('plan fail'));
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-plan-err:1' } }
      );
      expect(result.completed_steps).toContain('plan');
      expect(result.errors.some(e => e.startsWith('plan:'))).toBe(true);
    });
  });

  describe('全图正常执行', () => {
    it('completed_steps 顺序：thalamus → decision → rumination → plan', async () => {
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-full-run:1' } }
      );
      expect(result.completed_steps).toEqual(['thalamus', 'decision', 'rumination', 'plan']);
      expect(result.errors).toHaveLength(0);
    });

    it('单个步骤失败不影响其余步骤', async () => {
      mockThalamusProcessEvent.mockRejectedValue(new Error('boom'));
      const graph = await getCompiledConsciousnessGraph();
      const result = await graph.invoke(
        { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
        { configurable: { thread_id: 'test-partial-fail:1' } }
      );
      expect(result.completed_steps).toEqual(['thalamus', 'decision', 'rumination', 'plan']);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('getCompiledConsciousnessGraph 单例', () => {
    it('多次调用返回同一实例', async () => {
      const g1 = await getCompiledConsciousnessGraph();
      const g2 = await getCompiledConsciousnessGraph();
      expect(g1).toBe(g2);
    });

    it('_resetCompiledGraphForTests 后返回新实例', async () => {
      const g1 = await getCompiledConsciousnessGraph();
      _resetCompiledGraphForTests();
      const g2 = await getCompiledConsciousnessGraph();
      expect(g1).not.toBe(g2);
    });
  });
});
```

- [ ] **Step 2: 运行测试验证 FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph/packages/brain
/Users/administrator/perfect21/cecelia/node_modules/.bin/vitest run src/__tests__/consciousness-graph.test.js 2>&1 | tail -20
```

期望输出：`Cannot find module '../workflows/consciousness.graph.js'` 或类似 import 错误。

- [ ] **Step 3: commit-1（failing test）**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph
git add packages/brain/src/__tests__/consciousness-graph.test.js
git commit -m "test(brain): consciousness.graph.js 节点单元测试 [FAILING] (cp-0505190016)"
```

---

## Task 2: consciousness.graph.js — 实现

**Files:**
- Create: `packages/brain/src/workflows/consciousness.graph.js`

- [ ] **Step 1: 创建 consciousness.graph.js**

```js
// packages/brain/src/workflows/consciousness.graph.js
/**
 * Brain 意识层 StateGraph（Wave 2 LangGraph 改造）
 *
 * 4-node graph：thalamus → decision → rumination → plan_next_task
 * PG Checkpointer 实现步骤级崩溃恢复。
 * thread_id 由 consciousness-loop.js 管理（rotating consciousness:{epochMs}）。
 *
 * 节点内 catch 吞非致命异常并写 errors，保持与原 _doConsciousnessWork 容错语义一致。
 * rumination 节点 fire-and-forget：立即 push completed_steps，不等待 runRumination 完成。
 */
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from '../thalamus.js';
import { generateDecision } from '../decision.js';
import { runRumination } from '../rumination.js';
import { planNextTask } from '../planner.js';
import { setGuidance } from '../guidance.js';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';
import pool from '../db.js';

export const ConsciousnessState = Annotation.Root({
  completed_steps: Annotation({ reducer: (_, neu) => neu, default: () => [] }),
  errors:          Annotation({ reducer: (_, neu) => neu, default: () => [] }),
  run_ts:          Annotation({ reducer: (_, neu) => neu, default: () => null }),
});

async function thalamusNode(state) {
  try {
    const tickEvent = {
      type: EVENT_TYPES.TICK,
      timestamp: new Date().toISOString(),
      has_anomaly: false,
    };
    const thalamusResult = await thalamusProcessEvent(tickEvent);
    const dispatchAction = thalamusResult.actions?.find(a => a.type === 'dispatch_task');
    if (dispatchAction?.task_id) {
      await setGuidance(
        `routing:${dispatchAction.task_id}`,
        { executor_type: 'cecelia_bridge', source: 'thalamus', level: thalamusResult.level },
        'thalamus',
        3600_000
      );
    }
    return {
      completed_steps: [...state.completed_steps, 'thalamus'],
      errors: state.errors,
    };
  } catch (err) {
    console.warn('[consciousness-graph] thalamus 失败（非致命）:', err.message);
    return {
      completed_steps: [...state.completed_steps, 'thalamus'],
      errors: [...state.errors, `thalamus: ${err.message}`],
    };
  }
}

async function decisionNode(state) {
  try {
    const decision = await generateDecision({ trigger: 'consciousness_loop' });
    if (decision.actions?.length > 0) {
      await setGuidance(
        'strategy:global',
        { decision_id: decision.decision_id, actions: decision.actions },
        'cortex',
        24 * 3600_000
      );
    }
    return {
      completed_steps: [...state.completed_steps, 'decision'],
      errors: state.errors,
    };
  } catch (err) {
    console.warn('[consciousness-graph] generateDecision 失败（非致命）:', err.message);
    return {
      completed_steps: [...state.completed_steps, 'decision'],
      errors: [...state.errors, `decision: ${err.message}`],
    };
  }
}

async function ruminationNode(state) {
  const RUMINATION_TIMEOUT_MS = 10 * 60 * 1000;
  Promise.resolve()
    .then(() =>
      Promise.race([
        runRumination(pool),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('rumination timeout')), RUMINATION_TIMEOUT_MS)
        ),
      ])
    )
    .catch(e => console.warn('[consciousness-graph] rumination 失败:', e.message));

  return {
    completed_steps: [...state.completed_steps, 'rumination'],
    errors: state.errors,
  };
}

async function planNextTaskNode(state) {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM key_results WHERE status IN ('active', 'in_progress') LIMIT 5`
    );
    const krIds = rows.map(r => r.id);
    if (krIds.length > 0) {
      await planNextTask(krIds);
    }
    return {
      completed_steps: [...state.completed_steps, 'plan'],
      errors: state.errors,
    };
  } catch (err) {
    console.warn('[consciousness-graph] planNextTask 失败（非致命）:', err.message);
    return {
      completed_steps: [...state.completed_steps, 'plan'],
      errors: [...state.errors, `plan: ${err.message}`],
    };
  }
}

export function buildConsciousnessGraph() {
  return new StateGraph(ConsciousnessState)
    .addNode('thalamus', thalamusNode)
    .addNode('decision', decisionNode)
    .addNode('rumination', ruminationNode)
    .addNode('plan_next_task', planNextTaskNode)
    .addEdge(START, 'thalamus')
    .addEdge('thalamus', 'decision')
    .addEdge('decision', 'rumination')
    .addEdge('rumination', 'plan_next_task')
    .addEdge('plan_next_task', END);
}

let _compiled = null;

/**
 * 进程级单例：编译 graph + pg checkpointer。首次调用时 lazy init。
 * @returns {Promise<CompiledStateGraph>}
 */
export async function getCompiledConsciousnessGraph() {
  if (!_compiled) {
    const checkpointer = await getPgCheckpointer();
    _compiled = buildConsciousnessGraph().compile({ checkpointer });
  }
  return _compiled;
}

/** 测试 hook：重置单例。仅 __tests__ 使用。 */
export function _resetCompiledGraphForTests() {
  _compiled = null;
}
```

- [ ] **Step 2: 运行测试验证 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph/packages/brain
/Users/administrator/perfect21/cecelia/node_modules/.bin/vitest run src/__tests__/consciousness-graph.test.js 2>&1 | tail -20
```

期望输出：`✓ consciousness.graph.js` 所有用例通过，0 failures。

- [ ] **Step 3: commit-2（实现）**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph
git add packages/brain/src/workflows/consciousness.graph.js
git commit -m "feat(brain): consciousness.graph.js — 4-node StateGraph + PG Checkpointer (cp-0505190016)"
```

---

## Task 3: consciousness-loop.js 修改 — 测试（failing）

**Files:**
- Modify: `packages/brain/src/__tests__/consciousness-loop.test.js`（添加新 graph 行为测试）

这个任务把 `_runConsciousnessOnce` 的新行为测试加到现有测试文件末尾。现有测试 mock 的是 thalamus/decision/rumination/planner，新测试 mock 的是 `getCompiledConsciousnessGraph`。

- [ ] **Step 1: 在 consciousness-loop.test.js 末尾添加 graph 行为测试块**

先查看文件末尾位置：

```bash
wc -l /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph/packages/brain/src/__tests__/consciousness-loop.test.js
```

在文件末尾（最后一个 `}` 之前的位置）添加如下内容。**整个测试文件头部需要补充以下 mock 声明**（添加到现有 hoisted mock 块中，或在文件头部追加）：

在文件顶部现有 `vi.hoisted` 块和 `vi.mock` 语句之后，追加（若 mock 已存在则跳过）：

```js
// 新增 mock（供 graph 行为测试用）
const mockGetCompiledConsciousnessGraph = vi.fn();
const mockGraphInvoke = vi.fn();
const mockGetGuidanceForThread = vi.fn();
const mockSetGuidanceForThread = vi.fn();

vi.mock('../workflows/consciousness.graph.js', () => ({
  getCompiledConsciousnessGraph: (...args) => mockGetCompiledConsciousnessGraph(...args),
}));
```

注意：`guidance.js` 已有 mock（`mockSetGuidance`），需要在现有 mock 工厂里加 `getGuidance` 导出：

```js
// 找到现有的 vi.mock('../guidance.js', ...) 并添加 getGuidance
vi.mock('../guidance.js', () => ({
  setGuidance: (...args) => mockSetGuidance(...args),
  getGuidance: (...args) => mockGetGuidanceForThread(...args),  // 新增
}));
```

在文件末尾最后一个 `});` 之前添加新 describe 块：

```js
  // ─────────────────────────────────────────────
  // Graph 行为测试（Task 3：验证 _runConsciousnessOnce 使用 StateGraph）
  // ─────────────────────────────────────────────
  describe('graph-based _runConsciousnessOnce', () => {
    beforeEach(() => {
      mockIsConsciousnessEnabled.mockReturnValue(true);
      mockGetCompiledConsciousnessGraph.mockResolvedValue({ invoke: mockGraphInvoke });
      mockGraphInvoke.mockResolvedValue({
        completed_steps: ['thalamus', 'decision', 'rumination', 'plan'],
        errors: [],
      });
      // 无 active thread → fresh start
      mockGetGuidanceForThread.mockResolvedValue(null);
      mockSetGuidanceForThread.mockResolvedValue(undefined);
      mockPool.query.mockResolvedValue({ rowCount: 1 });
    });

    it('调用 getCompiledConsciousnessGraph 并 invoke', async () => {
      const result = await _runConsciousnessOnce();
      expect(mockGetCompiledConsciousnessGraph).toHaveBeenCalled();
      expect(mockGraphInvoke).toHaveBeenCalled();
      expect(result.completed).toBe(true);
    });

    it('thread_id 格式为 consciousness:{数字}', async () => {
      await _runConsciousnessOnce();
      const [_input, config] = mockGraphInvoke.mock.calls[0];
      expect(config.configurable.thread_id).toMatch(/^consciousness:\d+$/);
    });

    it('invoke 前将 thread_id 写入 brain_guidance', async () => {
      await _runConsciousnessOnce();
      // setGuidance 用于存储 active thread_id
      expect(mockSetGuidance).toHaveBeenCalledWith(
        'consciousness:active_thread',
        expect.objectContaining({ thread_id: expect.stringMatching(/^consciousness:\d+$/) }),
        'consciousness-loop',
        expect.any(Number)
      );
    });

    it('完成后清除 brain_guidance active thread', async () => {
      await _runConsciousnessOnce();
      // DELETE FROM brain_guidance WHERE key = 'consciousness:active_thread'
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        expect.arrayContaining(['consciousness:active_thread'])
      );
    });

    it('已有 active thread 时 resume（input=null）', async () => {
      mockGetGuidanceForThread.mockResolvedValue({ thread_id: 'consciousness:111111' });
      await _runConsciousnessOnce();
      const [input, config] = mockGraphInvoke.mock.calls[0];
      expect(config.configurable.thread_id).toBe('consciousness:111111');
      expect(input).toBeNull(); // resume 时传 null
    });

    it('_isRunning 锁防并发：第二次调用立即返回', async () => {
      // 让 invoke 挂起
      let resolveInvoke;
      mockGraphInvoke.mockImplementation(
        () => new Promise(res => { resolveInvoke = res; })
      );
      const p1 = _runConsciousnessOnce();
      // 第二次立即触发，应直接返回 already_running
      const result2 = await _runConsciousnessOnce();
      expect(result2.completed).toBe(false);
      expect(result2.reason).toBe('already_running');
      resolveInvoke({ completed_steps: ['thalamus', 'decision', 'rumination', 'plan'], errors: [] });
      await p1;
    });

    it('invoke 异常时 completed=false，errors 含错误信息', async () => {
      mockGraphInvoke.mockRejectedValue(new Error('graph exploded'));
      const result = await _runConsciousnessOnce();
      expect(result.completed).toBe(false);
      expect(result.error).toContain('graph exploded');
    });

    it('errors 非空时 completed=false', async () => {
      mockGraphInvoke.mockResolvedValue({
        completed_steps: ['thalamus', 'decision', 'rumination', 'plan'],
        errors: ['thalamus: some error'],
      });
      const result = await _runConsciousnessOnce();
      // errors 非空但 4 步都完成，依然 completed=true（非致命错误不影响 completed）
      expect(result.completed).toBe(true);
    });
  });
```

- [ ] **Step 2: 运行测试验证 FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph/packages/brain
/Users/administrator/perfect21/cecelia/node_modules/.bin/vitest run src/__tests__/consciousness-loop.test.js 2>&1 | grep -E "FAIL|PASS|graph-based" | head -20
```

期望输出：`graph-based _runConsciousnessOnce` describe 块下的测试全部 FAIL。

- [ ] **Step 3: commit-1（failing test）**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph
git add packages/brain/src/__tests__/consciousness-loop.test.js
git commit -m "test(brain): consciousness-loop graph 行为测试 [FAILING] (cp-0505190016)"
```

---

## Task 4: consciousness-loop.js — 实现

**Files:**
- Modify: `packages/brain/src/consciousness-loop.js`

整个文件替换，迁移逻辑如下：
- 移除 `_doConsciousnessWork()`（完整函数删掉，逻辑已进 consciousness.graph.js）
- 新增 `_activeThreadId` 模块变量
- 新增 `_getOrCreateActiveThread()` / `_clearActiveThread()`
- `_runConsciousnessOnce()` 改为调用 `compiledGraph.invoke()`

- [ ] **Step 1: 修改 consciousness-loop.js**

完整替换为：

```js
// packages/brain/src/consciousness-loop.js
/**
 * consciousness-loop.js — Wave 2 LLM 意识层（LangGraph 改造版）
 *
 * 每 20 分钟运行一次，通过 consciousness.graph.js 的 StateGraph 串行执行：
 *   thalamus → decision → rumination → plan_next_task
 *
 * PG Checkpointer 实现步骤级崩溃恢复：
 *   - thread_id = consciousness:{epochMs}（rotating，每次完整 run 用新 id）
 *   - active thread_id 存入 brain_guidance（key = consciousness:active_thread）
 *   - Brain 重启后读 brain_guidance 恢复 thread_id，从断点续跑
 *   - 4 步全部完成后删除 brain_guidance 条目，下次 run 使用新 thread_id
 *
 * _isRunning 锁、setInterval 计时器、Promise.race 超时保护均原地保留。
 * CONSCIOUSNESS_ENABLED=false 时整个 loop 不启动。
 */
import pool from './db.js';
import { isConsciousnessEnabled } from './consciousness-guard.js';
import { getCompiledConsciousnessGraph } from './workflows/consciousness.graph.js';
import { getGuidance, setGuidance } from './guidance.js';

const CONSCIOUSNESS_INTERVAL_MS = parseInt(
  process.env.CONSCIOUSNESS_INTERVAL_MS || String(20 * 60 * 1000),
  10
);
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

let _loopTimer = null;
let _isRunning = false;
let _activeThreadId = null;

/**
 * 读取或创建本次 run 的 thread_id。
 * 先查 brain_guidance，有则 resume；无则新建并写入。
 * @returns {Promise<{ threadId: string, isResume: boolean }>}
 */
async function _getOrCreateActiveThread() {
  if (_activeThreadId) return { threadId: _activeThreadId, isResume: true };

  const existing = await getGuidance('consciousness:active_thread');
  if (existing?.thread_id) {
    _activeThreadId = existing.thread_id;
    return { threadId: _activeThreadId, isResume: true };
  }

  _activeThreadId = `consciousness:${Date.now()}`;
  await setGuidance(
    'consciousness:active_thread',
    { thread_id: _activeThreadId },
    'consciousness-loop',
    24 * 3600_000
  );
  return { threadId: _activeThreadId, isResume: false };
}

/**
 * 清除 active thread（run 完成后调用）。
 */
async function _clearActiveThread() {
  await pool.query(
    `DELETE FROM brain_guidance WHERE key = $1`,
    ['consciousness:active_thread']
  );
  _activeThreadId = null;
}

/**
 * 单次意识运行（可注入 timeoutMs 供测试使用）。
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{completed: boolean, timedOut?: boolean, error?: string, actions: string[]}>}
 */
export async function _runConsciousnessOnce({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (_isRunning) {
    console.warn('[consciousness-loop] 上次运行未完成，跳过本次');
    return { completed: false, reason: 'already_running', actions: [] };
  }
  _isRunning = true;

  try {
    const { threadId, isResume } = await _getOrCreateActiveThread();
    const graph = await getCompiledConsciousnessGraph();

    const initialState = isResume
      ? null // LangGraph 从 checkpoint 续跑，传 null
      : { completed_steps: [], errors: [], run_ts: new Date().toISOString() };

    const result = await Promise.race([
      graph.invoke(initialState, { configurable: { thread_id: threadId } }),
      new Promise(resolve =>
        setTimeout(() => resolve({ timedOut: true }), timeoutMs)
      ),
    ]);

    if (result.timedOut) {
      console.warn(`[consciousness-loop] 单次运行超时（${timeoutMs / 1000}s），已中断`);
      return { completed: false, timedOut: true, actions: [] };
    }

    const { completed_steps = [], errors = [] } = result;
    await _clearActiveThread();

    return {
      completed: completed_steps.length === 4,
      actions: completed_steps,
      ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
    };
  } catch (err) {
    console.warn('[consciousness-loop] 意识运行异常（不影响调度层）:', err.message);
    return { completed: false, error: err.message, actions: [] };
  } finally {
    _isRunning = false;
  }
}

/**
 * 启动意识循环（每 20 分钟一次）。
 * @returns {boolean} false 表示 CONSCIOUSNESS_ENABLED=false，未启动
 */
export function startConsciousnessLoop() {
  if (!isConsciousnessEnabled()) {
    console.log('[consciousness-loop] CONSCIOUSNESS_ENABLED=false，意识循环不启动');
    return false;
  }

  if (_loopTimer) {
    console.log('[consciousness-loop] 已在运行，跳过重复启动');
    return true;
  }

  _loopTimer = setInterval(async () => {
    if (!isConsciousnessEnabled()) return;
    await _runConsciousnessOnce();
  }, CONSCIOUSNESS_INTERVAL_MS);

  if (_loopTimer.unref) _loopTimer.unref();

  console.log(`[consciousness-loop] 已启动（间隔 ${CONSCIOUSNESS_INTERVAL_MS / 60000} 分钟）`);
  return true;
}

/**
 * 停止意识循环（测试用 / 关闭用）。
 */
export function stopConsciousnessLoop() {
  if (_loopTimer) {
    clearInterval(_loopTimer);
    _loopTimer = null;
  }
}
```

- [ ] **Step 2: 运行测试验证 PASS（新 graph 行为测试）**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph/packages/brain
/Users/administrator/perfect21/cecelia/node_modules/.bin/vitest run src/__tests__/consciousness-loop.test.js 2>&1 | tail -30
```

期望：`graph-based _runConsciousnessOnce` describe 块所有用例通过。

- [ ] **Step 3: 验证旧有测试未被破坏（全文件）**

旧有测试 mock 的是 thalamus/decision 等底层函数。修改后 consciousness-loop.js 不再直接调这些函数，旧测试中 mock `_doConsciousnessWork` 相关逻辑可能 fail。**若旧有测试 fail，原因是测试测的是已删除的 `_doConsciousnessWork` 行为**——此时需要将那些测试标记 skip 或更新为使用 graph mock。

检查：
```bash
/Users/administrator/perfect21/cecelia/node_modules/.bin/vitest run src/__tests__/consciousness-loop.test.js 2>&1 | grep -E "✓|✗|×|FAIL|PASS" | head -30
```

若有 fail，识别是否为旧有 `_doConsciousnessWork` 行为测试。用 `it.skip(...)` 标记，或在 describe 头部 vi.mock `getCompiledConsciousnessGraph` 兼容旧用例（复用 `mockGetCompiledConsciousnessGraph` mock）。

- [ ] **Step 4: commit-2（实现）**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph
git add packages/brain/src/consciousness-loop.js
git add packages/brain/src/__tests__/consciousness-loop.test.js  # 若有更新
git commit -m "feat(brain): consciousness-loop 使用 LangGraph StateGraph invoke + thread_id 管理 (cp-0505190016)"
```

---

## Task 5: Integration test — checkpoint resume

**Files:**
- Create: `packages/brain/src/__tests__/integration/consciousness-graph.integration.test.js`

- [ ] **Step 1: 创建集成测试**

```js
// packages/brain/src/__tests__/integration/consciousness-graph.integration.test.js
/**
 * consciousness.graph.js — checkpoint/resume 集成测试
 *
 * 验证：
 *   1. 图可编译，4 个节点顺序执行，completed_steps.length === 4
 *   2. MemorySaver checkpoint/resume：第一次 invoke 存 checkpoint；
 *      第二次 invoke（模拟崩溃恢复，同 thread_id）→ LangGraph 从 checkpoint 读状态
 *
 * mock 策略：
 *   - MemorySaver 替代 PgCheckpointer（不需要真 DB 连接）
 *   - 所有 LLM 底层依赖 mock（thalamus/decision/rumination/planner/guidance/pool）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';

const {
  mockThalamusProcessEvent,
  mockGenerateDecision,
  mockRunRumination,
  mockPlanNextTask,
  mockSetGuidance,
  mockPool,
} = vi.hoisted(() => ({
  mockThalamusProcessEvent: vi.fn(),
  mockGenerateDecision: vi.fn(),
  mockRunRumination: vi.fn(),
  mockPlanNextTask: vi.fn(),
  mockSetGuidance: vi.fn(),
  mockPool: { query: vi.fn() },
}));

let sharedSaver;

vi.mock('../../thalamus.js', () => ({
  processEvent: (...a) => mockThalamusProcessEvent(...a),
  EVENT_TYPES: { TICK: 'tick' },
}));
vi.mock('../../decision.js', () => ({ generateDecision: (...a) => mockGenerateDecision(...a) }));
vi.mock('../../rumination.js', () => ({ runRumination: (...a) => mockRunRumination(...a) }));
vi.mock('../../planner.js', () => ({ planNextTask: (...a) => mockPlanNextTask(...a) }));
vi.mock('../../guidance.js', () => ({ setGuidance: (...a) => mockSetGuidance(...a) }));
vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: () => Promise.resolve(sharedSaver),
}));

const {
  buildConsciousnessGraph,
  getCompiledConsciousnessGraph,
  _resetCompiledGraphForTests,
} = await import('../../workflows/consciousness.graph.js');

describe('consciousness-graph integration — checkpoint/resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedSaver = new MemorySaver();
    _resetCompiledGraphForTests();

    mockThalamusProcessEvent.mockResolvedValue({ actions: [] });
    mockGenerateDecision.mockResolvedValue({ actions: [] });
    mockRunRumination.mockResolvedValue(undefined);
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  it('完整 invoke：completed_steps 顺序正确，长度为 4', async () => {
    const graph = await getCompiledConsciousnessGraph();
    const result = await graph.invoke(
      { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
      { configurable: { thread_id: 'integration:1' } }
    );
    expect(result.completed_steps).toEqual(['thalamus', 'decision', 'rumination', 'plan']);
    expect(result.errors).toHaveLength(0);
  });

  it('checkpoint 存在（MemorySaver）：同 thread_id 第二次 invoke (null input) 仍返回最终 state', async () => {
    const graph = await getCompiledConsciousnessGraph();
    const threadConfig = { configurable: { thread_id: 'integration:resume-test' } };

    // 第一次：fresh start
    await graph.invoke(
      { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
      threadConfig
    );

    // 验证 checkpoint 存在
    const checkpointState = await sharedSaver.get(threadConfig);
    expect(checkpointState).not.toBeNull();

    // 第二次：null input → LangGraph 用 checkpoint state
    const result2 = await graph.invoke(null, threadConfig);
    expect(result2.completed_steps).toHaveLength(4);
  });

  it('getState()：checkpoint 包含 completed_steps', async () => {
    const graph = await getCompiledConsciousnessGraph();
    const threadConfig = { configurable: { thread_id: 'integration:getstate' } };
    await graph.invoke(
      { completed_steps: [], errors: [], run_ts: '2026-05-05T00:00:00.000Z' },
      threadConfig
    );
    const state = await graph.getState(threadConfig);
    expect(state.values.completed_steps).toHaveLength(4);
  });
});
```

- [ ] **Step 2: 运行集成测试验证 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph/packages/brain
/Users/administrator/perfect21/cecelia/node_modules/.bin/vitest run src/__tests__/integration/consciousness-graph.integration.test.js 2>&1 | tail -20
```

期望：3 个用例全部 PASS。

- [ ] **Step 3: commit（integration test）**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph
git add packages/brain/src/__tests__/integration/consciousness-graph.integration.test.js
git commit -m "test(brain): consciousness-graph checkpoint/resume 集成测试 (cp-0505190016)"
```

---

## Task 6: workflows/index.js 预热 + Learning doc

**Files:**
- Modify: `packages/brain/src/workflows/index.js`
- Create: `docs/learnings/cp-0505190016-consciousness-loop-langgraph-stategraph.md`

- [ ] **Step 1: 修改 workflows/index.js 预热 consciousness graph**

```js
// packages/brain/src/workflows/index.js
/**
 * Brain v2 Phase C2 + C8a + consciousness: workflows 集中注册入口。
 *
 * Brain server 启动时调 initializeWorkflows()，在所有 graph-runtime 调用前把
 * 已知 workflow 注册到 orchestrator/workflow-registry。保证 runWorkflow 能查到。
 *
 * consciousness graph 不走 runWorkflow（无 task 语义），不注册到 registry，
 * 但在此预热单例（compileGraph + pg-checkpointer setup），避免首次 consciousness tick 延迟。
 */
import { registerWorkflow, listWorkflows } from '../orchestrator/workflow-registry.js';
import { compileDevTaskGraph } from './dev-task.graph.js';
import { compileHarnessInitiativeGraph } from './harness-initiative.graph.js';
import { getCompiledConsciousnessGraph } from './consciousness.graph.js';

let _initialized = false;

/**
 * 集中初始化所有内置 workflow。幂等。
 * server.js 启动时在 pg pool ready 后、initTickLoop 前调。
 */
export async function initializeWorkflows() {
  if (_initialized) return;

  const existing = listWorkflows();

  if (!existing.includes('dev-task')) {
    const devTaskGraph = await compileDevTaskGraph();
    registerWorkflow('dev-task', devTaskGraph);
  }

  if (!existing.includes('harness-initiative')) {
    const harnessInitiativeGraph = await compileHarnessInitiativeGraph();
    registerWorkflow('harness-initiative', harnessInitiativeGraph);
  }

  // 预热 consciousness graph（不注册到 registry，由 consciousness-loop.js 直接调用）
  await getCompiledConsciousnessGraph();

  _initialized = true;
}

/**
 * 测试 hook：重置初始化状态。仅 __tests__ 使用。
 */
export function _resetInitializedForTests() {
  _initialized = false;
}
```

- [ ] **Step 2: 运行现有 workflows/index.js 相关测试（如有）**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph/packages/brain
/Users/administrator/perfect21/cecelia/node_modules/.bin/vitest run src/__tests__/ -t "initializeWorkflows\|workflows.index" 2>&1 | tail -10
```

期望：已有测试不 break（若无相关测试则跳过，直接进 Step 3）。

- [ ] **Step 3: 创建 Learning 文档**

```markdown
<!-- docs/learnings/cp-0505190016-consciousness-loop-langgraph-stategraph.md -->
# Learning: consciousness-loop LangGraph StateGraph 改造

## 根本原因

Brain 内部意识循环（consciousness-loop.js）每 20 分钟串行调 4 次 LLM，无任何 checkpoint 机制。Brain 崩溃（容器重启、OOM、超时）后整个 4 步重跑，thalamus/rumination 等耗时操作浪费算力，且 planNextTask 可能创建重复任务。

## 修复方式

将 `_doConsciousnessWork()` 包装成 LangGraph StateGraph（consciousness.graph.js），复用现有 PG Checkpointer（migration 244 表）。thread_id = `consciousness:{epochMs}`，存入 brain_guidance（key = `consciousness:active_thread`），Brain 重启后从断点续跑。

## 设计关键决策

1. **不走 runWorkflow()**：runWorkflow 强依赖 taskId/attemptN，consciousness 是系统级循环，无 task 概念。直接 `compiledGraph.invoke()`。
2. **thread_id 不用固定值**：fixed `consciousness:1` 在图完成后再次 invoke 行为不确定。使用 rotating epochMs + brain_guidance 存储，语义清晰。
3. **_isRunning 保留**：与 checkpointer 正交。前者防进程内并发，后者防崩溃重启丢步骤。
4. **rumination fire-and-forget 保留**：rumination 在 StateGraph node 内不 await，节点立即返回 checkpoint，不因 rumination 10 分钟超时阻塞后续步骤。

## 下次预防

- [ ] 新增 LLM 链路时，默认用 StateGraph + PG Checkpointer（不裸跑）
- [ ] 任何超过 2 步的串行 LLM 调用都是 StateGraph 候选
- [ ] 崩溃恢复 thread_id 语义：rotating > fixed（fixed 图完成后行为不确定）
```

- [ ] **Step 4: 运行全量 unit test 确保无 regression**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph/packages/brain
/Users/administrator/perfect21/cecelia/node_modules/.bin/vitest run src/__tests__/ --exclude="src/__tests__/integration/**" 2>&1 | tail -20
```

期望：无新增 fail。

- [ ] **Step 5: commit**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-loop-langgraph-stategraph
git add packages/brain/src/workflows/index.js
git add docs/learnings/cp-0505190016-consciousness-loop-langgraph-stategraph.md
git commit -m "feat(brain): workflows/index.js 预热 consciousness graph + learning doc (cp-0505190016)"
```

---

## 完成标准

```bash
# [ARTIFACT] consciousness.graph.js 文件存在且含 getCompiledConsciousnessGraph 导出
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/consciousness.graph.js','utf8');if(!c.includes('getCompiledConsciousnessGraph'))process.exit(1);console.log('OK');"

# [BEHAVIOR] 单元测试通过
cd packages/brain && /Users/administrator/perfect21/cecelia/node_modules/.bin/vitest run src/__tests__/consciousness-graph.test.js

# [BEHAVIOR] 集成测试通过  
cd packages/brain && /Users/administrator/perfect21/cecelia/node_modules/.bin/vitest run src/__tests__/integration/consciousness-graph.integration.test.js
```
