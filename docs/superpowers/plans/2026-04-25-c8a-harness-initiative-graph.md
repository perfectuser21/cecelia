# Brain v2 C8a — harness-initiative 真图重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `packages/brain/src/workflows/harness-initiative.graph.js` 阶段 A 的 528 行单 function `runInitiative` 改造成 5 节点 LangGraph 状态机，每节点之间用 PostgresSaver 持久化、Brain 重启不重 spawn 已完成节点。

**Architecture:** 5 业务节点（prep / planner / parsePrd / ganLoop / dbUpsert）+ END，每节点首句模板化幂等门解 C6 smoke 的 spawn replay 问题。GAN 沿用 wrapper 模式（不引 `addSubgraph`）。legacy `runInitiative` 528 行原状保留，`HARNESS_INITIATIVE_RUNTIME=v2` env flag 灰度切换。phase C 函数原位不动。

**Tech Stack:** LangGraph JS (`@langchain/langgraph`)、PostgresSaver（已有 `getPgCheckpointer` 单例）、vitest（单测）、参照 `packages/brain/src/workflows/dev-task.graph.js` (60 行) 模板。

**Spec:** `docs/superpowers/specs/2026-04-25-c8a-harness-initiative-graph-design.md`
**Brain task:** `e4d08a28-3dc4-42b0-b25e-3c8e8ef939f2`
**worktree:** `/Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph`
**branch:** `cp-0425180840-c8a-harness-initiative-graph`

---

## File Structure

| 文件 | 操作 | 说明 |
|---|---|---|
| `packages/brain/src/workflows/harness-initiative.graph.js` | Modify (append) | 加 ~280 行：State + 5 节点 + builder + compile + helper（保留原 528 行 legacy + phase C 函数） |
| `packages/brain/src/workflows/index.js` | Modify (append) | 加 import + register `harness-initiative`，幂等检查改用 `listWorkflows` |
| `packages/brain/src/executor.js` L2807-L2829 | Modify | 加 `HARNESS_INITIATIVE_RUNTIME=v2` env gate 走 `runWorkflow` |
| `packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js` | Create | 新 ~280 行：12 测（5 节点 happy/idempotent/error + buildGraph + compileGraph） |
| `docs/learnings/cp-0425180840-c8a-harness-initiative-graph.md` | Create | Learning：根本原因 + 下次预防 checklist |

---

## Task 1: 测试骨架 + State 定义 + 5 节点 stub + buildGraph + compileGraph

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js`
- Modify (append): `packages/brain/src/workflows/harness-initiative.graph.js` (append after L528)

- [ ] **Step 1.1: 写 failing test — buildGraph + compileGraph 结构**

Create `packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js`:

```js
/**
 * Brain v2 C8a: harness-initiative graph 单元测试。
 * 覆盖 5 节点（prep/planner/parsePrd/ganLoop/dbUpsert）的 happy/idempotent/error
 * + buildGraph/compileGraph 结构 + DoD ≥5 addNode。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks 注入
const mockSpawn = vi.fn();
const mockEnsureWorktree = vi.fn();
const mockResolveToken = vi.fn();
const mockParseTaskPlan = vi.fn();
const mockUpsertTaskPlan = vi.fn();
const mockRunGan = vi.fn();
const mockReadFile = vi.fn();

vi.mock('../../spawn/index.js', () => ({ spawn: (...a) => mockSpawn(...a) }));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: (...a) => mockEnsureWorktree(...a) }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: (...a) => mockResolveToken(...a) }));
vi.mock('../../harness-graph.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL CONTENT',
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: (...a) => mockParseTaskPlan(...a),
  upsertTaskPlan: (...a) => mockUpsertTaskPlan(...a),
}));
vi.mock('../../harness-gan-graph.js', () => ({ runGanContractGraph: (...a) => mockRunGan(...a) }));
vi.mock('node:fs/promises', () => ({ default: { readFile: (...a) => mockReadFile(...a) }, readFile: (...a) => mockReadFile(...a) }));
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
  buildHarnessInitiativeGraph,
  compileHarnessInitiativeGraph,
  prepInitiativeNode,
  runPlannerNode,
  parsePrdNode,
  runGanLoopNode,
  dbUpsertNode,
  InitiativeState,
} from '../harness-initiative.graph.js';

describe('harness-initiative graph — structure', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockEnsureWorktree.mockReset();
    mockResolveToken.mockReset();
    mockParseTaskPlan.mockReset();
    mockUpsertTaskPlan.mockReset();
    mockRunGan.mockReset();
    mockReadFile.mockReset();
  });

  it('buildHarnessInitiativeGraph compile 不抛', () => {
    const g = buildHarnessInitiativeGraph();
    expect(g).toBeDefined();
    const compiled = g.compile();
    expect(typeof compiled.invoke).toBe('function');
  });

  it('compileHarnessInitiativeGraph 用 pg checkpointer 不抛', async () => {
    const compiled = await compileHarnessInitiativeGraph();
    expect(typeof compiled.invoke).toBe('function');
  });

  it('InitiativeState 含必要 channels', () => {
    expect(InitiativeState).toBeDefined();
  });
});
```

- [ ] **Step 1.2: Run test, expect FAIL**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js -t "structure"
```
Expected: FAIL with `does not provide an export named 'buildHarnessInitiativeGraph'` (节点 + State 没 export)。

- [ ] **Step 1.3: 在 .graph.js 末尾追加 State + 5 节点 stub + builder + compile**

Append to `packages/brain/src/workflows/harness-initiative.graph.js` (after L528, end of file):

```js

// ─── Brain v2 C8a — LangGraph 真图实现（阶段 A）────────────────────────
// 与上方 legacy `runInitiative` 528 行并存。executor.js 通过 HARNESS_INITIATIVE_RUNTIME=v2
// env flag 切换两套实现，灰度推进。
//
// 节点拓扑：START → prep → planner → parsePrd → ganLoop → dbUpsert → END
//                    ↓error  ↓error    ↓error    ↓error
//                    └────────┴──────────┴─────────┴──────→ END (条件 edge)
//
// 每节点首句幂等门防 LangGraph resume 重 spawn（C6 smoke 教训）。
// PRD: docs/superpowers/specs/2026-04-25-c8a-harness-initiative-graph-design.md

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { getPgCheckpointer } from './orchestrator/pg-checkpointer.js';
// 注：上方 imports 已含 spawn / parseDockerOutput / loadSkillContent / parseTaskPlan /
// upsertTaskPlan / ensureHarnessWorktree / resolveGitHubToken / runGanContractGraph

export const InitiativeState = Annotation.Root({
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
});

// 节点 stub — Task 2-6 逐个填充。
export async function prepInitiativeNode(_state) { return {}; }
export async function runPlannerNode(_state) { return {}; }
export async function parsePrdNode(_state) { return {}; }
export async function runGanLoopNode(_state) { return {}; }
export async function dbUpsertNode(_state) { return {}; }

function stateHasError(state) { return state.error ? 'error' : 'ok'; }

export function buildHarnessInitiativeGraph() {
  return new StateGraph(InitiativeState)
    .addNode('prep', prepInitiativeNode)
    .addNode('planner', runPlannerNode)
    .addNode('parsePrd', parsePrdNode)
    .addNode('ganLoop', runGanLoopNode)
    .addNode('dbUpsert', dbUpsertNode)
    .addEdge(START, 'prep')
    .addConditionalEdges('prep', stateHasError, { error: END, ok: 'planner' })
    .addConditionalEdges('planner', stateHasError, { error: END, ok: 'parsePrd' })
    .addConditionalEdges('parsePrd', stateHasError, { error: END, ok: 'ganLoop' })
    .addConditionalEdges('ganLoop', stateHasError, { error: END, ok: 'dbUpsert' })
    .addEdge('dbUpsert', END);
}

export async function compileHarnessInitiativeGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildHarnessInitiativeGraph().compile({ checkpointer });
}
```

- [ ] **Step 1.4: Run structure tests, expect PASS**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js -t "structure"
```
Expected: 3 tests pass (`buildHarnessInitiativeGraph compile 不抛` / `compileHarnessInitiativeGraph` / `InitiativeState`).

- [ ] **Step 1.5: Commit Task 1**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  git add packages/brain/src/workflows/harness-initiative.graph.js \
          packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js && \
  git commit -m "test(brain-v2-c8a): graph skeleton + 5 节点 stub + State + buildGraph compile

C8a Step 1：基础结构与测试骨架。
- InitiativeState（10 channels，全 replace reducer）
- 5 节点 stub（return {}）+ buildHarnessInitiativeGraph + compileHarnessInitiativeGraph
- DoD ≥5 .addNode() 已满足
- legacy runInitiative 528 行 + phase C 函数原位不动

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: prepInitiativeNode 节点实现

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js` (替换 prepInitiativeNode stub)
- Modify: `packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js` (append describe block)

- [ ] **Step 2.1: 写 prep 节点 3 测试（happy/idempotent/error）**

Append to test file (在 describe('harness-initiative graph — structure') 块之后):

```js
describe('prepInitiativeNode', () => {
  beforeEach(() => {
    mockEnsureWorktree.mockReset();
    mockResolveToken.mockReset();
  });

  it('happy: 调 ensureHarnessWorktree + resolveGitHubToken 写入 worktreePath/githubToken/initiativeId', async () => {
    mockEnsureWorktree.mockResolvedValueOnce('/wt/foo');
    mockResolveToken.mockResolvedValueOnce('ghp_xxx');
    const state = { task: { id: 't1', payload: { initiative_id: 'init-1' } } };
    const delta = await prepInitiativeNode(state);
    expect(mockEnsureWorktree).toHaveBeenCalledWith({ taskId: 't1', initiativeId: 'init-1' });
    expect(mockResolveToken).toHaveBeenCalledTimes(1);
    expect(delta.worktreePath).toBe('/wt/foo');
    expect(delta.githubToken).toBe('ghp_xxx');
    expect(delta.initiativeId).toBe('init-1');
    expect(delta.error).toBeUndefined();
  });

  it('idempotent: state.worktreePath 已存在 → 不调底层依赖', async () => {
    const state = { worktreePath: '/wt/existing', task: { id: 't2' } };
    const delta = await prepInitiativeNode(state);
    expect(mockEnsureWorktree).not.toHaveBeenCalled();
    expect(mockResolveToken).not.toHaveBeenCalled();
    expect(delta.worktreePath).toBe('/wt/existing');
  });

  it('error: ensureHarnessWorktree 抛 → state.error.node="prep"', async () => {
    mockEnsureWorktree.mockRejectedValueOnce(new Error('worktree busy'));
    const state = { task: { id: 't3', payload: {} } };
    const delta = await prepInitiativeNode(state);
    expect(delta.error).toBeDefined();
    expect(delta.error.node).toBe('prep');
    expect(delta.error.message).toBe('worktree busy');
  });
});
```

- [ ] **Step 2.2: Run prep tests, expect FAIL**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js -t "prepInitiativeNode"
```
Expected: 3 tests fail（stub 返回 `{}` 不调依赖，3 测都不通过）。

- [ ] **Step 2.3: 替换 prepInitiativeNode stub 为真实现**

Edit `packages/brain/src/workflows/harness-initiative.graph.js`，替换：

```js
// 旧
export async function prepInitiativeNode(_state) { return {}; }
```

为：

```js
export async function prepInitiativeNode(state) {
  if (state.worktreePath) return { worktreePath: state.worktreePath };
  try {
    const initiativeId = state.task?.payload?.initiative_id || state.task?.initiative_id || state.task?.id;
    const worktreePath = await ensureHarnessWorktree({ taskId: state.task.id, initiativeId });
    const githubToken = await resolveGitHubToken();
    return { worktreePath, githubToken, initiativeId };
  } catch (err) {
    return { error: { node: 'prep', message: err.message } };
  }
}
```

- [ ] **Step 2.4: Run prep tests, expect PASS**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js -t "prepInitiativeNode"
```
Expected: 3 prep tests pass.

- [ ] **Step 2.5: Commit Task 2**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js \
        packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js && \
  git commit -m "feat(brain-v2-c8a): prepInitiativeNode 实现 + 幂等门 + 3 测

ensureHarnessWorktree + resolveGitHubToken；幂等门 if state.worktreePath。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: runPlannerNode 节点实现

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js` (替换 stub + 加常量)
- Modify: `packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js`

- [ ] **Step 3.1: 写 planner 节点 4 测试**

Append to test file:

```js
describe('runPlannerNode', () => {
  beforeEach(() => { mockSpawn.mockReset(); });

  it('happy: 调 spawn 传 harness_planner task_type + HARNESS_NODE=planner env', async () => {
    mockSpawn.mockResolvedValueOnce({ exit_code: 0, stdout: 'PLANNER OUT' });
    const state = {
      task: { id: 't1', description: 'do', payload: { sprint_dir: 'sprints' } },
      initiativeId: 'init-1', worktreePath: '/wt', githubToken: 'ghp_x',
    };
    const delta = await runPlannerNode(state);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const opts = mockSpawn.mock.calls[0][0];
    expect(opts.task.task_type).toBe('harness_planner');
    expect(opts.worktreePath).toBe('/wt');
    expect(opts.env.HARNESS_NODE).toBe('planner');
    expect(opts.env.HARNESS_INITIATIVE_ID).toBe('init-1');
    expect(opts.env.GITHUB_TOKEN).toBe('ghp_x');
    expect(delta.plannerOutput).toBe('PLANNER OUT');
    expect(delta.error).toBeUndefined();
  });

  it('idempotent: state.plannerOutput 已存在 → 不调 spawn', async () => {
    const state = { plannerOutput: 'cached', task: { id: 't2' } };
    const delta = await runPlannerNode(state);
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(delta.plannerOutput).toBe('cached');
  });

  it('error: spawn 抛 → state.error.node="planner"', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('docker died'));
    const state = { task: { id: 't3', payload: {} }, initiativeId: 'init-3', worktreePath: '/wt' };
    const delta = await runPlannerNode(state);
    expect(delta.error.node).toBe('planner');
    expect(delta.error.message).toBe('docker died');
  });

  it('exit_code != 0: state.error 含 stderr tail', async () => {
    mockSpawn.mockResolvedValueOnce({ exit_code: 1, stderr: 'oops' });
    const state = { task: { id: 't4', payload: {} }, initiativeId: 'init-4', worktreePath: '/wt' };
    const delta = await runPlannerNode(state);
    expect(delta.error.node).toBe('planner');
    expect(delta.error.message).toContain('exit=1');
    expect(delta.error.message).toContain('oops');
  });
});
```

- [ ] **Step 3.2: Run planner tests, expect FAIL**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js -t "runPlannerNode"
```
Expected: 4 tests fail (stub 不调 spawn).

- [ ] **Step 3.3: 替换 runPlannerNode stub**

Edit `packages/brain/src/workflows/harness-initiative.graph.js`：

替换 `export async function runPlannerNode(_state) { return {}; }` 为：

```js
export async function runPlannerNode(state, opts = {}) {
  if (state.plannerOutput) return { plannerOutput: state.plannerOutput };
  try {
    const executor = opts.executor || spawn;
    const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
    const skillContent = loadSkillContent('harness-planner');
    const prompt = `你是 harness-planner agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${state.task.id}
**initiative_id**: ${state.initiativeId}
**sprint_dir**: ${sprintDir}

## 任务描述
${state.task.description || state.task.title || ''}

## 输出要求（v2）
1. 生成 ${sprintDir}/sprint-prd.md（What，不写 How）
2. 在 stdout 末尾输出 task-plan.json
3. task-plan.json 必须被 \`\`\`json ... \`\`\` 代码块包裹便于提取`;

    const result = await executor({
      task: { ...state.task, task_type: 'harness_planner' },
      prompt,
      worktreePath: state.worktreePath,
      env: {
        CECELIA_TASK_TYPE: 'harness_planner',
        HARNESS_NODE: 'planner',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: state.initiativeId,
        GITHUB_TOKEN: state.githubToken,
      },
    });
    if (result.exit_code !== 0 || result.timed_out) {
      const msg = result.timed_out
        ? 'Docker timeout'
        : `Docker exit=${result.exit_code}: ${(result.stderr || '').slice(-500)}`;
      return { error: { node: 'planner', message: msg } };
    }
    const plannerOutput = parseDockerOutput(result.stdout);
    return { plannerOutput };
  } catch (err) {
    return { error: { node: 'planner', message: err.message } };
  }
}
```

- [ ] **Step 3.4: Run planner tests, expect PASS**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js -t "runPlannerNode"
```
Expected: 4 planner tests pass.

- [ ] **Step 3.5: Commit Task 3**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js \
        packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js && \
  git commit -m "feat(brain-v2-c8a): runPlannerNode + 幂等门 + 4 测

spawn harness_planner + HARNESS_NODE=planner env，幂等门 if state.plannerOutput。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: parsePrdNode 节点实现

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`
- Modify: `packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js`

- [ ] **Step 4.1: 写 parsePrd 节点 3 测试**

Append to test file:

```js
describe('parsePrdNode', () => {
  beforeEach(() => {
    mockParseTaskPlan.mockReset();
    mockReadFile.mockReset();
  });

  it('happy: parseTaskPlan + 读 sprint-prd.md → state.taskPlan + prdContent', async () => {
    mockParseTaskPlan.mockReturnValueOnce({ initiative_id: 'pending', tasks: [] });
    mockReadFile.mockResolvedValueOnce('# PRD content');
    const state = {
      task: { id: 't1', payload: { sprint_dir: 'sprints' } },
      initiativeId: 'init-1', worktreePath: '/wt', plannerOutput: 'OUT',
    };
    const delta = await parsePrdNode(state);
    expect(mockParseTaskPlan).toHaveBeenCalledWith('OUT');
    expect(delta.taskPlan.initiative_id).toBe('init-1');
    expect(delta.prdContent).toBe('# PRD content');
  });

  it('idempotent: state.taskPlan + prdContent 已存在 → 不调 parseTaskPlan', async () => {
    const state = { taskPlan: { initiative_id: 'x' }, prdContent: 'cached', plannerOutput: 'OUT', task: { id: 't2', payload: {} } };
    const delta = await parsePrdNode(state);
    expect(mockParseTaskPlan).not.toHaveBeenCalled();
    expect(delta.taskPlan.initiative_id).toBe('x');
    expect(delta.prdContent).toBe('cached');
  });

  it('error: parseTaskPlan 抛 → state.error.node="parsePrd"', async () => {
    mockParseTaskPlan.mockImplementationOnce(() => { throw new Error('bad json'); });
    const state = { task: { id: 't3', payload: {} }, initiativeId: 'init-3', worktreePath: '/wt', plannerOutput: 'OUT' };
    const delta = await parsePrdNode(state);
    expect(delta.error.node).toBe('parsePrd');
    expect(delta.error.message).toContain('bad json');
  });
});
```

- [ ] **Step 4.2: Run parsePrd tests, expect FAIL**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js -t "parsePrdNode"
```
Expected: 3 tests fail.

- [ ] **Step 4.3: 替换 parsePrdNode stub**

替换 `export async function parsePrdNode(_state) { return {}; }` 为：

```js
export async function parsePrdNode(state) {
  if (state.taskPlan && state.prdContent) {
    return { taskPlan: state.taskPlan, prdContent: state.prdContent };
  }
  let taskPlan;
  try {
    taskPlan = parseTaskPlan(state.plannerOutput);
  } catch (err) {
    return { error: { node: 'parsePrd', message: `parseTaskPlan: ${err.message}` } };
  }
  if (taskPlan.initiative_id === 'pending' || !taskPlan.initiative_id) {
    taskPlan.initiative_id = state.initiativeId;
  }
  const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  let prdContent = state.plannerOutput;
  try {
    const fsPromises = await import('node:fs/promises');
    const pathMod = (await import('node:path')).default;
    prdContent = await fsPromises.readFile(
      pathMod.join(state.worktreePath, sprintDir, 'sprint-prd.md'),
      'utf8'
    );
  } catch (err) {
    console.error(`[harness-initiative-graph] read sprint-prd.md failed (${err.message}), falling back to planner stdout`);
  }
  return { taskPlan, prdContent };
}
```

- [ ] **Step 4.4: Run parsePrd tests, expect PASS**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js -t "parsePrdNode"
```
Expected: 3 parsePrd tests pass.

- [ ] **Step 4.5: Commit Task 4**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js \
        packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js && \
  git commit -m "feat(brain-v2-c8a): parsePrdNode + 幂等门 + 3 测

parseTaskPlan + 读 sprint-prd.md，幂等门 if state.taskPlan && state.prdContent。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: runGanLoopNode 节点实现

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`
- Modify: `packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js`

- [ ] **Step 5.1: 写 ganLoop 节点 3 测试**

Append:

```js
describe('runGanLoopNode', () => {
  beforeEach(() => { mockRunGan.mockReset(); });

  it('happy: 调 runGanContractGraph 写入 ganResult', async () => {
    mockRunGan.mockResolvedValueOnce({ contract_content: 'C', rounds: 2 });
    const state = {
      task: { id: 't1', payload: { sprint_dir: 'sprints' } },
      initiativeId: 'init-1', worktreePath: '/wt', githubToken: 'ghp', prdContent: 'PRD',
    };
    const delta = await runGanLoopNode(state);
    expect(mockRunGan).toHaveBeenCalledTimes(1);
    expect(mockRunGan.mock.calls[0][0].taskId).toBe('t1');
    expect(mockRunGan.mock.calls[0][0].prdContent).toBe('PRD');
    expect(delta.ganResult).toEqual({ contract_content: 'C', rounds: 2 });
  });

  it('idempotent: state.ganResult 已存在 → 不调 runGanContractGraph', async () => {
    const state = { ganResult: { contract_content: 'cached', rounds: 1 }, task: { id: 't2', payload: {} } };
    const delta = await runGanLoopNode(state);
    expect(mockRunGan).not.toHaveBeenCalled();
    expect(delta.ganResult.contract_content).toBe('cached');
  });

  it('error: runGanContractGraph 抛 → state.error.node="gan"', async () => {
    mockRunGan.mockRejectedValueOnce(new Error('gan rejected'));
    const state = { task: { id: 't3', payload: {} }, initiativeId: 'i', worktreePath: '/wt', githubToken: 'g', prdContent: 'P' };
    const delta = await runGanLoopNode(state);
    expect(delta.error.node).toBe('gan');
    expect(delta.error.message).toBe('gan rejected');
  });
});
```

- [ ] **Step 5.2: Run ganLoop tests, expect FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js -t "runGanLoopNode"
```
Expected: 3 fail.

- [ ] **Step 5.3: 替换 runGanLoopNode stub**

替换 `export async function runGanLoopNode(_state) { return {}; }` 为：

```js
export async function runGanLoopNode(state, opts = {}) {
  if (state.ganResult) return { ganResult: state.ganResult };
  try {
    const executor = opts.executor || spawn;
    const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
    const budgetUsd = state.task?.payload?.budget_usd || 10;
    const ganResult = await runGanContractGraph({
      taskId: state.task.id,
      initiativeId: state.initiativeId,
      sprintDir,
      prdContent: state.prdContent,
      executor,
      worktreePath: state.worktreePath,
      githubToken: state.githubToken,
      budgetCapUsd: budgetUsd,
      checkpointer: opts.checkpointer,
    });
    return { ganResult };
  } catch (err) {
    return { error: { node: 'gan', message: err.message } };
  }
}
```

- [ ] **Step 5.4: Run ganLoop tests, expect PASS**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js -t "runGanLoopNode"
```
Expected: 3 pass.

- [ ] **Step 5.5: Commit Task 5**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js \
        packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js && \
  git commit -m "feat(brain-v2-c8a): runGanLoopNode + 幂等门 + 3 测

wrapper runGanContractGraph 不引 addSubgraph；幂等门 if state.ganResult。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: dbUpsertNode 节点实现

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`
- Modify: `packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js`

- [ ] **Step 6.1: 写 dbUpsert 节点 3 测试**

Append:

```js
describe('dbUpsertNode', () => {
  beforeEach(() => { mockUpsertTaskPlan.mockReset(); });

  function makeMockClient() {
    const client = {
      query: vi.fn(),
      release: vi.fn(),
    };
    // BEGIN
    client.query.mockResolvedValueOnce({ rows: [] });
    // upsertTaskPlan internal queries — pass through mockUpsertTaskPlan
    return client;
  }

  it('happy: BEGIN/COMMIT 单事务 + result.contractId/runId 写入', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })            // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'contract-uuid' }] })  // INSERT initiative_contracts
        .mockResolvedValueOnce({ rows: [{ id: 'run-uuid' }] })       // INSERT initiative_runs
        .mockResolvedValueOnce({ rows: [] }),           // COMMIT
      release: vi.fn(),
    };
    const fakePool = { connect: vi.fn().mockResolvedValue(client) };
    mockUpsertTaskPlan.mockResolvedValueOnce({ idMap: {}, insertedTaskIds: ['st-1'] });
    const state = {
      task: { id: 't1', payload: {} },
      initiativeId: 'init-1',
      taskPlan: { tasks: [] },
      plannerOutput: 'PRD',
      ganResult: { contract_content: 'CT', rounds: 2 },
    };
    const delta = await dbUpsertNode(state, { pool: fakePool });
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
    expect(delta.result.contractId).toBe('contract-uuid');
    expect(delta.result.runId).toBe('run-uuid');
    expect(delta.result.success).toBe(true);
  });

  it('idempotent: state.result.contractId 已存在 → 不调 pool.connect', async () => {
    const fakePool = { connect: vi.fn() };
    const state = { result: { contractId: 'cached' }, task: { id: 't2' } };
    const delta = await dbUpsertNode(state, { pool: fakePool });
    expect(fakePool.connect).not.toHaveBeenCalled();
    expect(delta.result.contractId).toBe('cached');
  });

  it('error: query 抛 → ROLLBACK + state.error.node="dbUpsert"', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })            // BEGIN
        .mockRejectedValueOnce(new Error('insert failed')),
      release: vi.fn(),
    };
    const fakePool = { connect: vi.fn().mockResolvedValue(client) };
    mockUpsertTaskPlan.mockResolvedValueOnce({ idMap: {}, insertedTaskIds: [] });
    const state = {
      task: { id: 't3', payload: {} },
      initiativeId: 'init-3',
      taskPlan: { tasks: [] },
      plannerOutput: 'PRD',
      ganResult: { contract_content: 'CT', rounds: 1 },
    };
    // 加 ROLLBACK 的 mock
    client.query.mockResolvedValueOnce({ rows: [] }); // ROLLBACK after error
    const delta = await dbUpsertNode(state, { pool: fakePool });
    expect(delta.error.node).toBe('dbUpsert');
    expect(delta.error.message).toContain('insert failed');
    expect(client.release).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6.2: Run dbUpsert tests, expect FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js -t "dbUpsertNode"
```
Expected: 3 fail.

- [ ] **Step 6.3: 替换 dbUpsertNode stub**

在 .graph.js 文件顶部确认 import 含 `import pool from '../db.js'`（legacy 已有）。然后替换 stub：

```js
const C8A_DEFAULT_TIMEOUT_SEC = 21600;
const C8A_DEFAULT_BUDGET_USD = 10;

export async function dbUpsertNode(state, opts = {}) {
  if (state.result?.contractId) return { result: state.result };
  const dbPool = opts.pool || pool;
  const timeoutSec = state.task?.payload?.timeout_sec || C8A_DEFAULT_TIMEOUT_SEC;
  const budgetUsd = state.task?.payload?.budget_usd || C8A_DEFAULT_BUDGET_USD;
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      initiativeId: state.initiativeId,
      initiativeTaskId: state.task.id,
      taskPlan: state.taskPlan,
      client,
    });
    const contractInsert = await client.query(
      `INSERT INTO initiative_contracts (
         initiative_id, version, status,
         prd_content, contract_content, review_rounds,
         budget_cap_usd, timeout_sec, approved_at
       )
       VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, NOW())
       RETURNING id`,
      [state.initiativeId, state.plannerOutput, state.ganResult.contract_content, state.ganResult.rounds, budgetUsd, timeoutSec]
    );
    const contractId = contractInsert.rows[0].id;
    const runInsert = await client.query(
      `INSERT INTO initiative_runs (
         initiative_id, contract_id, phase,
         deadline_at
       )
       VALUES ($1::uuid, $2::uuid, 'B_task_loop',
         NOW() + ($3 || ' seconds')::interval
       )
       RETURNING id`,
      [state.initiativeId, contractId, String(timeoutSec)]
    );
    const runId = runInsert.rows[0].id;
    await client.query('COMMIT');
    return {
      result: {
        success: true,
        taskId: state.task.id,
        initiativeId: state.initiativeId,
        contractId,
        runId,
        insertedTaskIds,
        idMap,
      },
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    return { error: { node: 'dbUpsert', message: `tx: ${err.message}` } };
  } finally {
    client.release();
  }
}
```

- [ ] **Step 6.4: Run dbUpsert tests, expect PASS**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js -t "dbUpsertNode"
```
Expected: 3 pass.

- [ ] **Step 6.5: 跑所有 graph tests 确保无回归**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js
```
Expected: 16 tests all pass (3 structure + 3 prep + 4 planner + 3 parsePrd + 3 ganLoop + 3 dbUpsert)。

- [ ] **Step 6.6: Commit Task 6**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js \
        packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js && \
  git commit -m "feat(brain-v2-c8a): dbUpsertNode BEGIN/COMMIT 事务 + 幂等门 + 3 测

upsertTaskPlan + INSERT initiative_contracts/runs；幂等门 if state.result.contractId；error 路径 ROLLBACK。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: workflows/index.js 注册 harness-initiative

**Files:**
- Modify: `packages/brain/src/workflows/index.js` (整改幂等检查 + 注册新 workflow)

- [ ] **Step 7.1: 写 register 测试（追加到现有 index.test.js）**

Read current `packages/brain/src/workflows/__tests__/index.test.js` 看现有结构，然后 append:

```js
// 新加：harness-initiative 注册验证
import { initializeWorkflows, _resetInitializedForTests } from '../index.js';
import { listWorkflows, _clearRegistryForTests } from '../../orchestrator/workflow-registry.js';

describe('initializeWorkflows — harness-initiative', () => {
  beforeEach(() => {
    _clearRegistryForTests();
    _resetInitializedForTests();
  });

  it('注册 harness-initiative workflow', async () => {
    await initializeWorkflows();
    const names = listWorkflows();
    expect(names).toContain('harness-initiative');
    expect(names).toContain('dev-task');
  });

  it('幂等：二次调不抛', async () => {
    await initializeWorkflows();
    await expect(initializeWorkflows()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 7.2: Run test, expect FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/index.test.js -t "harness-initiative"
```
Expected: FAIL（`names` 不含 `harness-initiative`）。

- [ ] **Step 7.3: 改 workflows/index.js**

整改 `packages/brain/src/workflows/index.js` 为：

```js
/**
 * Brain v2 Phase C2 + C8a: workflows 集中注册入口。
 *
 * Brain server 启动时调 initializeWorkflows()，在所有 graph-runtime 调用前把
 * 已知 workflow 注册到 orchestrator/workflow-registry。保证 runWorkflow 能查到。
 *
 * C2: dev-task。C8a: harness-initiative。
 */
import { registerWorkflow, listWorkflows } from '../orchestrator/workflow-registry.js';
import { compileDevTaskGraph } from './dev-task.graph.js';
import { compileHarnessInitiativeGraph } from './harness-initiative.graph.js';

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

  _initialized = true;
}

/**
 * 测试 hook：重置初始化状态。仅 __tests__ 使用。
 */
export function _resetInitializedForTests() {
  _initialized = false;
}
```

- [ ] **Step 7.4: Run test, expect PASS**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/index.test.js -t "harness-initiative"
```
Expected: 2 pass.

- [ ] **Step 7.5: Commit Task 7**

```bash
git add packages/brain/src/workflows/index.js \
        packages/brain/src/workflows/__tests__/index.test.js && \
  git commit -m "feat(brain-v2-c8a): workflows/index.js 注册 harness-initiative + listWorkflows 幂等

改用 listWorkflows() 检查已注册（替代单个 getWorkflow try/catch），支持多 workflow 幂等并存。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: executor.js 加 HARNESS_INITIATIVE_RUNTIME=v2 env gate

**Files:**
- Modify: `packages/brain/src/executor.js` L2807-L2829

- [ ] **Step 8.1: Read 当前 executor.js L2800-L2830**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  sed -n '2800,2832p' packages/brain/src/executor.js
```
确认精确文本，避免 Edit 时 old_string 不唯一。

- [ ] **Step 8.2: Edit executor.js — 在 L2807 分支首部插 env gate**

把：

```js
  if (task.task_type === 'harness_initiative') {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness v2 Initiative Runner (阶段 A)`);
```

替换为：

```js
  if (task.task_type === 'harness_initiative') {
    if (process.env.HARNESS_INITIATIVE_RUNTIME === 'v2') {
      console.log(`[executor] 路由决策: task_type=${task.task_type} → v2 graph runWorkflow (C8a)`);
      try {
        const { runWorkflow } = await import('./orchestrator/graph-runtime.js');
        return await runWorkflow('harness-initiative', task.id, 1, { task });
      } catch (err) {
        console.error(`[executor] v2 graph runWorkflow error task=${task.id}: ${err.message}`);
        return { success: false, taskId: task.id, initiative: true, error: err.message };
      }
    }
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness v2 Initiative Runner (阶段 A)`);
```

- [ ] **Step 8.3: Verify executor.js 含 HARNESS_INITIATIVE_RUNTIME**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  grep -c "HARNESS_INITIATIVE_RUNTIME" packages/brain/src/executor.js
```
Expected: `1` (or higher).

- [ ] **Step 8.4: Syntax check**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  node --check packages/brain/src/executor.js && \
  node --check packages/brain/src/workflows/harness-initiative.graph.js && \
  node --check packages/brain/src/workflows/index.js
```
Expected: 3 个 `node --check` 全无输出（无 SyntaxError）。

- [ ] **Step 8.5: Commit Task 8**

```bash
git add packages/brain/src/executor.js && \
  git commit -m "feat(brain-v2-c8a): executor.js 加 HARNESS_INITIATIVE_RUNTIME=v2 env gate

env flag 默认未设 → 走 legacy runInitiative；设 'v2' → runWorkflow('harness-initiative')。
独立于 WORKFLOW_RUNTIME（C6 dev gate），让 dev/harness 灰度分别推进。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Learning 文件

**Files:**
- Create: `docs/learnings/cp-0425180840-c8a-harness-initiative-graph.md`

- [ ] **Step 9.1: Write Learning**

Create `docs/learnings/cp-0425180840-c8a-harness-initiative-graph.md`:

```markdown
# Learning — C8a harness-initiative 真图重设计

## 背景
PRD: docs/design/brain-v2-c8-d-e-handoff.md §3
Spec: docs/superpowers/specs/2026-04-25-c8a-harness-initiative-graph-design.md
Brain task: e4d08a28-3dc4-42b0-b25e-3c8e8ef939f2

## 干了什么
把 packages/brain/src/workflows/harness-initiative.graph.js 阶段 A 的 528 行单 function `runInitiative` 改造为 5 节点 LangGraph 状态机：
- prep → planner → parsePrd → ganLoop → dbUpsert → END
- 每节点首句幂等门 (`if state.X return ...`) 解 C6 smoke 的 spawn replay 问题
- legacy runInitiative 528 行原状保留
- env flag `HARNESS_INITIATIVE_RUNTIME=v2` 切换两套实现，灰度推进
- workflows/index.js 用 listWorkflows() 幂等检查并注册 harness-initiative
- executor.js L2807 加 v2 gate 走 runWorkflow

## 根本原因
Brain v2 Phase C2/C3 时 .graph.js 文件名字带 graph 但实质是 runner（单 function）。导致 1-2h harness-initiative 任务在 Brain 重启时清零（无节点级 checkpoint）。C8a 是把它升级为真 LangGraph 图的第一棒。

## 下次预防
- [ ] 加新 workflow 文件时，文件命名严格遵守约定：`.graph.js` = StateGraph 真实现，`.runner.js` = 单 function。审查时 grep `addNode\|StateGraph` 验证
- [ ] LangGraph 真图节点必加幂等门：每节点首句 `if (state.X) return { X: state.X }`，否则 resume replay 会重 spawn 容器
- [ ] env flag 灰度 — legacy 路径必须保留至少 1 周生产观察期，确认 v2 稳定后才删
- [ ] workflows/index.js 注册新 workflow 用 listWorkflows() 检查（不要单个 getWorkflow try/catch），多 workflow 共存幂等
- [ ] phase 拆分边界：阶段 A 进图，阶段 C 函数（runPhaseCIfReady 等）保留独立 export 不进图——避免一次重构耦合
```

- [ ] **Step 9.2: Commit Task 9**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  git add docs/learnings/cp-0425180840-c8a-harness-initiative-graph.md && \
  git commit -m "docs(brain-v2-c8a): learning — harness-initiative 真图 + 幂等门 + 灰度

5 条预防 checklist：文件命名约定、节点幂等门、env flag 保留 legacy、listWorkflows 幂等、phase 拆分边界。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 全测试 + DoD 校验 + 标 [x]

**Files:**
- Modify: `docs/superpowers/specs/2026-04-25-c8a-harness-initiative-graph-design.md`（DoD 项标 [x]）

- [ ] **Step 10.1: 跑全 graph 测试**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js \
                  packages/brain/src/workflows/__tests__/index.test.js
```
Expected: 18+ tests all pass。

- [ ] **Step 10.2: 跑完整 brain test suite 确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  npx vitest run --reporter=verbose packages/brain/src 2>&1 | tail -30
```
Expected: 现有 test 全过。如有 fail 必须修。

- [ ] **Step 10.3: 跑 5 条 DoD manual: 命令验证产物**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const n=(c.match(/addNode/g)||[]).length;if(n<5||!c.includes('StateGraph'))process.exit(1);console.log('DoD1 OK n='+n);" && \
  node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/index.js','utf8');if(!/registerWorkflow\(\s*['\"]harness-initiative['\"]/.test(c))process.exit(1);console.log('DoD2 OK');" && \
  node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('HARNESS_INITIATIVE_RUNTIME'))process.exit(1);console.log('DoD3 OK');" && \
  node -e "require('fs').accessSync('packages/brain/src/workflows/__tests__/harness-initiative-graph.test.js');console.log('DoD5 OK');"
```
Expected: 4 lines `DoD1/2/3/5 OK`。DoD4（节点单测全 pass）已在 Step 10.1 验证。

- [ ] **Step 10.4: 改 spec DoD 项为 [x]**

Edit `docs/superpowers/specs/2026-04-25-c8a-harness-initiative-graph-design.md`：把 §5 5 个 `- [BEHAVIOR]` / `- [ARTIFACT]` 行前面加 `[x]` 标记（DoD 三要素：push 前必须 [x]）。

- [ ] **Step 10.5: Commit Task 10**

```bash
cd /Users/administrator/worktrees/cecelia/c8a-harness-initiative-graph && \
  git add docs/superpowers/specs/2026-04-25-c8a-harness-initiative-graph-design.md && \
  git commit -m "docs(brain-v2-c8a): DoD 5 项标 [x] + 全测试 18 pass

跑完 graph + index test 18+ pass，DoD 1-5 manual: 命令本地全过。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## 完成判据（汇总）

- 9 个 commit（Task 1-9 各 1 个 commit + Task 10 验收 commit）
- 全测试 18+ pass
- DoD 5 项 manual: 全通过
- node --check 通过 3 个核心文件
- 5 个文件修改/新增（.graph.js / index.js / executor.js / __tests__/harness-initiative-graph.test.js / Learning + spec）

---

## Self-Review

**Spec coverage 检查**：
- spec §3.1 节点拓扑 → Task 1 builder
- spec §3.2 State → Task 1 InitiativeState
- spec §3.3 节点契约（5 节点幂等门 + main + error）→ Task 2-6 各 1 节点
- spec §3.4 conditional edges → Task 1 builder
- spec §3.5 GAN wrapper → Task 5 runGanLoopNode
- spec §3.6 legacy 兼容 → Task 1 append（不删 528 行）
- spec §3.7 executor env gate → Task 8
- spec §3.8 register → Task 7
- spec §4 测试 12 → Task 1-6 共 16 测（structure 3 + 节点 13）
- spec §5 DoD → Task 10 全验
- spec §6 风险 → 各 task 缓解（每节点幂等门、保留 legacy、独立 env flag、`listWorkflows` 幂等、参照 dev-task mock 模板）

**Placeholder scan**：
- 无 TBD / TODO / "implement later"
- 所有节点函数 / 测试代码完整给出（无 "similar to..."）
- 所有 Run 命令含 Expected
- DoD 测试命令完整 paste-ready

**Type 一致性**：
- 节点签名 `(state, opts) => Promise<Partial<State>>` 一致（除 prep / parsePrd 不带 opts）
- State channel 名字（taskPlan / prdContent / ganResult / result.contractId）跨 task 一致
- env flag 名 `HARNESS_INITIATIVE_RUNTIME='v2'` 跨 spec / task 一致
- mock 名 (`mockSpawn` / `mockEnsureWorktree` / `mockRunGan` 等) 跨测试 describe 一致
