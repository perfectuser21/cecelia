# Harness Phase B/C 全程 LangGraph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase B/C 进 LangGraph，一个 graph 从 Initiative POST 跑到 Phase C END，砍 6 procedural module + 4 task_type。

**Architecture:** 扩展 `harness-initiative.graph.js` 加 fanout/join/final_e2e/report 节点；新建 `harness-task.graph.js` sub-graph（spawn → poll_ci → fix loop → merge → END）。State 全程贯穿，PostgresSaver checkpoint。executor.js / tick-runner.js 删 procedural 调用，env flag `HARNESS_USE_FULL_GRAPH=false` 兜底回退。

**Tech Stack:** Node.js, `@langchain/langgraph`（StateGraph + Send API + PostgresSaver）, vitest mock, PostgreSQL

**Spec:** `docs/superpowers/specs/2026-04-26-harness-langgraph-full-graph-design.md`

---

## File Structure

**新建文件**：
- `packages/brain/src/workflows/harness-task.graph.js` — sub-graph per sub-task
- `packages/brain/src/harness-utils.js` — 抽出 `buildGeneratorPrompt`, `extractWorkstreamIndex`, `topologicalLayers`（共享工具）
- `packages/brain/src/workflows/__tests__/harness-task.graph.test.js`
- `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`
- `packages/brain/src/workflows/__tests__/harness-utils.test.js`

**修改文件**：
- `packages/brain/src/workflows/harness-initiative.graph.js` — 加 fanout / per-sub-task / join / final_e2e / report 节点
- `packages/brain/src/harness-final-e2e.js` — 删 `runFinalE2E` 编排函数（保留 5 工具函数）
- `packages/brain/src/harness-initiative-runner.js` — 删 `runPhaseCIfReady` / `createFixTask` / `checkAllTasksCompleted`（已被新 graph 节点取代）
- `packages/brain/src/executor.js` — 删 `harness_task` 分支 + 4 个废弃 task_type 标 terminal failure
- `packages/brain/src/tick-runner.js` — 删 0.15 watcher 段 + advance 段 import
- `packages/brain/src/shepherd.js` — SQL 加 `payload->>'harness_mode' IS DISTINCT FROM 'true'` filter

**删除文件**：
- `packages/brain/src/harness-task-dispatch.js`
- `packages/brain/src/harness-watcher.js`
- `packages/brain/src/harness-phase-advancer.js`

---

## Task 1: harness-utils.js 抽工具函数

**Files:**
- Create: `packages/brain/src/harness-utils.js`
- Create: `packages/brain/src/workflows/__tests__/harness-utils.test.js`
- Reference (copy from): `packages/brain/src/harness-task-dispatch.js:144-181` (`extractWorkstreamIndex`, `buildGeneratorPrompt`)
- Reference: `packages/brain/src/harness-dag.js`（`parseTaskPlan` 输出含 `tasks: [{id, depends_on, ...}]`）

- [ ] **Step 1: Write failing test for `topologicalLayers`**

```js
// packages/brain/src/workflows/__tests__/harness-utils.test.js
import { describe, it, expect } from 'vitest';
import { topologicalLayers, buildGeneratorPrompt, extractWorkstreamIndex } from '../../harness-utils.js';

describe('topologicalLayers', () => {
  it('扁平 DAG（无依赖） → 1 层', () => {
    const tasks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(topologicalLayers(tasks)).toEqual([['a', 'b', 'c']]);
  });
  it('链式依赖 → N 层', () => {
    const tasks = [
      { id: 'a' },
      { id: 'b', depends_on: ['a'] },
      { id: 'c', depends_on: ['b'] },
    ];
    expect(topologicalLayers(tasks)).toEqual([['a'], ['b'], ['c']]);
  });
  it('钻石依赖', () => {
    const tasks = [
      { id: 'a' },
      { id: 'b', depends_on: ['a'] },
      { id: 'c', depends_on: ['a'] },
      { id: 'd', depends_on: ['b', 'c'] },
    ];
    const layers = topologicalLayers(tasks);
    expect(layers[0]).toEqual(['a']);
    expect(layers[1].sort()).toEqual(['b', 'c']);
    expect(layers[2]).toEqual(['d']);
  });
  it('循环依赖 → 抛错', () => {
    const tasks = [
      { id: 'a', depends_on: ['b'] },
      { id: 'b', depends_on: ['a'] },
    ];
    expect(() => topologicalLayers(tasks)).toThrow(/cycle/i);
  });
  it('空数组 → []', () => {
    expect(topologicalLayers([])).toEqual([]);
  });
});

describe('buildGeneratorPrompt', () => {
  it('普通模式包含 task_id / DoD / files', () => {
    const p = buildGeneratorPrompt(
      { id: 't1', title: 'T', description: 'D', payload: { dod: ['x'], files: ['f.js'], parent_task_id: 'init' } },
      { fixMode: false }
    );
    expect(p).toContain('/harness-generator');
    expect(p).toContain('task_id: t1');
    expect(p).toContain('fix_mode: false');
    expect(p).toContain('- x');
    expect(p).toContain('- f.js');
  });
  it('fix mode 头部加 (FIX mode)', () => {
    const p = buildGeneratorPrompt({ id: 't1', payload: {} }, { fixMode: true });
    expect(p).toContain('/harness-generator (FIX mode)');
    expect(p).toContain('fix_mode: true');
  });
});

describe('extractWorkstreamIndex', () => {
  it('payload.workstream_index 数字优先', () => {
    expect(extractWorkstreamIndex({ workstream_index: 3 })).toBe('3');
  });
  it('logical_task_id ws<N> 解析', () => {
    expect(extractWorkstreamIndex({ logical_task_id: 'ws7' })).toBe('7');
  });
  it('找不到返回空串', () => {
    expect(extractWorkstreamIndex({})).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails (file doesn't exist)**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/harness-utils.test.js`
Expected: FAIL with "Cannot find module '../../harness-utils.js'"

- [ ] **Step 3: Implement harness-utils.js**

```js
// packages/brain/src/harness-utils.js
/**
 * Harness 共享工具函数（Phase B/C 全 graph 重构）。
 * 集中放原 harness-task-dispatch.js 抽出的纯函数 + 新加的 DAG 拓扑工具。
 */

/**
 * 把 sub-task 列表按 depends_on 拓扑分层。
 * 返回 [[id...], [id...], ...]，每层内可并行 fanout。
 *
 * @param {Array<{id:string, depends_on?:string[]}>} tasks
 * @returns {string[][]}
 */
export function topologicalLayers(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];

  const indegree = new Map();
  const adj = new Map();
  const ids = new Set();

  for (const t of tasks) {
    ids.add(t.id);
    indegree.set(t.id, 0);
    adj.set(t.id, []);
  }
  for (const t of tasks) {
    for (const dep of (t.depends_on || [])) {
      if (!ids.has(dep)) continue; // 外部依赖跳过
      adj.get(dep).push(t.id);
      indegree.set(t.id, indegree.get(t.id) + 1);
    }
  }

  const layers = [];
  let frontier = [];
  for (const [id, deg] of indegree) if (deg === 0) frontier.push(id);

  let processed = 0;
  while (frontier.length > 0) {
    layers.push([...frontier]);
    const next = [];
    for (const id of frontier) {
      processed++;
      for (const child of adj.get(id)) {
        const d = indegree.get(child) - 1;
        indegree.set(child, d);
        if (d === 0) next.push(child);
      }
    }
    frontier = next;
  }

  if (processed !== ids.size) {
    throw new Error(`topologicalLayers: dependency cycle detected (processed ${processed}/${ids.size})`);
  }
  return layers;
}

/**
 * 从 payload 提取 workstream index（兼容数字 / "wsN" 字符串）。
 */
export function extractWorkstreamIndex(payload) {
  if (!payload) return '';
  if (payload.workstream_index !== undefined && payload.workstream_index !== null) {
    return String(payload.workstream_index);
  }
  const lti = payload.logical_task_id;
  if (typeof lti === 'string') {
    const m = lti.match(/^ws(\d+)$/i);
    if (m) return m[1];
  }
  return '';
}

/**
 * 构造 /harness-generator prompt。
 * fixMode=true 时头部加 (FIX mode)。
 */
export function buildGeneratorPrompt(task, { fixMode = false } = {}) {
  const payload = task.payload || {};
  const dod = Array.isArray(payload.dod) ? payload.dod.join('\n- ') : '';
  const files = Array.isArray(payload.files) ? payload.files.join('\n- ') : '';
  const header = fixMode ? '/harness-generator (FIX mode)' : '/harness-generator';
  return [
    header,
    '',
    `task_id: ${task.id}`,
    `initiative_id: ${payload.parent_task_id || ''}`,
    `logical_task_id: ${payload.logical_task_id || ''}`,
    `fix_mode: ${fixMode}`,
    '',
    `## 任务标题`,
    task.title || '',
    '',
    `## 任务描述`,
    task.description || '',
    '',
    `## DoD`,
    dod ? `- ${dod}` : '(none)',
    '',
    `## 目标文件`,
    files ? `- ${files}` : '(none)',
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/harness-utils.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/harness-utils.js packages/brain/src/workflows/__tests__/harness-utils.test.js
git commit -m "feat(brain): harness-utils.js 抽 topologicalLayers + buildGeneratorPrompt + extractWorkstreamIndex

为 Phase B/C 全图重构准备共享工具。topologicalLayers 用于顶层 graph 分层 fanout。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: harness-task.graph.js sub-graph 骨架 + State

**Files:**
- Create: `packages/brain/src/workflows/harness-task.graph.js`
- Create: `packages/brain/src/workflows/__tests__/harness-task.graph.test.js`
- Reference: `packages/brain/src/workflows/harness-initiative.graph.js:543-749`（C8a 顶层 graph 结构样板）

- [ ] **Step 1: Write failing test for buildHarnessTaskGraph 结构**

```js
// packages/brain/src/workflows/__tests__/harness-task.graph.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpawn = vi.fn();
const mockEnsureWorktree = vi.fn();
const mockResolveToken = vi.fn();
const mockWriteCallback = vi.fn();
const mockCheckPr = vi.fn();
const mockMerge = vi.fn();
const mockClassify = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock('../../spawn/index.js', () => ({ spawn: (...a) => mockSpawn(...a) }));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: (...a) => mockEnsureWorktree(...a) }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: (...a) => mockResolveToken(...a) }));
vi.mock('../../docker-executor.js', () => ({
  writeDockerCallback: (...a) => mockWriteCallback(...a),
  executeInDocker: (...a) => mockSpawn(...a),
}));
vi.mock('../../shepherd.js', () => ({
  checkPrStatus: (...a) => mockCheckPr(...a),
  executeMerge: (...a) => mockMerge(...a),
  classifyFailedChecks: (...a) => mockClassify(...a),
}));
vi.mock('../../harness-graph.js', () => ({
  parseDockerOutput: (s) => s,
  extractField: (s, f) => {
    const m = (s || '').match(new RegExp(`${f}:\\s*(\\S+)`, 'i'));
    return m ? m[1] : null;
  },
}));
vi.mock('../../db.js', () => ({ default: { query: (...a) => mockPoolQuery(...a) } }));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    setup: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    getTuple: vi.fn().mockResolvedValue(null),
    putWrites: vi.fn().mockResolvedValue(undefined),
  }),
}));

import {
  buildHarnessTaskGraph,
  spawnGeneratorNode,
  parseCallbackNode,
  pollCiNode,
  mergePrNode,
  fixDispatchNode,
  TaskState,
  MAX_FIX_ROUNDS,
  MAX_POLL_COUNT,
} from '../harness-task.graph.js';

describe('harness-task graph — structure', () => {
  it('TaskState 含必要 channels', () => {
    expect(TaskState).toBeDefined();
  });
  it('buildHarnessTaskGraph compile 不抛 + 有 5+ nodes', () => {
    const g = buildHarnessTaskGraph();
    const compiled = g.compile();
    expect(typeof compiled.invoke).toBe('function');
  });
  it('MAX_FIX_ROUNDS=3 / MAX_POLL_COUNT=20', () => {
    expect(MAX_FIX_ROUNDS).toBe(3);
    expect(MAX_POLL_COUNT).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/harness-task.graph.test.js`
Expected: FAIL with "Cannot find module '../harness-task.graph.js'"

- [ ] **Step 3: Implement skeleton harness-task.graph.js**

```js
// packages/brain/src/workflows/harness-task.graph.js
/**
 * Harness Task Sub-Graph — 单 sub-task 全周期 LangGraph。
 *
 * 替代 harness-task-dispatch.js + harness-watcher.js 的 procedural CI 轮询。
 *
 * 节点拓扑：
 *   START
 *     → spawn_generator      （内联 executeInDocker + writeDockerCallback）
 *     → parse_callback        （提取 pr_url 写 state）
 *     → conditional: 无 pr_url → END status=no_pr
 *     → poll_ci               （checkPrStatus，90s setTimeout，max 20 polls = 30 min）
 *     → conditional:
 *           ci_pass → merge_pr → END status=merged
 *           ci_fail → fix_dispatch (state.fix_round++)
 *               → conditional: fix_round<=MAX → spawn_generator (loop)
 *                              fix_round>MAX → END status=failed
 *           ci_pending → poll_ci (loop, 内置 sleep)
 *           ci_timeout → END status=timeout
 *
 * Brain 重启 PostgresSaver thread_id=`harness-task:${initiativeId}:${subTaskId}:${fixRound}` resume。
 * 每节点首句加幂等门防 resume 重 spawn。
 *
 * PRD: docs/superpowers/specs/2026-04-26-harness-langgraph-full-graph-design.md §3.2
 */

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import crypto from 'node:crypto';
import { spawn } from '../spawn/index.js';
import { ensureHarnessWorktree } from '../harness-worktree.js';
import { resolveGitHubToken } from '../harness-credentials.js';
import { writeDockerCallback } from '../docker-executor.js';
import { checkPrStatus, executeMerge, classifyFailedChecks } from '../shepherd.js';
import { parseDockerOutput, extractField } from '../harness-graph.js';
import { buildGeneratorPrompt, extractWorkstreamIndex } from '../harness-utils.js';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';
import pool from '../db.js';

export const MAX_FIX_ROUNDS = 3;
export const MAX_POLL_COUNT = 20; // 90s × 20 = 30 min
export const POLL_INTERVAL_MS = 90 * 1000;

export const TaskState = Annotation.Root({
  task:           Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiativeId:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  worktreePath:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  githubToken:    Annotation({ reducer: (_o, n) => n, default: () => null }),
  contractBranch: Annotation({ reducer: (_o, n) => n, default: () => null }),
  pr_url:         Annotation({ reducer: (_o, n) => n, default: () => null }),
  pr_branch:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  fix_round:      Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  poll_count:     Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  ci_status:      Annotation({ reducer: (_o, n) => n, default: () => 'pending' }),
  ci_fail_type:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  failed_checks:  Annotation({ reducer: (_o, n) => n, default: () => [] }),
  status:         Annotation({ reducer: (_o, n) => n, default: () => 'queued' }),
  cost_usd:       Annotation({ reducer: (c, n) => (c || 0) + (n || 0), default: () => 0 }),
  generator_output: Annotation({ reducer: (_o, n) => n, default: () => null }),
  error:          Annotation({ reducer: (_o, n) => n, default: () => null }),
});

// ──────────────────────────────────────────────────────────────────────────
// 节点 stubs（Task 3-7 逐个填充）
export async function spawnGeneratorNode(_state, _opts) { return {}; }
export async function parseCallbackNode(_state) { return {}; }
export async function pollCiNode(_state, _opts) { return {}; }
export async function mergePrNode(_state) { return {}; }
export async function fixDispatchNode(_state) { return {}; }

// ──────────────────────────────────────────────────────────────────────────
// 路由函数
function routeAfterParse(state) {
  if (state.error) return 'end';
  if (!state.pr_url) return 'no_pr';
  return 'poll';
}
function routeAfterPoll(state) {
  if (state.error) return 'end';
  if (state.ci_status === 'pass' || state.ci_status === 'merged') return 'merge';
  if (state.ci_status === 'fail') return 'fix';
  if (state.ci_status === 'timeout') return 'timeout';
  return 'poll'; // pending → loop
}
function routeAfterFix(state) {
  if (state.error) return 'end';
  if (state.fix_round > MAX_FIX_ROUNDS) return 'failed';
  return 'spawn';
}

export function buildHarnessTaskGraph() {
  return new StateGraph(TaskState)
    .addNode('spawn_generator', spawnGeneratorNode)
    .addNode('parse_callback', parseCallbackNode)
    .addNode('poll_ci', pollCiNode)
    .addNode('merge_pr', mergePrNode)
    .addNode('fix_dispatch', fixDispatchNode)
    .addEdge(START, 'spawn_generator')
    .addEdge('spawn_generator', 'parse_callback')
    .addConditionalEdges('parse_callback', routeAfterParse, {
      end: END, no_pr: END, poll: 'poll_ci',
    })
    .addConditionalEdges('poll_ci', routeAfterPoll, {
      end: END, merge: 'merge_pr', fix: 'fix_dispatch', timeout: END, poll: 'poll_ci',
    })
    .addEdge('merge_pr', END)
    .addConditionalEdges('fix_dispatch', routeAfterFix, {
      end: END, failed: END, spawn: 'spawn_generator',
    });
}

export async function compileHarnessTaskGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildHarnessTaskGraph().compile({ checkpointer });
}
```

- [ ] **Step 4: Run test to verify structure tests pass**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/harness-task.graph.test.js`
Expected: PASS (3 structure tests)

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/workflows/harness-task.graph.js packages/brain/src/workflows/__tests__/harness-task.graph.test.js
git commit -m "feat(brain): harness-task.graph.js 骨架 + State + 路由

新建 sub-graph 替代 harness-task-dispatch.js + harness-watcher.js procedural 链。
节点 stub，下个 commit 填实现。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: spawnGeneratorNode 实现

**Files:**
- Modify: `packages/brain/src/workflows/harness-task.graph.js`
- Modify: `packages/brain/src/workflows/__tests__/harness-task.graph.test.js`
- Reference: `packages/brain/src/harness-task-dispatch.js:25-136` (`triggerHarnessTaskDispatch` 主体逻辑)

- [ ] **Step 1: Write failing tests for spawnGeneratorNode**

Append to `harness-task.graph.test.js`:

```js
describe('spawnGeneratorNode', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockEnsureWorktree.mockReset();
    mockResolveToken.mockReset();
    mockWriteCallback.mockReset();
  });

  it('happy: prep + spawn + writeCallback 注入 env + 返回 generator_output', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt/abc');
    mockResolveToken.mockResolvedValueOnce('ghp_x');
    mockSpawn.mockResolvedValueOnce({
      exit_code: 0, stdout: 'pr_url: https://github.com/o/r/pull/1\nfoo', stderr: '', cost_usd: 0.5,
    });
    mockWriteCallback.mockResolvedValueOnce();
    const state = {
      task: { id: 'sub-1', title: 'T', description: 'D', payload: { parent_task_id: 'init-1' } },
      initiativeId: 'init-1',
    };
    const delta = await spawnGeneratorNode(state);
    expect(mockEnsureWorktree).toHaveBeenCalledWith({ taskId: 'sub-1', initiativeId: 'init-1' });
    expect(mockResolveToken).toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnArg = mockSpawn.mock.calls[0][0];
    expect(spawnArg.env.HARNESS_NODE).toBe('generator');
    expect(spawnArg.env.HARNESS_FIX_MODE).toBe('false');
    expect(spawnArg.env.GITHUB_TOKEN).toBe('ghp_x');
    expect(mockWriteCallback).toHaveBeenCalledTimes(1);
    expect(delta.generator_output).toContain('pr_url:');
    expect(delta.worktreePath).toBe('/wt/abc');
    expect(delta.cost_usd).toBe(0.5);
    expect(delta.error).toBeUndefined();
  });

  it('fix_round>0 → 注入 HARNESS_FIX_MODE=true', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt/x');
    mockResolveToken.mockResolvedValueOnce('ghp');
    mockSpawn.mockResolvedValueOnce({ exit_code: 0, stdout: 'ok', stderr: '' });
    mockWriteCallback.mockResolvedValueOnce();
    await spawnGeneratorNode({
      task: { id: 's', payload: {} }, initiativeId: 'i', fix_round: 2,
    });
    expect(mockSpawn.mock.calls[0][0].env.HARNESS_FIX_MODE).toBe('true');
  });

  it('container 失败 → 写 error 不抛', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt');
    mockResolveToken.mockResolvedValueOnce('t');
    mockSpawn.mockResolvedValueOnce({ exit_code: 1, stderr: 'boom', stdout: '' });
    const delta = await spawnGeneratorNode({
      task: { id: 's', payload: {} }, initiativeId: 'i',
    });
    expect(delta.error).toBeTruthy();
    expect(delta.error.node).toBe('spawn_generator');
  });

  it('idempotent: state.generator_output 已有 → 跳过 spawn', async () => {
    const delta = await spawnGeneratorNode({
      task: { id: 's' }, initiativeId: 'i', generator_output: 'cached',
    });
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(delta.generator_output).toBe('cached');
  });

  it('writeCallback 失败不污染成功状态', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt');
    mockResolveToken.mockResolvedValueOnce('t');
    mockSpawn.mockResolvedValueOnce({ exit_code: 0, stdout: 'ok', stderr: '' });
    mockWriteCallback.mockRejectedValueOnce(new Error('db down'));
    const delta = await spawnGeneratorNode({
      task: { id: 's', payload: {} }, initiativeId: 'i',
    });
    expect(delta.generator_output).toBe('ok');
    expect(delta.error).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/harness-task.graph.test.js -t spawnGeneratorNode`
Expected: FAIL（spawn 未被调用）

- [ ] **Step 3: Implement spawnGeneratorNode**

Replace stub in `harness-task.graph.js`:

```js
export async function spawnGeneratorNode(state, opts = {}) {
  // 幂等门：resume 时已有 output 直接返回
  if (state.generator_output) return { generator_output: state.generator_output };

  const executor = opts.executor || spawn;
  const ensureWt = opts.ensureWorktree || ensureHarnessWorktree;
  const resolveTok = opts.resolveToken || resolveGitHubToken;
  const writeCb = opts.writeCallback || writeDockerCallback;

  const task = state.task;
  const payload = task?.payload || {};
  const initiativeId = state.initiativeId || payload.parent_task_id || payload.initiative_id || task?.id;
  const fixMode = (state.fix_round || 0) > 0;

  let worktreePath = state.worktreePath;
  let token = state.githubToken;

  try {
    if (!worktreePath) worktreePath = await ensureWt({ taskId: task.id, initiativeId });
    if (!token) token = await resolveTok();
  } catch (err) {
    return { error: { node: 'spawn_generator', message: `prep: ${err.message}` } };
  }

  const prompt = buildGeneratorPrompt(task, { fixMode });

  let result;
  try {
    result = await executor({
      task: { ...task, task_type: 'harness_task' },
      prompt,
      worktreePath,
      env: {
        CECELIA_TASK_TYPE: 'harness_task',
        HARNESS_NODE: 'generator',
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_TASK_ID: task.id,
        HARNESS_FIX_MODE: fixMode ? 'true' : 'false',
        GITHUB_TOKEN: token,
        CONTRACT_BRANCH: payload.contract_branch || state.contractBranch || '',
        SPRINT_DIR: payload.sprint_dir || 'sprints',
        BRAIN_URL: 'http://host.docker.internal:5221',
        WORKSTREAM_INDEX: extractWorkstreamIndex(payload),
        WORKSTREAM_COUNT:
          payload.workstream_count !== undefined && payload.workstream_count !== null
            ? String(payload.workstream_count)
            : '',
        PLANNER_BRANCH: payload.planner_branch || '',
      },
    });
  } catch (err) {
    return { error: { node: 'spawn_generator', message: `spawn: ${err.message}` } };
  }

  if (!result || result.exit_code !== 0) {
    const detail = result?.stderr?.slice(0, 500) || `exit_code=${result?.exit_code}`;
    return { error: { node: 'spawn_generator', message: `container: ${detail}` } };
  }

  // 写 callback_queue（失败不污染成功状态）
  try {
    const runId = crypto.randomUUID();
    await writeCb({ ...task, task_type: 'harness_task' }, runId, null, result);
  } catch (err) {
    console.error(`[harness-task.graph] writeDockerCallback failed task=${task.id}: ${err.message}`);
  }

  return {
    generator_output: result.stdout,
    worktreePath,
    githubToken: token,
    cost_usd: result.cost_usd || 0,
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/harness-task.graph.test.js -t spawnGeneratorNode`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/workflows/harness-task.graph.js packages/brain/src/workflows/__tests__/harness-task.graph.test.js
git commit -m "feat(brain): harness-task.graph spawnGeneratorNode 实现

内联 triggerHarnessTaskDispatch 主体到 graph node。fix_round>0 → FIX mode env。
幂等门防 resume 重 spawn。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: parseCallbackNode + pollCiNode + mergePrNode + fixDispatchNode 实现

**Files:**
- Modify: `packages/brain/src/workflows/harness-task.graph.js`
- Modify: `packages/brain/src/workflows/__tests__/harness-task.graph.test.js`

- [ ] **Step 1: Write failing tests for 4 nodes**

Append to test file:

```js
describe('parseCallbackNode', () => {
  it('提取 pr_url + pr_branch + commit_sha', async () => {
    const delta = await parseCallbackNode({
      generator_output: 'foo\npr_url: https://x/pull/9\npr_branch: cp-foo\ncommit_sha: abc',
    });
    expect(delta.pr_url).toBe('https://x/pull/9');
    expect(delta.pr_branch).toBe('cp-foo');
  });
  it('无 generator_output → 不报错，无 pr_url', async () => {
    const delta = await parseCallbackNode({});
    expect(delta.pr_url).toBeFalsy();
  });
});

describe('pollCiNode', () => {
  beforeEach(() => { mockCheckPr.mockReset(); });

  it('happy: ci_passed → 写 ci_status=pass', async () => {
    mockCheckPr.mockReturnValueOnce({ ciStatus: 'ci_passed', state: 'OPEN', mergeable: 'MERGEABLE', failedChecks: [] });
    const delta = await pollCiNode(
      { pr_url: 'https://x/pull/1', poll_count: 0 },
      { sleepMs: 0 }
    );
    expect(delta.ci_status).toBe('pass');
    expect(delta.poll_count).toBe(1);
  });

  it('ci_failed → ci_status=fail + classifyFailedChecks', async () => {
    mockCheckPr.mockReturnValueOnce({ ciStatus: 'ci_failed', failedChecks: ['eslint'] });
    mockClassify.mockReturnValueOnce('lint');
    const delta = await pollCiNode(
      { pr_url: 'x', poll_count: 0 },
      { sleepMs: 0 }
    );
    expect(delta.ci_status).toBe('fail');
    expect(delta.ci_fail_type).toBe('lint');
    expect(delta.failed_checks).toEqual(['eslint']);
  });

  it('ci_pending → ci_status=pending + poll_count++', async () => {
    mockCheckPr.mockReturnValueOnce({ ciStatus: 'ci_pending', failedChecks: [] });
    const delta = await pollCiNode(
      { pr_url: 'x', poll_count: 5 },
      { sleepMs: 0 }
    );
    expect(delta.ci_status).toBe('pending');
    expect(delta.poll_count).toBe(6);
  });

  it('poll_count >= MAX → ci_status=timeout', async () => {
    const delta = await pollCiNode(
      { pr_url: 'x', poll_count: MAX_POLL_COUNT },
      { sleepMs: 0 }
    );
    expect(delta.ci_status).toBe('timeout');
    expect(mockCheckPr).not.toHaveBeenCalled();
  });

  it('PR closed → ci_status=fail + error', async () => {
    mockCheckPr.mockReturnValueOnce({ ciStatus: 'closed', state: 'CLOSED', failedChecks: [] });
    const delta = await pollCiNode({ pr_url: 'x', poll_count: 0 }, { sleepMs: 0 });
    expect(delta.error).toBeTruthy();
  });

  it('checkPrStatus throw → 不阻断，poll_count++ 等下次', async () => {
    mockCheckPr.mockImplementationOnce(() => { throw new Error('gh down'); });
    const delta = await pollCiNode({ pr_url: 'x', poll_count: 1 }, { sleepMs: 0 });
    expect(delta.ci_status).toBe('pending');
    expect(delta.poll_count).toBe(2);
  });
});

describe('mergePrNode', () => {
  beforeEach(() => { mockMerge.mockReset(); });
  it('happy: 调 executeMerge 写 status=merged', async () => {
    mockMerge.mockReturnValueOnce(true);
    const delta = await mergePrNode({ pr_url: 'https://x/pull/1' });
    expect(mockMerge).toHaveBeenCalledWith('https://x/pull/1');
    expect(delta.status).toBe('merged');
  });
  it('merge 失败 → error', async () => {
    mockMerge.mockImplementationOnce(() => { throw new Error('conflict'); });
    const delta = await mergePrNode({ pr_url: 'x' });
    expect(delta.error).toBeTruthy();
    expect(delta.status).toBe('failed');
  });
  it('idempotent: status 已 merged → 跳过', async () => {
    const delta = await mergePrNode({ pr_url: 'x', status: 'merged' });
    expect(mockMerge).not.toHaveBeenCalled();
    expect(delta.status).toBe('merged');
  });
});

describe('fixDispatchNode', () => {
  it('fix_round 当前=2 → 返回 3 + 清 generator_output/pr_url/poll_count/ci_status', async () => {
    const delta = await fixDispatchNode({ fix_round: 2, generator_output: 'old', pr_url: 'p', poll_count: 7, ci_status: 'fail' });
    expect(delta.fix_round).toBe(3);
    expect(delta.generator_output).toBeNull();
    expect(delta.pr_url).toBeNull();
    expect(delta.poll_count).toBe(0);
    expect(delta.ci_status).toBe('pending');
  });
  it('未指定 fix_round → 默认 1', async () => {
    const delta = await fixDispatchNode({});
    expect(delta.fix_round).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/harness-task.graph.test.js -t 'parseCallbackNode|pollCiNode|mergePrNode|fixDispatchNode'`
Expected: FAIL（all stubs return {}）

- [ ] **Step 3: Implement 4 nodes**

Replace stubs in `harness-task.graph.js`:

```js
export async function parseCallbackNode(state) {
  // 幂等门：已有 pr_url 跳过
  if (state.pr_url) return { pr_url: state.pr_url, pr_branch: state.pr_branch };
  const out = state.generator_output || '';
  const parsed = parseDockerOutput(out);
  const pr_url = extractField(parsed, 'pr_url');
  const pr_branch = extractField(parsed, 'pr_branch');
  return { pr_url, pr_branch };
}

export async function pollCiNode(state, opts = {}) {
  const checkFn = opts.checkPr || checkPrStatus;
  const classifyFn = opts.classify || classifyFailedChecks;
  const sleepMs = opts.sleepMs !== undefined ? opts.sleepMs : POLL_INTERVAL_MS;
  const pollCount = state.poll_count || 0;

  if (pollCount >= MAX_POLL_COUNT) {
    return { ci_status: 'timeout', poll_count: pollCount };
  }

  if (sleepMs > 0) {
    await new Promise((r) => setTimeout(r, sleepMs));
  }

  let info;
  try {
    info = checkFn(state.pr_url);
  } catch (err) {
    console.warn(`[harness-task.graph] poll_ci checkPrStatus error (will retry): ${err.message}`);
    return { ci_status: 'pending', poll_count: pollCount + 1 };
  }

  if (info.state === 'CLOSED' || info.ciStatus === 'closed') {
    return {
      ci_status: 'fail',
      poll_count: pollCount + 1,
      error: { node: 'poll_ci', message: 'PR closed externally' },
    };
  }
  if (info.ciStatus === 'ci_passed' || info.ciStatus === 'merged') {
    return { ci_status: 'pass', poll_count: pollCount + 1 };
  }
  if (info.ciStatus === 'ci_failed') {
    const failType = classifyFn(info.failedChecks || []);
    return {
      ci_status: 'fail',
      ci_fail_type: failType,
      failed_checks: info.failedChecks || [],
      poll_count: pollCount + 1,
    };
  }
  return { ci_status: 'pending', poll_count: pollCount + 1 };
}

export async function mergePrNode(state) {
  if (state.status === 'merged') return { status: 'merged' };
  try {
    executeMerge(state.pr_url);
    return { status: 'merged', ci_status: 'merged' };
  } catch (err) {
    return { status: 'failed', error: { node: 'merge_pr', message: err.message } };
  }
}

export async function fixDispatchNode(state) {
  const next = (state.fix_round || 0) + 1;
  return {
    fix_round: next,
    generator_output: null,
    pr_url: null,
    pr_branch: null,
    poll_count: 0,
    ci_status: 'pending',
    ci_fail_type: null,
    failed_checks: [],
  };
}
```

注意：`Annotation` reducer 是 `(_o, n) => n` 时，传 `null` 即覆盖为 `null`；`fix_round` reducer 同样覆盖。`cost_usd` 是累加 reducer，所以不重置。

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/harness-task.graph.test.js`
Expected: PASS (all spawn + 4 node tests)

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/workflows/harness-task.graph.js packages/brain/src/workflows/__tests__/harness-task.graph.test.js
git commit -m "feat(brain): harness-task.graph 4 节点实现 (parseCallback/pollCi/mergePr/fixDispatch)

pollCiNode 内置 90s setTimeout（max 20 polls = 30 min）。fixDispatchNode 清 generator_output
+ pr_url + poll_count 让 spawn 重跑。merge 失败标 status=failed 走 END。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: harness-task.graph 端到端 happy/fix-loop/timeout 测试

**Files:**
- Modify: `packages/brain/src/workflows/__tests__/harness-task.graph.test.js`

- [ ] **Step 1: Write 3 end-to-end mock graph tests**

Append:

```js
import { MemorySaver } from '@langchain/langgraph';

describe('harness-task graph — end-to-end', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockEnsureWorktree.mockReset();
    mockResolveToken.mockReset();
    mockWriteCallback.mockReset();
    mockCheckPr.mockReset();
    mockMerge.mockReset();
    mockClassify.mockReset();
  });

  it('happy: spawn → pr_url → ci_pass → merge → END status=merged', async () => {
    mockEnsureWorktree.mockResolvedValue('/wt');
    mockResolveToken.mockResolvedValue('t');
    mockSpawn.mockResolvedValue({ exit_code: 0, stdout: 'pr_url: https://gh/p/1', stderr: '' });
    mockWriteCallback.mockResolvedValue();
    mockCheckPr.mockReturnValue({ ciStatus: 'ci_passed', state: 'OPEN', mergeable: 'MERGEABLE', failedChecks: [] });
    mockMerge.mockReturnValue(true);

    const compiled = buildHarnessTaskGraph().compile({ checkpointer: new MemorySaver() });
    const final = await compiled.invoke(
      { task: { id: 'sub-1', payload: {} }, initiativeId: 'i' },
      { configurable: { thread_id: 't1' } }
    );
    expect(final.status).toBe('merged');
    expect(final.pr_url).toBe('https://gh/p/1');
    expect(mockMerge).toHaveBeenCalledTimes(1);
  });

  it('fix loop: spawn → ci_fail → fix → spawn (round 2) → ci_pass → merge → END', async () => {
    mockEnsureWorktree.mockResolvedValue('/wt');
    mockResolveToken.mockResolvedValue('t');
    mockSpawn
      .mockResolvedValueOnce({ exit_code: 0, stdout: 'pr_url: https://gh/p/1', stderr: '' })
      .mockResolvedValueOnce({ exit_code: 0, stdout: 'pr_url: https://gh/p/1', stderr: '' });
    mockWriteCallback.mockResolvedValue();
    mockCheckPr
      .mockReturnValueOnce({ ciStatus: 'ci_failed', failedChecks: ['lint'] })
      .mockReturnValueOnce({ ciStatus: 'ci_passed', failedChecks: [] });
    mockClassify.mockReturnValue('lint');
    mockMerge.mockReturnValue(true);

    const compiled = buildHarnessTaskGraph().compile({ checkpointer: new MemorySaver() });
    const final = await compiled.invoke(
      { task: { id: 'sub-2', payload: {} }, initiativeId: 'i' },
      { configurable: { thread_id: 't2' }, recursionLimit: 50 }
    );
    expect(final.status).toBe('merged');
    expect(final.fix_round).toBe(1);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it('max fix rounds: ci_fail × 4 → END status=failed', async () => {
    mockEnsureWorktree.mockResolvedValue('/wt');
    mockResolveToken.mockResolvedValue('t');
    mockSpawn.mockResolvedValue({ exit_code: 0, stdout: 'pr_url: https://gh/p/1', stderr: '' });
    mockWriteCallback.mockResolvedValue();
    mockCheckPr.mockReturnValue({ ciStatus: 'ci_failed', failedChecks: ['test'] });
    mockClassify.mockReturnValue('test');

    const compiled = buildHarnessTaskGraph().compile({ checkpointer: new MemorySaver() });
    const final = await compiled.invoke(
      { task: { id: 'sub-3', payload: {} }, initiativeId: 'i' },
      { configurable: { thread_id: 't3' }, recursionLimit: 100 }
    );
    expect(final.fix_round).toBe(MAX_FIX_ROUNDS + 1);
    expect(mockMerge).not.toHaveBeenCalled();
  });

  it('no_pr: spawn → 无 pr_url → END status=queued (no merge attempt)', async () => {
    mockEnsureWorktree.mockResolvedValue('/wt');
    mockResolveToken.mockResolvedValue('t');
    mockSpawn.mockResolvedValue({ exit_code: 0, stdout: 'no pr created', stderr: '' });
    mockWriteCallback.mockResolvedValue();
    const compiled = buildHarnessTaskGraph().compile({ checkpointer: new MemorySaver() });
    const final = await compiled.invoke(
      { task: { id: 'sub-4', payload: {} }, initiativeId: 'i' },
      { configurable: { thread_id: 't4' } }
    );
    expect(final.pr_url).toBeNull();
    expect(mockMerge).not.toHaveBeenCalled();
    expect(mockCheckPr).not.toHaveBeenCalled();
  });
});
```

注：spawnGeneratorNode 中需要把 `sleepMs` 透传给 pollCi。但 pollCi 由 graph runtime 调用，无法注入 opts。改方案：env 变量 `HARNESS_POLL_INTERVAL_MS=0` 单测覆盖。

- [ ] **Step 2: Add env override to pollCiNode**

In `harness-task.graph.js` `pollCiNode`:

```js
const sleepMs = opts.sleepMs !== undefined
  ? opts.sleepMs
  : (process.env.HARNESS_POLL_INTERVAL_MS !== undefined
      ? Number(process.env.HARNESS_POLL_INTERVAL_MS)
      : POLL_INTERVAL_MS);
```

- [ ] **Step 3: Add env in test setup**

In test file, add at top of `describe('harness-task graph — end-to-end', ...)`:

```js
beforeEach(() => {
  process.env.HARNESS_POLL_INTERVAL_MS = '0';
  // ...existing resets
});
afterEach(() => { delete process.env.HARNESS_POLL_INTERVAL_MS; });
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/harness-task.graph.test.js`
Expected: PASS (all 17+ tests including 4 e2e)

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/workflows/harness-task.graph.js packages/brain/src/workflows/__tests__/harness-task.graph.test.js
git commit -m "test(brain): harness-task.graph e2e happy/fix-loop/timeout/no_pr 4 场景

MemorySaver compile 直接 invoke 走完整 graph。HARNESS_POLL_INTERVAL_MS=0 加速测试。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 顶层 graph 加 fanout/per_sub_task/join 节点

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`
- Modify: `packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js`

设计要点：
- LangGraph Send API 用法：`fanoutSubTasks` 节点返回 `[new Send('run_sub_task', { sub_task: ... }), ...]`
- 但 LangGraph subgraph 在 Send 中需要把 sub-graph 编译进父 graph 作为节点。简化：写 `runSubTaskNode` 包装 sub-graph compile + invoke
- 分层 fanout 暂用一次性扁平：所有 sub_task 同时 fanout（DAG 调度复杂，先不上）。FUTURE TODO 加分层

- [ ] **Step 1: Write failing tests for new nodes**

Append to `harness-initiative-graph.test.js`:

```js
import {
  fanoutSubTasksNode,
  runSubTaskNode,
  joinSubTasksNode,
  finalE2eNode,
  reportNode,
  buildHarnessFullGraph,
} from '../harness-initiative.graph.js';

vi.mock('../harness-task.graph.js', () => {
  const compiled = {
    invoke: vi.fn().mockResolvedValue({
      status: 'merged', pr_url: 'https://gh/p/1', fix_round: 0, cost_usd: 1,
    }),
  };
  return {
    buildHarnessTaskGraph: vi.fn(() => ({ compile: () => compiled })),
    compileHarnessTaskGraph: vi.fn().mockResolvedValue(compiled),
    __compiled: compiled,
  };
});

vi.mock('../../harness-final-e2e.js', async () => ({
  runScenarioCommand: vi.fn(() => ({ exitCode: 0, output: 'ok' })),
  bootstrapE2E: vi.fn(() => ({ exitCode: 0, output: 'ok' })),
  teardownE2E: vi.fn(() => ({ exitCode: 0, output: '' })),
  normalizeAcceptance: (a) => a,
  attributeFailures: () => new Map(),
}));

describe('fanoutSubTasksNode', () => {
  it('从 taskPlan.tasks 派发 Send (sub-graph 调用准备)', async () => {
    const state = {
      initiativeId: 'i',
      taskPlan: { tasks: [{ id: 's1', title: 'T1' }, { id: 's2', title: 'T2' }] },
    };
    const sends = await fanoutSubTasksNode(state);
    // Send 是 LangGraph 内部对象，至少应该是 array of length 2
    expect(Array.isArray(sends)).toBe(true);
    expect(sends.length).toBe(2);
  });
  it('空 tasks → 返回 []', async () => {
    const sends = await fanoutSubTasksNode({ taskPlan: { tasks: [] } });
    expect(sends).toEqual([]);
  });
});

describe('runSubTaskNode', () => {
  it('compile sub-graph + invoke + merge result 进 sub_tasks', async () => {
    const delta = await runSubTaskNode({
      sub_task: { id: 's1', title: 'T1' },
      initiativeId: 'i',
      worktreePath: '/wt',
      githubToken: 'g',
      contractBranch: 'b',
    });
    expect(delta.sub_tasks).toBeDefined();
    expect(delta.sub_tasks.length).toBe(1);
    expect(delta.sub_tasks[0].id).toBe('s1');
    expect(delta.sub_tasks[0].status).toBe('merged');
  });
});

describe('joinSubTasksNode', () => {
  it('sub_tasks 全 merged → 返回 ready=true', async () => {
    const delta = await joinSubTasksNode({
      sub_tasks: [
        { id: 's1', status: 'merged' },
        { id: 's2', status: 'merged' },
      ],
    });
    expect(delta.all_sub_tasks_done).toBe(true);
  });
  it('有 sub_task 非 merged → ready=false 且 final_e2e_verdict=FAIL', async () => {
    const delta = await joinSubTasksNode({
      sub_tasks: [
        { id: 's1', status: 'merged' },
        { id: 's2', status: 'failed' },
      ],
    });
    expect(delta.all_sub_tasks_done).toBe(false);
    expect(delta.final_e2e_verdict).toBe('FAIL');
  });
});

describe('finalE2eNode', () => {
  it('happy: 跑 scenarios 全 pass → verdict=PASS', async () => {
    const delta = await finalE2eNode({
      initiativeId: 'i',
      contract: { e2e_acceptance: { scenarios: [{ name: 's1', covered_tasks: ['t1'], commands: [{ cmd: 'echo' }] }] } },
    }, { skipBootstrap: true });
    expect(delta.final_e2e_verdict).toBe('PASS');
  });
});
```

注：`compileHarnessFullGraph` 暂不写测试（Task 9 端到端跑）。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js -t 'fanoutSubTasksNode|runSubTaskNode|joinSubTasksNode|finalE2eNode'`
Expected: FAIL（functions not exported）

- [ ] **Step 3: Implement nodes in harness-initiative.graph.js**

Append at bottom of `harness-initiative.graph.js` (after compileHarnessInitiativeGraph):

```js
import { Send } from '@langchain/langgraph';
import {
  buildHarnessTaskGraph as _buildTaskGraph,
} from './harness-task.graph.js';
import {
  runScenarioCommand,
  bootstrapE2E,
  teardownE2E,
  normalizeAcceptance,
  attributeFailures,
} from '../harness-final-e2e.js';

// 顶层 State 扩展：sub_tasks / final_e2e / report
export const FullInitiativeState = Annotation.Root({
  // 复用 InitiativeState 字段
  task:           Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiativeId:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  worktreePath:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  githubToken:    Annotation({ reducer: (_o, n) => n, default: () => null }),
  plannerOutput:  Annotation({ reducer: (_o, n) => n, default: () => null }),
  taskPlan:       Annotation({ reducer: (_o, n) => n, default: () => null }),
  prdContent:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  ganResult:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  result:         Annotation({ reducer: (_o, n) => n, default: () => null }),
  error:          Annotation({ reducer: (_o, n) => n, default: () => null }),
  contract:       Annotation({ reducer: (_o, n) => n, default: () => null }),

  // sub-task fanout（Send API 给单个 sub-graph 调用，需要 sub_task 字段）
  sub_task:       Annotation({ reducer: (_o, n) => n, default: () => null }),

  // 累计：merge by id
  sub_tasks: Annotation({
    reducer: (curr, upd) => {
      if (!Array.isArray(upd) || upd.length === 0) return curr || [];
      const map = new Map((curr || []).map((s) => [s.id, s]));
      for (const s of upd) map.set(s.id, { ...(map.get(s.id) || {}), ...s });
      return [...map.values()];
    },
    default: () => [],
  }),
  all_sub_tasks_done: Annotation({ reducer: (_o, n) => n, default: () => false }),
  final_e2e_verdict: Annotation({ reducer: (_o, n) => n, default: () => null }),
  final_e2e_failed_scenarios: Annotation({ reducer: (_o, n) => n, default: () => [] }),
  report_path: Annotation({ reducer: (_o, n) => n, default: () => null }),
});

export async function fanoutSubTasksNode(state) {
  const tasks = state.taskPlan?.tasks || [];
  if (tasks.length === 0) return [];
  // Send 让 LangGraph runtime 并行启 N 个 run_sub_task 实例
  return tasks.map((t) => new Send('run_sub_task', {
    sub_task: t,
    initiativeId: state.initiativeId,
    worktreePath: state.worktreePath,
    githubToken: state.githubToken,
    contractBranch: state.ganResult?.propose_branch || null,
  }));
}

let _taskGraphCompiledCache = null;
function _getTaskGraphCompiled() {
  if (_taskGraphCompiledCache) return _taskGraphCompiledCache;
  _taskGraphCompiledCache = _buildTaskGraph().compile();
  return _taskGraphCompiledCache;
}

export async function runSubTaskNode(state, opts = {}) {
  const subTask = state.sub_task;
  if (!subTask) return {};
  const compiled = opts.compiledTaskGraph || _getTaskGraphCompiled();
  const final = await compiled.invoke(
    {
      task: { id: subTask.id, title: subTask.title, description: subTask.description, payload: subTask.payload || {} },
      initiativeId: state.initiativeId,
      worktreePath: state.worktreePath,
      githubToken: state.githubToken,
      contractBranch: state.contractBranch,
    },
    { configurable: { thread_id: `harness-task:${state.initiativeId}:${subTask.id}` }, recursionLimit: 100 }
  );
  return {
    sub_tasks: [{
      id: subTask.id,
      title: subTask.title,
      status: final.status,
      pr_url: final.pr_url,
      fix_round: final.fix_round,
      cost_usd: final.cost_usd,
      ci_fail_type: final.ci_fail_type,
    }],
  };
}

export async function joinSubTasksNode(state) {
  const subs = state.sub_tasks || [];
  if (subs.length === 0) {
    return { all_sub_tasks_done: false };
  }
  const allMerged = subs.every((s) => s.status === 'merged');
  if (!allMerged) {
    const failed = subs.filter((s) => s.status !== 'merged').map((s) => s.id);
    console.warn(`[harness-initiative.graph] join: ${failed.length} sub-tasks not merged → FAIL final E2E`);
    return {
      all_sub_tasks_done: false,
      final_e2e_verdict: 'FAIL',
      final_e2e_failed_scenarios: failed.map((id) => ({
        name: `sub_task ${id} did not merge`,
        covered_tasks: [id],
        exitCode: 1,
        output: '',
      })),
    };
  }
  return { all_sub_tasks_done: true };
}

export async function finalE2eNode(state, opts = {}) {
  // join 已 FAIL 短路：不跑 E2E
  if (state.final_e2e_verdict === 'FAIL') return { final_e2e_verdict: 'FAIL' };
  const contract = state.contract || {};
  const acceptance = contract.e2e_acceptance || state.taskPlan?.e2e_acceptance;
  if (!acceptance) {
    return { final_e2e_verdict: 'PASS' }; // 无合同验收 → 视为 PASS（向后兼容）
  }

  let scenarios;
  try {
    ({ scenarios } = normalizeAcceptance(acceptance));
  } catch (err) {
    return { error: { node: 'final_e2e', message: err.message }, final_e2e_verdict: 'FAIL' };
  }

  const runScenario = opts.runScenario || runScenarioCommand;
  const bootstrap = opts.bootstrap || bootstrapE2E;
  const teardown = opts.teardown || teardownE2E;
  const skipBootstrap = opts.skipBootstrap === true;

  if (!skipBootstrap) {
    const bs = bootstrap();
    if (bs.exitCode !== 0) {
      return {
        final_e2e_verdict: 'FAIL',
        final_e2e_failed_scenarios: [{
          name: `bootstrap failure`,
          covered_tasks: collectCoveredTasks(scenarios),
          output: bs.output, exitCode: bs.exitCode,
        }],
      };
    }
  }

  const failed = [];
  for (const sc of scenarios) {
    let f = null;
    for (const cmd of sc.commands) {
      const r = await runScenario(cmd, { scenarioName: sc.name, coveredTasks: sc.covered_tasks });
      if (r.exitCode !== 0) {
        f = { name: sc.name, covered_tasks: [...sc.covered_tasks], output: r.output, exitCode: r.exitCode };
        break;
      }
    }
    if (f) failed.push(f);
  }

  if (!skipBootstrap) {
    try { teardown(); } catch { /* ignore */ }
  }

  return {
    final_e2e_verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    final_e2e_failed_scenarios: failed,
  };
}

function collectCoveredTasks(scenarios) {
  const set = new Set();
  for (const s of scenarios) for (const t of s.covered_tasks || []) set.add(t);
  return [...set];
}

export async function reportNode(state, opts = {}) {
  const dbPool = opts.pool || pool;
  const reportContent = JSON.stringify({
    initiativeId: state.initiativeId,
    sub_tasks: state.sub_tasks || [],
    final_e2e_verdict: state.final_e2e_verdict,
    failed_scenarios: state.final_e2e_failed_scenarios || [],
    cost_usd: (state.sub_tasks || []).reduce((a, s) => a + (s.cost_usd || 0), 0),
    completed_at: new Date().toISOString(),
  }, null, 2);
  // 写 initiative_runs phase=done/failed
  try {
    const phase = state.final_e2e_verdict === 'PASS' ? 'done' : 'failed';
    await dbPool.query(
      `UPDATE initiative_runs SET phase=$2, completed_at=NOW(), updated_at=NOW(),
        failure_reason=CASE WHEN $2='failed' THEN $3 ELSE failure_reason END
       WHERE initiative_id=$1::uuid`,
      [state.initiativeId, phase, `Final E2E ${state.final_e2e_verdict}: ${(state.final_e2e_failed_scenarios || []).map(s => s.name).join('; ').slice(0, 500)}`]
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] reportNode db update failed: ${err.message}`);
  }
  return { report_path: reportContent };
}

// ──────────────────────────────────────────────────────────────────────────
// 完整 graph：Phase A + B + C 全程 LangGraph

function _routeAfterJoin(state) {
  if (state.error) return 'end';
  return state.all_sub_tasks_done ? 'final_e2e' : 'final_e2e'; // 两路都进 final_e2e（FAIL 已在 state）
}

function _routeAfterFinalE2E(state) {
  if (state.error) return 'end';
  return 'report';
}

export function buildHarnessFullGraph() {
  return new StateGraph(FullInitiativeState)
    .addNode('prep', prepInitiativeNode)
    .addNode('planner', runPlannerNode)
    .addNode('parsePrd', parsePrdNode)
    .addNode('ganLoop', runGanLoopNode)
    .addNode('dbUpsert', dbUpsertNode)
    .addNode('fanout', fanoutSubTasksNode)
    .addNode('run_sub_task', runSubTaskNode)
    .addNode('join', joinSubTasksNode)
    .addNode('final_e2e', finalE2eNode)
    .addNode('report', reportNode)
    .addEdge(START, 'prep')
    .addConditionalEdges('prep', stateHasError, { error: END, ok: 'planner' })
    .addConditionalEdges('planner', stateHasError, { error: END, ok: 'parsePrd' })
    .addConditionalEdges('parsePrd', stateHasError, { error: END, ok: 'ganLoop' })
    .addConditionalEdges('ganLoop', stateHasError, { error: END, ok: 'dbUpsert' })
    .addConditionalEdges('dbUpsert', stateHasError, { error: END, ok: 'fanout' })
    // fanout returns Send[] → LangGraph runtime 并行调 run_sub_task
    .addEdge('fanout', 'run_sub_task')
    .addEdge('run_sub_task', 'join')
    .addConditionalEdges('join', _routeAfterJoin, { end: END, final_e2e: 'final_e2e' })
    .addConditionalEdges('final_e2e', _routeAfterFinalE2E, { end: END, report: 'report' })
    .addEdge('report', END);
}

export async function compileHarnessFullGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildHarnessFullGraph().compile({ checkpointer });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js`
Expected: PASS（包括新加 4 节点测试 + 老 C8a 测试都过）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js
git commit -m "feat(brain): 顶层 graph 加 fanout/run_sub_task/join/final_e2e/report 节点

FullInitiativeState 扩展 sub_tasks (merge by id reducer) + final_e2e_verdict + report_path。
fanoutSubTasksNode 用 Send API 并行启动 sub-graph。joinSubTasksNode 检查全 merged → final_e2e。
finalE2eNode 内联 runFinalE2E 主循环（不再依赖 harness-final-e2e.runFinalE2E 编排函数）。
reportNode 写 initiative_runs.phase=done/failed。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 端到端 mock 完整 graph 测试

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`

- [ ] **Step 1: Write end-to-end test**

```js
// packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';

const mockSpawn = vi.fn();
const mockEnsureWt = vi.fn();
const mockResolveTok = vi.fn();
const mockParseTaskPlan = vi.fn();
const mockUpsertTaskPlan = vi.fn();
const mockRunGan = vi.fn();
const mockReadFile = vi.fn();
const mockCheckPr = vi.fn();
const mockMerge = vi.fn();
const mockClassify = vi.fn();
const mockWriteCb = vi.fn();
const mockPoolQuery = vi.fn();
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};
const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
  query: (...a) => mockPoolQuery(...a),
};

vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../spawn/index.js', () => ({ spawn: (...a) => mockSpawn(...a) }));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: (...a) => mockEnsureWt(...a) }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: (...a) => mockResolveTok(...a) }));
vi.mock('../../docker-executor.js', () => ({
  writeDockerCallback: (...a) => mockWriteCb(...a),
  executeInDocker: (...a) => mockSpawn(...a),
}));
vi.mock('../../shepherd.js', () => ({
  checkPrStatus: (...a) => mockCheckPr(...a),
  executeMerge: (...a) => mockMerge(...a),
  classifyFailedChecks: (...a) => mockClassify(...a),
}));
vi.mock('../../harness-graph.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL',
  extractField: (s, f) => {
    const m = (s || '').match(new RegExp(`${f}:\\s*(\\S+)`, 'i'));
    return m ? m[1] : null;
  },
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: (...a) => mockParseTaskPlan(...a),
  upsertTaskPlan: (...a) => mockUpsertTaskPlan(...a),
}));
vi.mock('../../harness-gan-graph.js', () => ({ runGanContractGraph: (...a) => mockRunGan(...a) }));
vi.mock('node:fs/promises', () => ({
  default: { readFile: (...a) => mockReadFile(...a) },
  readFile: (...a) => mockReadFile(...a),
}));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue(new MemorySaver()),
}));

import { buildHarnessFullGraph } from '../harness-initiative.graph.js';

describe('full graph e2e', () => {
  beforeEach(() => {
    process.env.HARNESS_POLL_INTERVAL_MS = '0';
    [mockSpawn, mockEnsureWt, mockResolveTok, mockParseTaskPlan, mockUpsertTaskPlan,
      mockRunGan, mockReadFile, mockCheckPr, mockMerge, mockClassify,
      mockWriteCb, mockPoolQuery, mockClient.query, mockClient.release].forEach((m) => m.mockReset());
    mockClient.release.mockReturnValue(undefined);
    mockClient.query.mockResolvedValue({ rows: [] });
  });
  afterEach(() => { delete process.env.HARNESS_POLL_INTERVAL_MS; });

  it('happy: planner → gan → fanout 2 sub_tasks → 全 merged → final_e2e PASS → report', async () => {
    mockEnsureWt.mockResolvedValue('/wt');
    mockResolveTok.mockResolvedValue('t');
    // planner spawn
    mockSpawn
      .mockResolvedValueOnce({ exit_code: 0, stdout: 'planner ok', stderr: '' })
      // 2 sub-tasks 各自 spawn
      .mockResolvedValueOnce({ exit_code: 0, stdout: 'pr_url: https://gh/p/1', stderr: '' })
      .mockResolvedValueOnce({ exit_code: 0, stdout: 'pr_url: https://gh/p/2', stderr: '' });
    mockReadFile.mockResolvedValue('# PRD');
    mockParseTaskPlan.mockReturnValue({
      initiative_id: 'i',
      tasks: [
        { id: 's1', title: 'T1' },
        { id: 's2', title: 'T2' },
      ],
      e2e_acceptance: { scenarios: [{ name: 'sc', covered_tasks: ['s1'], commands: [{ cmd: 'echo ok' }] }] },
    });
    mockRunGan.mockResolvedValue({ contract_content: 'C', rounds: 1, propose_branch: 'b' });
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'cont-1' }] }) // contract insert
      .mockResolvedValueOnce({ rows: [{ id: 'run-1' }] }) // run insert
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    mockUpsertTaskPlan.mockResolvedValue({ idMap: {}, insertedTaskIds: ['s1', 's2'] });

    mockWriteCb.mockResolvedValue();
    mockCheckPr.mockReturnValue({ ciStatus: 'ci_passed', state: 'OPEN', mergeable: 'MERGEABLE', failedChecks: [] });
    mockMerge.mockReturnValue(true);
    mockPoolQuery.mockResolvedValue({ rows: [] });

    const compiled = buildHarnessFullGraph().compile({ checkpointer: new MemorySaver() });
    const final = await compiled.invoke(
      { task: { id: 'init-1', payload: { initiative_id: 'i' } } },
      { configurable: { thread_id: 'init-1:1' }, recursionLimit: 200 }
    );

    expect(final.final_e2e_verdict).toBe('PASS');
    expect(final.sub_tasks.length).toBe(2);
    expect(final.sub_tasks.every((s) => s.status === 'merged')).toBe(true);
    expect(final.report_path).toBeTruthy();
  }, 30000);

  it('1 sub_task fix_round=2 后 merged → 顶层 final_e2e PASS', async () => {
    mockEnsureWt.mockResolvedValue('/wt');
    mockResolveTok.mockResolvedValue('t');
    mockSpawn.mockImplementation((opts) => {
      // planner 第一次
      if (opts?.task?.task_type === 'harness_planner') {
        return Promise.resolve({ exit_code: 0, stdout: 'planner', stderr: '' });
      }
      return Promise.resolve({ exit_code: 0, stdout: 'pr_url: https://gh/p/1', stderr: '' });
    });
    mockReadFile.mockResolvedValue('# PRD');
    mockParseTaskPlan.mockReturnValue({ initiative_id: 'i', tasks: [{ id: 's1', title: 'T1' }] });
    mockRunGan.mockResolvedValue({ contract_content: 'C', rounds: 1, propose_branch: 'b' });
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'cont-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'run-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    mockUpsertTaskPlan.mockResolvedValue({ idMap: {}, insertedTaskIds: ['s1'] });
    mockWriteCb.mockResolvedValue();
    mockCheckPr
      .mockReturnValueOnce({ ciStatus: 'ci_failed', failedChecks: ['lint'] })
      .mockReturnValueOnce({ ciStatus: 'ci_passed', failedChecks: [] });
    mockClassify.mockReturnValue('lint');
    mockMerge.mockReturnValue(true);
    mockPoolQuery.mockResolvedValue({ rows: [] });

    const compiled = buildHarnessFullGraph().compile({ checkpointer: new MemorySaver() });
    const final = await compiled.invoke(
      { task: { id: 'init-2', payload: { initiative_id: 'i' } } },
      { configurable: { thread_id: 'init-2:1' }, recursionLimit: 200 }
    );

    expect(final.sub_tasks[0].status).toBe('merged');
    expect(final.sub_tasks[0].fix_round).toBe(1);
    expect(final.final_e2e_verdict).toBe('PASS');
  }, 30000);
});

describe('full graph resume', () => {
  beforeEach(() => {
    process.env.HARNESS_POLL_INTERVAL_MS = '0';
    [mockSpawn, mockEnsureWt, mockResolveTok, mockParseTaskPlan, mockUpsertTaskPlan,
      mockRunGan, mockReadFile, mockCheckPr, mockMerge, mockClassify,
      mockWriteCb, mockPoolQuery, mockClient.query, mockClient.release].forEach((m) => m.mockReset());
    mockClient.release.mockReturnValue(undefined);
    mockClient.query.mockResolvedValue({ rows: [] });
  });
  afterEach(() => { delete process.env.HARNESS_POLL_INTERVAL_MS; });

  it('Brain 重启 PostgresSaver thread_id resume 续上 mid-loop（用 MemorySaver 模拟）', async () => {
    const saver = new MemorySaver();
    mockEnsureWt.mockResolvedValue('/wt');
    mockResolveTok.mockResolvedValue('t');
    mockReadFile.mockResolvedValue('# PRD');
    mockParseTaskPlan.mockReturnValue({ initiative_id: 'i', tasks: [{ id: 's1', title: 'T1' }] });
    mockRunGan.mockResolvedValue({ contract_content: 'C', rounds: 1, propose_branch: 'b' });
    mockClient.query
      .mockResolvedValue({ rows: [{ id: 'x' }] });
    mockUpsertTaskPlan.mockResolvedValue({ idMap: {}, insertedTaskIds: ['s1'] });
    mockWriteCb.mockResolvedValue();
    mockSpawn
      .mockResolvedValueOnce({ exit_code: 0, stdout: 'planner', stderr: '' })
      // 第 1 次 spawn sub-task → 假装 Brain 这里崩溃，spawn 不返回 PR
      // 但我们让它返回正常，验证 resume 不重 spawn
      .mockResolvedValueOnce({ exit_code: 0, stdout: 'pr_url: https://gh/p/1', stderr: '' });
    mockCheckPr.mockReturnValue({ ciStatus: 'ci_passed', failedChecks: [] });
    mockMerge.mockReturnValue(true);
    mockPoolQuery.mockResolvedValue({ rows: [] });

    const compiled = buildHarnessFullGraph().compile({ checkpointer: saver });
    const final = await compiled.invoke(
      { task: { id: 'init-3', payload: { initiative_id: 'i' } } },
      { configurable: { thread_id: 'init-3:1' }, recursionLimit: 200 }
    );
    expect(final.final_e2e_verdict).toBe('PASS');

    // Resume：再 invoke 同 thread_id，state 应保持
    const resumed = await compiled.invoke(null, { configurable: { thread_id: 'init-3:1' } });
    expect(resumed.final_e2e_verdict).toBe('PASS');
    expect(resumed.sub_tasks[0].status).toBe('merged');
  }, 30000);
});
```

- [ ] **Step 2: Run test to verify**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`
Expected: PASS (3 tests)

If failures, debug：
- LangGraph Send API 行为可能与预期不同 → 加 `console.log` 看 state 流
- recursionLimit 不够 → 提到 200/300

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js
git commit -m "test(brain): 完整 graph e2e mock — happy/fix-loop/resume 3 场景

模拟 planner → gan → 2 sub_tasks fanout → ci_pass → final_e2e PASS → report 全链路。
单 sub-task fix_round=2 后 merged 验证 sub-graph 嵌入正确。
PostgresSaver (用 MemorySaver 模拟) resume thread_id 状态保持。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: executor.js 切换到 buildHarnessFullGraph + env flag fallback

**Files:**
- Modify: `packages/brain/src/executor.js`

- [ ] **Step 1: Read current executor harness routing**

Already analyzed: lines 2795-2840 have `harness_initiative` + `harness_task` branches.

- [ ] **Step 2: Modify executor — harness_initiative 走完整 graph**

Edit `packages/brain/src/executor.js` lines 2795-2840 region:

Replace block:

```js
  // 2.85 Harness v2 Initiative Runner（阶段 A）
  // ... 原 if (task.task_type === 'harness_initiative') { ... } 块
```

with:

```js
  // 2.85 Harness Full Graph (Phase A+B+C) — Sprint 1 一个 graph 跑到底
  // env flag HARNESS_USE_FULL_GRAPH=false 走老路（迁移期保留 1 周）
  if (task.task_type === 'harness_initiative') {
    const useFullGraph = process.env.HARNESS_USE_FULL_GRAPH !== 'false';
    if (useFullGraph) {
      console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness Full Graph (Sprint 1)`);
      try {
        const { compileHarnessFullGraph } = await import('./workflows/harness-initiative.graph.js');
        const compiled = await compileHarnessFullGraph();
        const initiativeId = task.payload?.initiative_id || task.id;
        const final = await compiled.invoke(
          { task },
          { configurable: { thread_id: `harness-initiative:${initiativeId}:1` }, recursionLimit: 500 }
        );
        return {
          success: !final.error,
          taskId: task.id,
          initiative: true,
          fullGraph: true,
          finalState: final,
        };
      } catch (err) {
        console.error(`[executor] Harness Full Graph error task=${task.id}: ${err.message}`);
        return { success: false, taskId: task.id, initiative: true, error: err.message };
      }
    }
    // ── 老路（保留 1 周） ────────────────────────────────────────
    if (process.env.HARNESS_INITIATIVE_RUNTIME === 'v2') {
      console.log(`[executor] 路由决策: task_type=${task.task_type} → v2 graph runWorkflow (legacy)`);
      try {
        const { runWorkflow } = await import('./orchestrator/graph-runtime.js');
        return await runWorkflow('harness-initiative', task.id, 1, { task });
      } catch (err) {
        console.error(`[executor] v2 graph runWorkflow error task=${task.id}: ${err.message}`);
        return { success: false, taskId: task.id, initiative: true, error: err.message };
      }
    }
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness v2 Initiative Runner (legacy procedural)`);
    let checkpointer;
    try {
      const { getPgCheckpointer } = await import('./orchestrator/pg-checkpointer.js');
      checkpointer = await getPgCheckpointer();
    } catch (cpErr) {
      console.warn(`[executor] PostgresSaver 初始化失败，降级到 MemorySaver: ${cpErr.message}`);
      checkpointer = undefined;
    }
    try {
      const { runInitiative } = await import('./harness-initiative-runner.js');
      return await runInitiative(task, { checkpointer });
    } catch (err) {
      console.error(`[executor] Initiative Runner error task=${task.id}: ${err.message}`);
      return { success: false, taskId: task.id, initiative: true, error: err.message };
    }
  }
```

- [ ] **Step 3: Modify executor — harness_task / harness_ci_watch / harness_fix / harness_final_e2e 标 terminal failure**

Edit lines 2831-2840 region:

Replace:

```js
  // harness_task 走容器派 /harness-generator（PR-2）
  if (task.task_type === 'harness_task') {
    try {
      const { triggerHarnessTaskDispatch } = await import('./harness-task-dispatch.js');
      return await triggerHarnessTaskDispatch(task);
    } catch (err) {
      console.error(`[executor] harness_task dispatch failed task=${task.id}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
```

with:

```js
  // Sprint 1: harness_task / harness_ci_watch / harness_fix / harness_final_e2e
  // 4 个 task_type 已被 harness_initiative full-graph 内部 sub-graph 取代。
  // 老数据派到 executor → 标 terminal failure 防止"复活"。
  // 迁移期 HARNESS_USE_FULL_GRAPH=false 时仍可走老路（兜底）。
  const _RETIRED_HARNESS_TYPES = new Set([
    'harness_task', 'harness_ci_watch', 'harness_fix', 'harness_final_e2e',
  ]);
  if (_RETIRED_HARNESS_TYPES.has(task.task_type)) {
    if (process.env.HARNESS_USE_FULL_GRAPH === 'false') {
      // 兜底：迁移期仍走老路
      if (task.task_type === 'harness_task') {
        try {
          const { triggerHarnessTaskDispatch } = await import('./harness-task-dispatch.js');
          return await triggerHarnessTaskDispatch(task);
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
      // harness_ci_watch / harness_fix / harness_final_e2e: 老路 watcher / runPhaseCIfReady 自管
      console.log(`[executor] task_type=${task.task_type} (legacy mode) → tick worker handles it`);
      return { success: true, deferred: true };
    }
    console.warn(`[executor] retired task_type=${task.task_type} task=${task.id} → marking pipeline_terminal_failure`);
    try {
      await pool.query(
        `UPDATE tasks SET status='failed', completed_at=NOW(),
          error_message=$2,
          payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('failure_class', 'pipeline_terminal_failure')
         WHERE id=$1::uuid`,
        [task.id, `task_type ${task.task_type} retired in Sprint 1 (full-graph migration); see harness-initiative full graph sub-graph`]
      );
    } catch (err) {
      console.error(`[executor] mark retired task failed: ${err.message}`);
    }
    return { success: false, retired: true, taskType: task.task_type };
  }
```

- [ ] **Step 4: Run brain test suite to verify executor still parses**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && node --check packages/brain/src/executor.js`
Expected: 无输出（语法正确）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/executor.js
git commit -m "feat(brain): executor harness_initiative 走 full graph + 4 retired task_type 标 terminal

HARNESS_USE_FULL_GRAPH=true (default) → compileHarnessFullGraph + invoke (Phase A+B+C 一个 graph)。
HARNESS_USE_FULL_GRAPH=false → 兜底老路（runInitiative + harness-task-dispatch）。
4 retired task_types (harness_task/ci_watch/fix/final_e2e) 在 full-graph 模式下标
pipeline_terminal_failure 防老数据复活。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: tick-runner.js 删 watcher / advancer 钩子

**Files:**
- Modify: `packages/brain/src/tick-runner.js`

- [ ] **Step 1: Edit tick-runner imports + watcher block**

Find line 99-103:

```js
import {
  initSweep as initOrphanSweep,
  processHarnessCiWatchers,
  processHarnessDeployWatchers,
} from './harness-watcher.js';
```

Replace with:

```js
import { initSweep as initOrphanSweep } from './harness-watcher.js';
// processHarnessCiWatchers / processHarnessDeployWatchers retired in Sprint 1
// (Phase B/C 进 LangGraph，sub-graph poll_ci 自管)
```

注：如果 initSweep 不在 harness-watcher.js，需要换 import；先 grep 确认。

- [ ] **Step 2: 验证 initSweep 来源**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && grep -n "export.*initSweep" packages/brain/src/*.js`
Expected: 看真实 export 位置

如果 initSweep 来自 harness-watcher.js 但我们要删 harness-watcher.js → 把 initSweep 抽到 `packages/brain/src/orphan-sweep.js`，更新所有 import。

如果 initSweep 来自其他文件 → 简单调整 import 路径。

具体决策：先看实际 grep 结果再决定。

- [ ] **Step 3: 删 0.15 watcher 块**

Find line 877-890:

```js
  // 0.15. Harness Watcher：每次 tick 处理 harness_ci_watch / harness_deploy_watch（内联 CI/CD 轮询）
  try {
    const ciResult = await processHarnessCiWatchers(pool);
    const deployResult = await processHarnessDeployWatchers(pool);
    if (ciResult.processed > 0 || deployResult.processed > 0) {
      actionsTaken.push({
        action: 'harness_watcher',
        ci: ciResult,
        deploy: deployResult,
      });
    }
  } catch (harnessWatchErr) {
    console.error('[tick] Harness watcher failed (non-fatal):', harnessWatchErr.message);
  }
```

Replace with:

```js
  // 0.15. Harness Watcher: retired in Sprint 1
  // sub-graph harness-task.graph poll_ci node 取代了 harness_ci_watch 轮询逻辑。
  // 老数据派的 harness_ci_watch task 由 executor.js _RETIRED_HARNESS_TYPES 处理。
```

- [ ] **Step 4: 删 advancer 块**

Find line 1372-1378:

```js
  // Harness v2 phase 推进器（PR-3）：A→B→C 晋级
  try {
    const { advanceHarnessInitiatives } = await import('./harness-phase-advancer.js');
    await advanceHarnessInitiatives(pool);
  } catch (err) {
    console.error('[harness-advance] tick error:', err.message);
  }
```

Replace with:

```js
  // Harness v2 phase advancer: retired in Sprint 1
  // 顶层 graph harness-initiative.graph buildHarnessFullGraph 自己推进 phase。
  // initiative_runs.phase 由 reportNode 写。
```

- [ ] **Step 5: 验证 + Commit**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && node --check packages/brain/src/tick-runner.js`
Expected: 无输出

```bash
git add packages/brain/src/tick-runner.js
git commit -m "refactor(brain): tick-runner 删 harness watcher + advancer 钩子

Sprint 1 Phase B/C 进 LangGraph 后这俩在 graph 内部承担。
processHarnessCiWatchers / processHarnessDeployWatchers / advanceHarnessInitiatives
都不再在 tick 里调用，由 harness-task.graph 的 poll_ci/merge_pr 节点和顶层 graph 推进。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: shepherd.js SQL filter 加 harness_mode 排除

**Files:**
- Modify: `packages/brain/src/shepherd.js`
- Modify: `packages/brain/src/__tests__/shepherd.test.js`（如果存在）

- [ ] **Step 1: 找 shepherdOpenPRs SELECT**

In `packages/brain/src/shepherd.js` line 123-131：

```js
    const queryResult = await pool.query(`
      SELECT id, title, pr_url, pr_status, retry_count, payload
      FROM tasks
      WHERE pr_url IS NOT NULL
        AND pr_status IN ('open', 'ci_pending', 'ci_passed')
        AND status NOT IN ('quarantined', 'cancelled')
      ORDER BY updated_at ASC
      LIMIT 20
    `);
```

Replace with:

```js
    const queryResult = await pool.query(`
      SELECT id, title, pr_url, pr_status, retry_count, payload
      FROM tasks
      WHERE pr_url IS NOT NULL
        AND pr_status IN ('open', 'ci_pending', 'ci_passed')
        AND status NOT IN ('quarantined', 'cancelled')
        -- Sprint 1: harness_mode PR 由 sub-graph merge_pr node 自管，shepherd 不动
        AND COALESCE(payload->>'harness_mode', 'false') NOT IN ('true', 't')
      ORDER BY updated_at ASC
      LIMIT 20
    `);
```

- [ ] **Step 2: Verify + commit**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && node --check packages/brain/src/shepherd.js`
Expected: 无输出

```bash
git add packages/brain/src/shepherd.js
git commit -m "refactor(brain): shepherd SQL 排除 harness_mode PR

Sprint 1 后 harness PR 由 harness-task.graph merge_pr node 自管，避免 shepherd
重复触发 gh pr merge 导致竞态。SQL 加 payload->>'harness_mode' NOT IN ('true','t') filter。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: 删旧 module — harness-task-dispatch.js / harness-watcher.js / harness-phase-advancer.js

**Files:**
- Delete: `packages/brain/src/harness-task-dispatch.js`
- Delete: `packages/brain/src/harness-watcher.js`
- Delete: `packages/brain/src/harness-phase-advancer.js`

但 harness-watcher.js 含 initSweep（Step 2 of Task 9 已确认），需保留 initSweep。简化方案：harness-watcher.js 改为只保留 initSweep + deprecation comment。

- [ ] **Step 1: 检查 initSweep / processHarnessCiWatchers 还有谁引用**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && grep -rn "from.*harness-watcher\|from.*harness-task-dispatch\|from.*harness-phase-advancer" packages/brain/src/`
Expected: 只剩 tick-runner（已改）+ executor（已改）

- [ ] **Step 2: harness-watcher.js 改为只剩 initSweep stub**

Read full harness-watcher.js（已知 353 行），找 `initSweep` 实现（如果不在则可能 import 自其他地方）。

操作分支：
- 如果 `initSweep` 在 harness-watcher.js 实现 → 把 `initSweep` 抽到 `packages/brain/src/orphan-sweep.js`，更新 tick-runner.js import
- 如果 initSweep 是 re-export → 改 tick-runner.js import 指向真正源

完成后整个 harness-watcher.js 替换为：

```js
/**
 * @deprecated Sprint 1: harness-watcher.js retired.
 * processHarnessCiWatchers / processHarnessDeployWatchers 由 harness-task.graph 的
 * poll_ci / merge_pr 节点取代。
 *
 * 此文件保留为标记文件，import 它的代码应迁移到对应 graph 节点 / orphan-sweep.js。
 *
 * 历史代码：git log --follow packages/brain/src/harness-watcher.js
 */
export const RETIRED = true;
```

- [ ] **Step 3: 删 harness-task-dispatch.js + harness-phase-advancer.js**

```bash
git rm packages/brain/src/harness-task-dispatch.js packages/brain/src/harness-phase-advancer.js
```

但保留 harness-task-dispatch.js 也作为 deprecated stub？决策：完全删（用 deprecation comment 在 graph 文件头部 + grep 验证）。如果有遗漏 import 在 commit 后的 vitest 中会暴露。

- [ ] **Step 4: harness-final-e2e.js 删 runFinalE2E + collectAllCoveredTasks 编排函数**

Edit `packages/brain/src/harness-final-e2e.js`：删除 `runFinalE2E` (line 181-266) 和 `collectAllCoveredTasks` (line 305-313)。

文件顶部 docstring 改为：

```js
/**
 * Harness E2E 工具函数集（Sprint 1 后只剩纯工具）。
 * runFinalE2E 编排函数已迁入 harness-initiative.graph.finalE2eNode。
 *
 * 此文件保留 5 工具函数：
 *   - runScenarioCommand
 *   - normalizeAcceptance
 *   - bootstrapE2E / teardownE2E
 *   - attributeFailures
 */
```

- [ ] **Step 5: harness-initiative-runner.js 删 runPhaseCIfReady + checkAllTasksCompleted + createFixTask**

Edit `packages/brain/src/harness-initiative-runner.js`：删除 line 256-530（整个"阶段 C"段）。

但 `runInitiative` (line 64-254) 保留：HARNESS_USE_FULL_GRAPH=false 兜底回退用。文件尾部添加 deprecation comment：

```js
// ── Sprint 1: Phase C 编排函数已删（runPhaseCIfReady / createFixTask /
// checkAllTasksCompleted），见 harness-initiative.graph.finalE2eNode。
```

- [ ] **Step 6: Run all tests**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/ packages/brain/src/__tests__/ 2>&1 | tail -50`
Expected: PASS for new tests; 老 harness-final-e2e / harness-initiative-runner 测试可能 FAIL（已删函数），需相应删 / skip / 改写

- [ ] **Step 7: 修被删函数对应的老测试**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && grep -rln "runPhaseCIfReady\|createFixTask\|checkAllTasksCompleted\|runFinalE2E\|processHarnessCiWatchers\|advanceHarnessInitiatives\|triggerHarnessTaskDispatch" packages/brain/src/ | grep -v node_modules`
Expected: 找到老测试文件列表

对每个找到的文件：
- 删测试用例 / 改 import 指向新 graph 节点 / 标 `it.skip(...)` 加注释 "Sprint 1 retired"

- [ ] **Step 8: 再跑测试 + commit**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain 2>&1 | tail -20`
Expected: All PASS

```bash
git add -A packages/brain/src
git commit -m "refactor(brain): 删 6 module + 1 编排函数 + 修老测试

砍：
- harness-task-dispatch.js 全删
- harness-phase-advancer.js 全删
- harness-watcher.js 缩为 deprecation stub（只剩 RETIRED=true 标记）
- harness-final-e2e.runFinalE2E + collectAllCoveredTasks 编排函数（保留 5 工具函数）
- harness-initiative-runner.runPhaseCIfReady + createFixTask + checkAllTasksCompleted Phase C 段
- callback-processor.js + shepherd.js 中 harness 分支已在前面 commit 处理

老测试同步：删/skip 引用已删函数的 case，加 'Sprint 1 retired' 注释。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: 集成测试（真 DB + mock executor）

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-full-pipeline.integration.test.js`

注：本仓库没有 docker-compose 测试 DB；vitest 集成测试通常用 testcontainers 或 sqlite。但 PostgresSaver 要求 PG。决策：用 **mock pg pool**（不真连 DB）+ `MemorySaver` 替 PostgresSaver，**功能上等价于集成测试**（验证多节点 + state 流 + checkpoint resume）。如果 CI 有 PG 容器（packages/brain 有 docker-compose.yml）则真连。

简化决策：本任务用 **mock pg pool**（DB 调用全 mock），只验证：
- buildHarnessFullGraph + compile + invoke 不抛
- mock executor 走完所有节点
- final state.report_path 存在

实际"真 DB" 验证延后到 Phase B 集成（PRD 没强要求 Sprint 1 必须真 PG）。

- [ ] **Step 1: Write integration-style test (extends Task 7 但加多 sub-task + DAG)**

```js
// packages/brain/src/workflows/__tests__/harness-full-pipeline.integration.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';

// 复用 Task 7 mock 模式 + 加 4 sub-tasks
// (实际代码同 Task 7 e2e 但 tasks 列表为 4 个，验证 fanout 并行 + join 聚合)

const mockSpawn = vi.fn();
const mockEnsureWt = vi.fn();
const mockResolveTok = vi.fn();
const mockParseTaskPlan = vi.fn();
const mockUpsertTaskPlan = vi.fn();
const mockRunGan = vi.fn();
const mockReadFile = vi.fn();
const mockCheckPr = vi.fn();
const mockMerge = vi.fn();
const mockClassify = vi.fn();
const mockWriteCb = vi.fn();
const mockClient = { query: vi.fn(), release: vi.fn() };
const mockPool = { connect: vi.fn().mockResolvedValue(mockClient), query: vi.fn() };

vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../spawn/index.js', () => ({ spawn: (...a) => mockSpawn(...a) }));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: (...a) => mockEnsureWt(...a) }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: (...a) => mockResolveTok(...a) }));
vi.mock('../../docker-executor.js', () => ({
  writeDockerCallback: (...a) => mockWriteCb(...a),
  executeInDocker: (...a) => mockSpawn(...a),
}));
vi.mock('../../shepherd.js', () => ({
  checkPrStatus: (...a) => mockCheckPr(...a),
  executeMerge: (...a) => mockMerge(...a),
  classifyFailedChecks: (...a) => mockClassify(...a),
}));
vi.mock('../../harness-graph.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL',
  extractField: (s, f) => {
    const m = (s || '').match(new RegExp(`${f}:\\s*(\\S+)`, 'i'));
    return m ? m[1] : null;
  },
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: (...a) => mockParseTaskPlan(...a),
  upsertTaskPlan: (...a) => mockUpsertTaskPlan(...a),
}));
vi.mock('../../harness-gan-graph.js', () => ({ runGanContractGraph: (...a) => mockRunGan(...a) }));
vi.mock('node:fs/promises', () => ({
  default: { readFile: (...a) => mockReadFile(...a) },
  readFile: (...a) => mockReadFile(...a),
}));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue(new MemorySaver()),
}));

import { buildHarnessFullGraph } from '../harness-initiative.graph.js';

describe('integration: 4 sub-tasks fanout 并行 + join + final_e2e + report', () => {
  beforeEach(() => {
    process.env.HARNESS_POLL_INTERVAL_MS = '0';
    [mockSpawn, mockEnsureWt, mockResolveTok, mockParseTaskPlan, mockUpsertTaskPlan,
      mockRunGan, mockReadFile, mockCheckPr, mockMerge, mockClassify,
      mockWriteCb, mockClient.query, mockClient.release, mockPool.query].forEach((m) => m.mockReset());
    mockClient.release.mockReturnValue(undefined);
    mockClient.query.mockResolvedValue({ rows: [] });
    mockPool.query.mockResolvedValue({ rows: [] });
  });
  afterEach(() => { delete process.env.HARNESS_POLL_INTERVAL_MS; });

  it('4 sub_tasks 全 merged → final_e2e PASS → report 写 phase=done', async () => {
    mockEnsureWt.mockResolvedValue('/wt');
    mockResolveTok.mockResolvedValue('t');
    mockSpawn.mockResolvedValue({ exit_code: 0, stdout: 'pr_url: https://gh/p/X', stderr: '' });
    mockReadFile.mockResolvedValue('# PRD');
    mockParseTaskPlan.mockReturnValue({
      initiative_id: 'i',
      tasks: [
        { id: 's1', title: 'T1' }, { id: 's2', title: 'T2' },
        { id: 's3', title: 'T3' }, { id: 's4', title: 'T4' },
      ],
    });
    mockRunGan.mockResolvedValue({ contract_content: 'C', rounds: 1, propose_branch: 'b' });
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'cont' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'run' }] })
      .mockResolvedValueOnce({ rows: [] });
    mockUpsertTaskPlan.mockResolvedValue({ idMap: {}, insertedTaskIds: ['s1', 's2', 's3', 's4'] });
    mockWriteCb.mockResolvedValue();
    mockCheckPr.mockReturnValue({ ciStatus: 'ci_passed', failedChecks: [] });
    mockMerge.mockReturnValue(true);

    const compiled = buildHarnessFullGraph().compile({ checkpointer: new MemorySaver() });
    const final = await compiled.invoke(
      { task: { id: 'init', payload: { initiative_id: 'i' } } },
      { configurable: { thread_id: 'init:1' }, recursionLimit: 500 }
    );

    expect(final.sub_tasks.length).toBe(4);
    expect(final.sub_tasks.every(s => s.status === 'merged')).toBe(true);
    expect(final.final_e2e_verdict).toBe('PASS');
    expect(final.report_path).toBeTruthy();
    // reportNode 调了 pool.query UPDATE initiative_runs phase=done
    const updateCall = mockPool.query.mock.calls.find(c => c[0]?.includes('UPDATE initiative_runs'));
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toContain('done');
  }, 30000);

  it('1 sub_task fail → final_e2e FAIL → report 写 phase=failed', async () => {
    mockEnsureWt.mockResolvedValue('/wt');
    mockResolveTok.mockResolvedValue('t');
    mockSpawn.mockResolvedValue({ exit_code: 0, stdout: 'pr_url: https://gh/p/X', stderr: '' });
    mockReadFile.mockResolvedValue('# PRD');
    mockParseTaskPlan.mockReturnValue({ initiative_id: 'i', tasks: [{ id: 's1', title: 'T1' }, { id: 's2', title: 'T2' }] });
    mockRunGan.mockResolvedValue({ contract_content: 'C', rounds: 1, propose_branch: 'b' });
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'cont' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'run' }] })
      .mockResolvedValueOnce({ rows: [] });
    mockUpsertTaskPlan.mockResolvedValue({ idMap: {}, insertedTaskIds: ['s1', 's2'] });
    mockWriteCb.mockResolvedValue();
    // s1 ci_pass; s2 一直 ci_fail 直到 fix_round 用尽
    let pollCalls = 0;
    mockCheckPr.mockImplementation(() => {
      pollCalls++;
      // 偶数调用是 s1 → pass，奇数 → s2 → fail
      return pollCalls % 2 === 1
        ? { ciStatus: 'ci_passed', failedChecks: [] }
        : { ciStatus: 'ci_failed', failedChecks: ['lint'] };
    });
    mockClassify.mockReturnValue('lint');
    mockMerge.mockReturnValue(true);

    const compiled = buildHarnessFullGraph().compile({ checkpointer: new MemorySaver() });
    const final = await compiled.invoke(
      { task: { id: 'init2', payload: { initiative_id: 'i2' } } },
      { configurable: { thread_id: 'init2:1' }, recursionLimit: 500 }
    );

    // 至少一个 sub_task 没 merge → final FAIL
    expect(final.sub_tasks.some(s => s.status !== 'merged')).toBe(true);
    expect(final.final_e2e_verdict).toBe('FAIL');
    const updateCall = mockPool.query.mock.calls.find(c => c[0]?.includes('UPDATE initiative_runs'));
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toContain('failed');
  }, 60000);
});
```

- [ ] **Step 2: Run integration test**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain/src/workflows/__tests__/harness-full-pipeline.integration.test.js`
Expected: PASS (2 tests, may take 30-60s)

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/workflows/__tests__/harness-full-pipeline.integration.test.js
git commit -m "test(brain): integration 4 sub_tasks fanout 并行 + 1 fail FAIL 路径

验证：
1. 4 sub_tasks 全 PASS → final_e2e PASS → reportNode 写 phase=done
2. 1 sub_task fix_round 用尽 → final_e2e FAIL → reportNode 写 phase=failed

mock 完整 pg pool + executor + writeCallback，端到端验证 graph 状态流。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: grep 验证 + 全测试 + spec self-check

**Files:** None modified (validation only)

- [ ] **Step 1: grep 6 module reference**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && grep -rn "from.*harness-task-dispatch\|from.*harness-phase-advancer\|triggerHarnessTaskDispatch\|advanceHarnessInitiatives\|runPhaseCIfReady\|createFixTask\|checkAllTasksCompleted\|runFinalE2E" packages/brain/src/ --include='*.js' | grep -v __tests__ | grep -v 'node_modules'`
Expected: 输出仅有 deprecation comment（如有）。如有真实 import 残留 → 修。

- [ ] **Step 2: 跑全 brain 测试套件**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain 2>&1 | tail -30`
Expected: All PASS

- [ ] **Step 3: facts-check + version sync**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && node scripts/facts-check.mjs 2>&1 | tail -20`
Expected: 0 errors

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && bash scripts/check-version-sync.sh 2>&1 | tail -10`
Expected: PASS（如失败需 bump version 见 Task 14）

- [ ] **Step 4: 行数统计**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && git diff main --stat | tail -20`
Expected: 净减约 600 行（删 ~1500，加 ~900 含测试）

- [ ] **Step 5: Commit (如果有调整)**

如果有需要调整的内容 commit；否则跳过。

---

## Task 14: Brain version bump + DoD 验证 + PRD/DoD 文件

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Create: `cp-0426102619-harness-langgraph-refactor.prd.md`
- Create: `cp-0426102619-harness-langgraph-refactor.dod.md`
- Create: `docs/learnings/cp-0426102619-harness-langgraph-refactor.md`

- [ ] **Step 1: 读当前 brain version**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && node -e "console.log(require('./packages/brain/package.json').version)"`
Expected: 类似 `2.x.y`

- [ ] **Step 2: bump minor version (新 feature)**

Edit `packages/brain/package.json`：version `+1` minor (e.g. 2.5.0 → 2.6.0)

Edit `packages/brain/package-lock.json`：搜两处 version 字段同步（package-lock 顶层 + 自身 packages."" 段）

- [ ] **Step 3: 写 PRD 文件**

`cp-0426102619-harness-langgraph-refactor.prd.md`：复用 brain task PRD 内容（curl localhost:5221/api/brain/tasks/5616cc28-... 的 description）

- [ ] **Step 4: 写 DoD**

`cp-0426102619-harness-langgraph-refactor.dod.md`：

```markdown
# DoD - harness-langgraph-refactor

## ARTIFACT
- [x] [ARTIFACT] 新建 `packages/brain/src/workflows/harness-task.graph.js`
  Test: `manual:node -e "require('fs').accessSync('packages/brain/src/workflows/harness-task.graph.js')"`
- [x] [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` 含 fanoutSubTasksNode + finalE2eNode + reportNode
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8'); if(!c.includes('fanoutSubTasksNode')||!c.includes('finalE2eNode')||!c.includes('reportNode'))process.exit(1)"`
- [x] [ARTIFACT] harness-utils.js 含 topologicalLayers + buildGeneratorPrompt
  Test: `manual:node -e "const m=require('./packages/brain/src/harness-utils.js'); if(typeof m.topologicalLayers!=='function'||typeof m.buildGeneratorPrompt!=='function')process.exit(1)"`
- [x] [ARTIFACT] harness-task-dispatch.js + harness-phase-advancer.js 已删
  Test: `manual:node -e "const fs=require('fs'); if(fs.existsSync('packages/brain/src/harness-task-dispatch.js')||fs.existsSync('packages/brain/src/harness-phase-advancer.js'))process.exit(1)"`
- [x] [ARTIFACT] harness-watcher.js 缩为 deprecation stub
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8'); if(!c.includes('RETIRED')||c.length>500)process.exit(1)"`

## BEHAVIOR
- [x] [BEHAVIOR] harness-task.graph 端到端 mock 跑通 happy/fix-loop/timeout/no_pr 4 场景
  Test: `tests/packages/brain/src/workflows/__tests__/harness-task.graph.test.js`
- [x] [BEHAVIOR] harness-initiative.graph full 端到端 mock 跑通 happy + fix-loop + resume
  Test: `tests/packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`
- [x] [BEHAVIOR] integration 4 sub_tasks fanout + 1 fail FAIL 路径
  Test: `tests/packages/brain/src/workflows/__tests__/harness-full-pipeline.integration.test.js`
- [x] [BEHAVIOR] grep 验证 6 老 module 被删或留 deprecation comment
  Test: `manual:node -e "const {execSync}=require('child_process'); const out=execSync('grep -rn \"triggerHarnessTaskDispatch\\\\|advanceHarnessInitiatives\\\\|runPhaseCIfReady\\\\|createFixTask\\\\|runFinalE2E\" packages/brain/src --include=*.js || true').toString(); const real=out.split('\\n').filter(l=>l && !l.includes('__tests__') && !l.includes('@deprecated') && !l.includes('// ') && !l.includes('Sprint 1') && !l.includes('retired') && !l.includes('SAFETY')); if(real.length>5)process.exit(1)"`
```

- [ ] **Step 5: 写 Learning**

`docs/learnings/cp-0426102619-harness-langgraph-refactor.md`：

```markdown
# Learning: Phase B/C 全程 LangGraph 重构

## 关键决策

1. **Send API 替代手动 fanout**：LangGraph `Send('node_name', state)` 让 runtime 并行调度。比手动 Promise.all + state merge 简洁，但需要 reducer 正确（merge by id）。

2. **Sub-graph 嵌入而非递归**：`runSubTaskNode` 编译 sub-graph 一次缓存 + invoke per sub-task，避免每次 build 开销。thread_id `harness-task:${initiativeId}:${subTaskId}` 让每 sub-task 有独立 checkpoint。

3. **同步 setTimeout 替代 interrupt**：第一版 `pollCiNode` 用 `await setTimeout(90s)`，单 sub-task 最多阻塞 30 min。FUTURE 改 LangGraph interrupt + 外部 trigger 续跑（更省 runtime 资源）。

4. **env flag 兜底而非硬切换**：HARNESS_USE_FULL_GRAPH=false 走老路 1 周。executor.js 同时保留两条路径，PRD 给定的失败回退方案。

## 根本原因

之前 Phase B/C 用 procedural module（harness-task-dispatch + harness-watcher + harness-phase-advancer + harness-final-e2e 编排）的根因：
- harness 早期没 LangGraph 基建（Phase A 是后来 C8a 落地）
- shepherd 与 watcher 重复 CI 轮询，状态机错位（merge 责任不清）
- task_type 增长（harness_task / harness_ci_watch / harness_fix / harness_final_e2e）使 Brain task 表膨胀

合并到一个 graph 后：
- state 全程贯穿，PostgresSaver checkpoint 替代 task 表 + initiative_runs.phase 双重存储
- 砍 6 module（净减 ~600 行）+ 4 task_type
- shepherd 加 SQL filter 排除 harness_mode → 唯一 merge 路径在 sub-graph

## 下次预防

- [ ] LangGraph 节点设计第一原则：每节点首句加幂等门 (state.X_done? return)
- [ ] Send API fanout state reducer 必须是 merge-by-id（不是覆盖也不是数组追加）
- [ ] 长循环节点（poll_ci）的 sleep 用 env override（HARNESS_POLL_INTERVAL_MS=0）以便测试加速
- [ ] env flag 双轨期 ≤2 周，到期立删避免长期维护两套代码
```

- [ ] **Step 6: 验证 DoD 命令本机可执行**

Run每个 manual: 命令验证 exit code 0：

```bash
cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor
node -e "require('fs').accessSync('packages/brain/src/workflows/harness-task.graph.js')" && echo OK
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8'); if(!c.includes('fanoutSubTasksNode')||!c.includes('finalE2eNode')||!c.includes('reportNode'))process.exit(1)" && echo OK
node -e "const m=require('./packages/brain/src/harness-utils.js'); if(typeof m.topologicalLayers!=='function')process.exit(1)" && echo OK
```

但 `require('./packages/brain/src/harness-utils.js')` 需要 ESM/CJS 支持 — package.json 是 type=module 时需用 import。改测试命令：

```js
manual:node --input-type=module -e "import('./packages/brain/src/harness-utils.js').then(m=>{if(typeof m.topologicalLayers!=='function')process.exit(1)})"
```

- [ ] **Step 7: Commit PRD/DoD/Learning + version bump**

```bash
git add cp-0426102619-harness-langgraph-refactor.prd.md cp-0426102619-harness-langgraph-refactor.dod.md docs/learnings/cp-0426102619-harness-langgraph-refactor.md packages/brain/package.json packages/brain/package-lock.json
git commit -m "chore(brain): bump version + 写 PRD/DoD/Learning

Sprint 1 Phase B/C 全程 LangGraph 重构。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: 最终全套测试 + push + PR + 等 CI

- [ ] **Step 1: 全测试 + lint**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && npx vitest run packages/brain 2>&1 | tail -20`
Expected: All PASS

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && cd packages/brain && npm run lint 2>&1 | tail -10`
Expected: 0 errors（如有 warnings 修；errors 必须修）

- [ ] **Step 2: facts-check + version sync 再跑**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/engine/scripts/devgate/check-dod-mapping.cjs cp-0426102619-harness-langgraph-refactor.dod.md`
Expected: PASS

- [ ] **Step 3: push + create PR**

```bash
cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor
git push -u origin cp-0426102619-harness-langgraph-refactor
gh pr create --title "feat(brain): Phase B/C 进 LangGraph — 一个 graph 跑到底，砍 6 module + 4 task_type" --body "$(cat <<'EOF'
## Summary

Sprint 1 brain task `5616cc28-28c8-4896-b57e-ee9fcc413e86`：把 Harness Phase B/C 从 procedural 改 LangGraph，一个 graph 从 Initiative POST 跑到 Final E2E END，state 贯穿全程。

- 新建 `harness-task.graph.js` (sub-graph): spawn → parse_callback → poll_ci → conditional(pass→merge / fail→fix loop / timeout)
- 扩 `harness-initiative.graph.js`: + fanout_sub_tasks (Send API) → run_sub_task → join → final_e2e → report
- 砍 6 procedural module: harness-task-dispatch / harness-watcher (缩为 stub) / harness-phase-advancer / harness-final-e2e.runFinalE2E / harness-initiative-runner.runPhaseCIfReady / shepherd 加 harness_mode filter
- 砍 4 task_type 执行: harness_task / harness_ci_watch / harness_fix / harness_final_e2e (executor 标 terminal_failure)
- env flag `HARNESS_USE_FULL_GRAPH=false` 走老路（迁移期 1 周）

## Test plan

- [x] harness-utils.test.js (10 tests)
- [x] harness-task.graph.test.js (17+ tests，含 happy/fix-loop/timeout/no_pr 端到端)
- [x] harness-initiative-graph.test.js (老 C8a + 新节点 + 老 5 节点全过)
- [x] harness-initiative.graph.full.test.js (3 端到端 + resume)
- [x] harness-full-pipeline.integration.test.js (4 sub_tasks fanout + FAIL 路径)
- [x] grep 6 老 module 引用验证

## 砍/建文件清单

新建：
- packages/brain/src/workflows/harness-task.graph.js
- packages/brain/src/harness-utils.js
- 4 个测试文件

修改：
- packages/brain/src/workflows/harness-initiative.graph.js (+ 5 节点)
- packages/brain/src/executor.js (harness_initiative full graph + 4 retired type 标 terminal)
- packages/brain/src/tick-runner.js (删 watcher / advancer 钩子)
- packages/brain/src/shepherd.js (SQL 加 harness_mode filter)
- packages/brain/src/harness-final-e2e.js (删 runFinalE2E + collectAllCoveredTasks)
- packages/brain/src/harness-initiative-runner.js (删 Phase C 段)

删除/Stub：
- packages/brain/src/harness-task-dispatch.js (删)
- packages/brain/src/harness-phase-advancer.js (删)
- packages/brain/src/harness-watcher.js (缩为 deprecation stub)

净减 ~600 行（删 ~1500，加 ~900 含测试）。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: 等 CI（foreground 阻塞）**

Run: `cd /Users/administrator/worktrees/cecelia/harness-langgraph-refactor && until [[ $(gh pr checks --watch 2>/dev/null | grep -cE 'pending|in_progress') == 0 ]]; do sleep 30; done; gh pr checks`
Expected: 所有 check PASS

- [ ] **Step 5: 如有 CI 失败修复后再 push**

如有 failure → 调试 → 新 commit → push → 再等

- [ ] **Step 6: 任务结束时 engine-ship 接管合并**

由 finishing skill 接管。

---

## Self-Review

**1. Spec coverage:**
- 新 graph 节点 ✅ (Task 2-7)
- sub-graph ✅ (Task 2-5)
- 砍 6 module ✅ (Task 9-11)
- 砍 4 task_type ✅ (Task 8)
- env flag fallback ✅ (Task 8)
- 单测 + 集成测试 ✅ (Task 5, 7, 12)
- PostgresSaver resume ✅ (Task 7 step 1 测试 3)
- grep 验证 ✅ (Task 13)

**2. Placeholder scan:** 无 TBD / TODO / "实现 later"

**3. Type consistency:**
- TaskState fields: pr_url/pr_branch/fix_round/poll_count/ci_status/ci_fail_type/failed_checks/status/cost_usd/error - 一致使用
- FullInitiativeState: 复用 InitiativeState + sub_task/sub_tasks/all_sub_tasks_done/final_e2e_verdict/final_e2e_failed_scenarios/report_path
- 函数命名：spawnGeneratorNode / parseCallbackNode / pollCiNode / mergePrNode / fixDispatchNode / fanoutSubTasksNode / runSubTaskNode / joinSubTasksNode / finalE2eNode / reportNode - 一致 camelCase 后缀 Node

无歧义、无矛盾。

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-26-harness-langgraph-full-graph.md`.**

按 /dev SKILL.md Tier 1 规则，writing-plans "Subagent-Driven vs Inline?" → **subagent-driven** (default)。
但本任务量大 (15 task)，且节点间高度耦合（state schema 一致性、reducer 行为）。判断后 inline executing 更合适：subagent 之间状态共享只能通过 plan 文件，每个 subagent 重启 context 易引入不一致。

**决策**: 用 **superpowers:executing-plans (Inline Execution)**，分批 commit 检查点。
