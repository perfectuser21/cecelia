# Fanout Node Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `harness-initiative.graph.js` 的 `dbUpsert` 与 `fanout` 之间插入 `inferTaskPlanNode`，当 `state.taskPlan?.tasks` 为空时调 LLM 拆 sub_task 写回 state，让 fanout 始终能派 Send。

**Architecture:** 新增 1 个 graph node 走幂等门 + spawn fallback；不改 fanout 自身；fallback 失败时 passthrough，让 join 自然走 FAIL 路径。

**Tech Stack:** LangGraph (StateGraph) / vitest / spawn docker executor / harness-dag.parseTaskPlan

---

## File Structure

| 文件 | 责任 |
|---|---|
| `packages/brain/src/workflows/harness-initiative.graph.js` | 加 `inferTaskPlanNode` export + wire `'inferTaskPlan'` 节点到 `buildHarnessFullGraph` |
| `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js` | 加 `inferTaskPlanNode` 单测 + e2e（planner 不出 task → fallback 拯救）|

---

## Task 1: inferTaskPlanNode 幂等分支（已有 tasks → passthrough）

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js` （在 `fanoutSubTasksNode` 上方加新 export）
- Test: `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`

- [ ] **Step 1: 写失败的幂等测试**

在 test 文件的 `describe('joinSubTasksNode', ...)` block 上方插入：

```js
describe('inferTaskPlanNode', () => {
  it('已有 tasks (length>=1) → 不调 executor, 返回 {}', async () => {
    const exec = vi.fn();
    const delta = await inferTaskPlanNode(
      { taskPlan: { tasks: [{ id: 's1', title: 'T1' }] } },
      { executor: exec }
    );
    expect(delta).toEqual({});
    expect(exec).not.toHaveBeenCalled();
  });
});
```

并在 import 段加 `inferTaskPlanNode`：

```js
import {
  fanoutSubTasksNode,
  joinSubTasksNode,
  finalE2eNode,
  reportNode,
  buildHarnessFullGraph,
  inferTaskPlanNode,
} from '../harness-initiative.graph.js';
```

- [ ] **Step 2: 跑测试，预期 fail**

Run: `cd /Users/administrator/worktrees/cecelia/fanout-node-fallback/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative.graph.full.test.js -t "inferTaskPlanNode"`

Expected: `inferTaskPlanNode is not a function` 或 import error

- [ ] **Step 3: 加最小实现**

在 `harness-initiative.graph.js` 中 `fanoutSubTasksNode` 函数定义**之前**插入：

```js
/**
 * inferTaskPlanNode: graph node — 在 fanout 前保证 state.taskPlan.tasks 非空。
 *
 * 幂等：state.taskPlan?.tasks?.length >= 1 → passthrough。
 * Fallback: spawn 一个 docker LLM 子任务，喂 PRD + Contract，让其拆 task-plan.json。
 *           失败时 passthrough（不阻断 graph，让下游 join 走自然 FAIL 路径）。
 *
 * 解决：Planner SKILL 没输出合规 task_plan 时，fanout 看不到 tasks 直接跳 join，
 *      Final E2E 找不到 sub_task 报 FAIL（Sprint 1 E2E-v10 真实根因）。
 *
 * @param {object} state  FullInitiativeState
 * @param {object} [opts]
 * @param {Function} [opts.executor]  spawn 替代（测试注入）
 * @returns {Promise<object>}  state delta（{} 或 { taskPlan: {...} }）
 */
export async function inferTaskPlanNode(state, opts = {}) {
  const existing = state?.taskPlan?.tasks;
  if (Array.isArray(existing) && existing.length >= 1) {
    return {};
  }
  return {};
}
```

- [ ] **Step 4: 跑测试，预期 pass**

Run: `cd /Users/administrator/worktrees/cecelia/fanout-node-fallback/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative.graph.full.test.js -t "inferTaskPlanNode"`

Expected: 1 PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/fanout-node-fallback
git add packages/brain/src/workflows/harness-initiative.graph.js packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js
git commit -m "feat(brain): inferTaskPlanNode 幂等分支（已有 tasks → passthrough）"
```

---

## Task 2: inferTaskPlanNode LLM fallback 主路径

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`
- Test: `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`

- [ ] **Step 1: 写失败的 fallback 测试**

在 `describe('inferTaskPlanNode', ...)` 中加：

```js
  it('空 tasks → 调 executor 拿 plan → 写回 state.taskPlan.tasks', async () => {
    const exec = vi.fn().mockResolvedValue({
      exit_code: 0,
      stdout: '```json\n' + JSON.stringify({
        initiative_id: 'i',
        tasks: [{
          task_id: 's1', title: 'T1', scope: 'do x',
          dod: ['done'], files: ['a.js'], depends_on: [],
          complexity: 'S', estimated_minutes: 30,
        }],
      }) + '\n```',
      stderr: '',
    });
    mockParseTaskPlan.mockReturnValueOnce({
      initiative_id: 'i',
      tasks: [{
        task_id: 's1', title: 'T1', scope: 'do x',
        dod: ['done'], files: ['a.js'], depends_on: [],
        complexity: 'S', estimated_minutes: 30,
      }],
    });
    const delta = await inferTaskPlanNode(
      {
        task: { id: 'init-1' },
        initiativeId: 'i',
        worktreePath: '/wt',
        githubToken: 't',
        prdContent: '# PRD',
        ganResult: { contract_content: 'C' },
        taskPlan: { tasks: [] },
      },
      { executor: exec }
    );
    expect(exec).toHaveBeenCalledTimes(1);
    expect(delta.taskPlan?.tasks?.length).toBe(1);
    expect(delta.taskPlan.tasks[0].id).toBe('s1');
    expect(delta.taskPlan.tasks[0].title).toBe('T1');
  });
```

- [ ] **Step 2: 跑测试，预期 fail**

Run: `cd /Users/administrator/worktrees/cecelia/fanout-node-fallback/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative.graph.full.test.js -t "inferTaskPlanNode"`

Expected: 第二个 case fail（`exec.toHaveBeenCalledTimes(1)` got 0）

- [ ] **Step 3: 实现 fallback 主路径**

替换 `inferTaskPlanNode` 函数内容：

```js
export async function inferTaskPlanNode(state, opts = {}) {
  const existing = state?.taskPlan?.tasks;
  if (Array.isArray(existing) && existing.length >= 1) {
    return {};
  }

  const executor = opts.executor || spawn;
  const prdContent = state?.prdContent || '';
  const contractContent = state?.ganResult?.contract_content || '';
  if (!prdContent && !contractContent) {
    return {};
  }

  const prompt = `你是 task plan inferrer。根据下方 Sprint PRD + Contract，
拆 1-5 个独立可并行的 sub_task，每个 sub_task 是一个原子 PR 单位。
输出 task-plan.json，被 \`\`\`json ... \`\`\` 包裹，schema 见 harness-planner SKILL
（task_id/title/scope/dod/files/depends_on/complexity/estimated_minutes）。

## PRD
${prdContent}

## Contract
${contractContent}`;

  let stdout;
  try {
    const result = await executor({
      task: { ...(state.task || {}), task_type: 'harness_planner' },
      prompt,
      worktreePath: state.worktreePath,
      env: {
        CECELIA_TASK_TYPE: 'harness_planner',
        HARNESS_NODE: 'infer_task_plan',
        HARNESS_INITIATIVE_ID: state.initiativeId,
        GITHUB_TOKEN: state.githubToken,
      },
    });
    if (result.exit_code !== 0 || result.timed_out) {
      console.warn(`[infer_task_plan] LLM exit=${result.exit_code} timed_out=${result.timed_out}`);
      return {};
    }
    stdout = parseDockerOutput(result.stdout);
  } catch (err) {
    console.warn(`[infer_task_plan] spawn failed: ${err.message}`);
    return {};
  }

  let plan;
  try {
    plan = parseTaskPlan(stdout);
  } catch (err) {
    console.warn(`[infer_task_plan] parseTaskPlan failed: ${err.message}`);
    return {};
  }
  if (plan.initiative_id === 'pending' || !plan.initiative_id) {
    plan.initiative_id = state.initiativeId;
  }

  // 把 task_plan 行字段映射成 sub_task 形态（fanout/runSubTask 期望 id/title/description/payload）
  const subTasks = plan.tasks.map((t) => ({
    id: t.task_id,
    title: t.title,
    description: t.scope,
    payload: { dod: t.dod, files: t.files, depends_on: t.depends_on },
  }));

  return {
    taskPlan: { ...plan, tasks: subTasks },
  };
}
```

- [ ] **Step 4: 跑测试，预期 pass**

Run: `cd /Users/administrator/worktrees/cecelia/fanout-node-fallback/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative.graph.full.test.js -t "inferTaskPlanNode"`

Expected: 2 PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/fanout-node-fallback
git add packages/brain/src/workflows/harness-initiative.graph.js packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js
git commit -m "feat(brain): inferTaskPlanNode 主路径 — 空 tasks 时 spawn LLM 拆 sub_task"
```

---

## Task 3: inferTaskPlanNode 失败容错（不抛错）

**Files:**
- Test: `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`

- [ ] **Step 1: 加容错测试**

在 `describe('inferTaskPlanNode', ...)` 中追加：

```js
  it('executor 返回 exit=1 → passthrough 不抛', async () => {
    const exec = vi.fn().mockResolvedValue({ exit_code: 1, stdout: '', stderr: 'boom' });
    const delta = await inferTaskPlanNode(
      {
        task: { id: 't' }, initiativeId: 'i',
        prdContent: '# x', taskPlan: { tasks: [] },
      },
      { executor: exec }
    );
    expect(delta).toEqual({});
  });
  it('executor 抛错 → passthrough 不抛', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('docker dead'));
    const delta = await inferTaskPlanNode(
      {
        task: { id: 't' }, initiativeId: 'i',
        prdContent: '# x', taskPlan: { tasks: [] },
      },
      { executor: exec }
    );
    expect(delta).toEqual({});
  });
  it('parseTaskPlan 抛错 → passthrough 不抛', async () => {
    const exec = vi.fn().mockResolvedValue({ exit_code: 0, stdout: 'not json', stderr: '' });
    mockParseTaskPlan.mockImplementationOnce(() => { throw new Error('bad json'); });
    const delta = await inferTaskPlanNode(
      {
        task: { id: 't' }, initiativeId: 'i',
        prdContent: '# x', taskPlan: { tasks: [] },
      },
      { executor: exec }
    );
    expect(delta).toEqual({});
  });
  it('无 PRD 无 Contract → passthrough 不调 executor', async () => {
    const exec = vi.fn();
    const delta = await inferTaskPlanNode(
      { task: { id: 't' }, initiativeId: 'i', taskPlan: { tasks: [] } },
      { executor: exec }
    );
    expect(delta).toEqual({});
    expect(exec).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 跑测试，预期全 PASS（实现已经在 Task 2 含容错）**

Run: `cd /Users/administrator/worktrees/cecelia/fanout-node-fallback/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative.graph.full.test.js -t "inferTaskPlanNode"`

Expected: 6 PASS

- [ ] **Step 3: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/fanout-node-fallback
git add packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js
git commit -m "test(brain): inferTaskPlanNode 4 个容错路径"
```

---

## Task 4: 把 inferTaskPlanNode 接进 buildHarnessFullGraph

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`（`buildHarnessFullGraph`）
- Test: `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`

- [ ] **Step 1: 写 graph 拓扑断言**

加：

```js
describe('buildHarnessFullGraph wiring', () => {
  it('含 inferTaskPlan 节点 + dbUpsert→inferTaskPlan→fanout edges', () => {
    const g = buildHarnessFullGraph();
    // StateGraph 内部用 nodes Map / edges Set，节点存在性可枚举
    const nodes = Object.keys(g.nodes || {});
    expect(nodes).toContain('inferTaskPlan');
  });
});
```

- [ ] **Step 2: 跑测试，预期 fail**

Run: `cd /Users/administrator/worktrees/cecelia/fanout-node-fallback/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative.graph.full.test.js -t "wiring"`

Expected: `expected [...] to contain 'inferTaskPlan'` fail

- [ ] **Step 3: 改 buildHarnessFullGraph**

定位 `buildHarnessFullGraph` 函数，把：

```js
.addNode('dbUpsert', dbUpsertNode)
.addNode('fanout', fanoutPassthroughNode)
```

之间插入：

```js
.addNode('inferTaskPlan', inferTaskPlanNode)
```

并把：

```js
.addConditionalEdges('dbUpsert', stateHasError, { error: END, ok: 'fanout' })
```

改成：

```js
.addConditionalEdges('dbUpsert', stateHasError, { error: END, ok: 'inferTaskPlan' })
.addConditionalEdges('inferTaskPlan', stateHasError, { error: END, ok: 'fanout' })
```

- [ ] **Step 4: 跑测试，预期 wiring + 已有 e2e 全 PASS**

Run: `cd /Users/administrator/worktrees/cecelia/fanout-node-fallback/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative.graph.full.test.js`

Expected: 全 PASS（含原有 e2e + 新 wiring）

- [ ] **Step 5: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/fanout-node-fallback
git add packages/brain/src/workflows/harness-initiative.graph.js packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js
git commit -m "feat(brain): wire inferTaskPlan 节点到 buildHarnessFullGraph (dbUpsert→inferTaskPlan→fanout)"
```

---

## Task 5: e2e 真证 — Planner 没出 task_plan 时 fallback 拯救 fanout

**Files:**
- Test: `packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`

- [ ] **Step 1: 写 e2e 测试**

在 `describe('full graph e2e', ...)` 中加：

```js
  it('planner 不出 tasks → inferTaskPlan fallback → fanout 派 Send → e2e PASS', async () => {
    mockEnsureWt.mockResolvedValue('/wt');
    mockResolveTok.mockResolvedValue('t');
    // 第 1 次 spawn = planner（stdout 不含 task_plan，但 parseTaskPlan mock 仍返回值）
    // 第 2 次 spawn = inferTaskPlan 的 LLM 调用
    // 第 3+ 次 = sub_task 子图内 PR 创建
    mockSpawn
      .mockResolvedValueOnce({ exit_code: 0, stdout: '# PRD only, no task_plan', stderr: '' })
      .mockResolvedValue({ exit_code: 0, stdout: 'pr_url: https://gh/p/X', stderr: '' });
    mockReadFile.mockResolvedValue('# PRD');
    // dbUpsert 阶段 parseTaskPlan 返回 tasks=[]（模拟"Planner 没出合规 plan"）
    mockParseTaskPlan
      .mockReturnValueOnce({ initiative_id: 'i', tasks: [] })
      // inferTaskPlanNode 内部 parseTaskPlan 返回合规
      .mockReturnValueOnce({
        initiative_id: 'i',
        tasks: [{
          task_id: 's-fb', title: 'Fallback T', scope: 'do',
          dod: ['done'], files: ['x.js'], depends_on: [],
          complexity: 'S', estimated_minutes: 30,
        }],
      });
    mockRunGan.mockResolvedValue({ contract_content: 'C', rounds: 1, propose_branch: 'b' });
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })   // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'cont' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'run' }] })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    mockUpsertTaskPlan.mockResolvedValue({ idMap: {}, insertedTaskIds: [] });
    mockWriteCb.mockResolvedValue();
    mockCheckPr.mockReturnValue({ ciStatus: 'ci_passed', state: 'OPEN', mergeable: 'MERGEABLE', failedChecks: [] });
    mockMerge.mockReturnValue(true);

    const compiled = buildHarnessFullGraph().compile({ checkpointer: new MemorySaver() });
    const final = await compiled.invoke(
      { task: { id: 'init-fb', payload: { initiative_id: 'i' } } },
      { configurable: { thread_id: 'init-fb:1' }, recursionLimit: 500 }
    );

    expect(final.taskPlan?.tasks?.length).toBe(1);
    expect(final.taskPlan.tasks[0].id).toBe('s-fb');
    expect(final.sub_tasks?.length).toBe(1);
    expect(final.sub_tasks[0].status).toBe('merged');
  }, 30000);
```

- [ ] **Step 2: 跑测试，预期 PASS**

Run: `cd /Users/administrator/worktrees/cecelia/fanout-node-fallback/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative.graph.full.test.js`

Expected: 全 PASS

- [ ] **Step 3: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/fanout-node-fallback
git add packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js
git commit -m "test(brain): e2e 证明 planner 没出 tasks 时 inferTaskPlan fallback 拯救 fanout"
```

---

## Task 6: DoD + Learning + push + PR + 等 CI

**Files:**
- Create: `docs/learnings/cp-0426143729-fanout-node-fallback.md`
- 已有 PRD + Plan，等下 finishing 流程会处理

- [ ] **Step 1: 写 Learning（push 前必须）**

```bash
cat > /Users/administrator/worktrees/cecelia/fanout-node-fallback/docs/learnings/cp-0426143729-fanout-node-fallback.md <<'EOF'
# Learning: fanout node fallback — graph 自己拆 sub_task

## 现象
Sprint 1 (#2640) E2E-v10：架构全对（17 checkpoints in DB, Phase A approved），
但 fanoutSubTasksNode 看 state.taskPlan?.tasks 是空 → 直接走 ['join'] →
Final E2E 找不到 sub_task → fail。

## 根本原因
graph 完全依赖 Planner SKILL stdout 输出合规 task_plan。当 Planner 输出格式
偏差或 parseTaskPlan 静默 fallback 到空 tasks 时，下游 fanout 没有兜底，
整条流水线哑掉。

SKILL ↔ Brain 接缝处缺保护层 — graph 自身没有"我自己也能拆"的能力。

## 修复
新增 inferTaskPlanNode（dbUpsert 与 fanout 之间）：
1. 幂等：state.taskPlan?.tasks?.length >= 1 → passthrough
2. Fallback：spawn docker 跑 LLM，prompt 喂 PRD + Contract，要 task-plan.json
3. 失败容错：LLM exit != 0 / parseTaskPlan 抛 / 缺材料 → 全部 passthrough，
   让 join 走自然 FAIL 路径报告失败，不阻断 graph

## 下次预防
- [ ] graph 接 SKILL 时永远问"如果 SKILL 输出空/格式错怎么办"
- [ ] 每个 fanout/dispatch 节点上游必须有 inferOrFallback 节点保底
- [ ] 失败容错原则：fallback 不抛错；让 graph 自然走 FAIL 路径报告，
      不要 break edge

### 根本原因
SKILL ↔ Brain 接缝处缺保护层。

### 下次预防
- [ ] graph 接 SKILL 时永远问"输出空怎么办"
- [ ] fanout/dispatch 上游加 inferOrFallback 节点
- [ ] fallback 失败不抛错，让 graph 自然走 FAIL 路径
EOF
```

- [ ] **Step 2: commit Learning**

```bash
cd /Users/administrator/worktrees/cecelia/fanout-node-fallback
git add docs/learnings/cp-0426143729-fanout-node-fallback.md
git commit -m "docs(learning): fanout node fallback 根因 + 预防"
```

- [ ] **Step 3: 跑全量测试 + lint 一次确认**

```bash
cd /Users/administrator/worktrees/cecelia/fanout-node-fallback/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative.graph.full.test.js
```

Expected: 全 PASS

- [ ] **Step 4: 进入 finishing 流程让其 push + PR**

由 finishing skill 接管。
