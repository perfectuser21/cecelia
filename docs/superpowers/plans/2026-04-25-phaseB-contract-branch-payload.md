# Phase B contract_branch payload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Phase B 入库的每个 sub-task 在 payload 里携带 approved contract 的 git 分支名，使 harness-task-dispatch.js 注入 CONTRACT_BRANCH env 时拿到非空值，修复 Generator ABORT。

**Architecture:** GAN proposer 节点解析 stdout 提取 propose_branch → GanContractState 累积 → runGanContractGraph 返回 → harness-initiative.graph 把 branch 写到 initiative_contracts.branch + 透传给 upsertTaskPlan → upsertTaskPlan 写入每个 sub-task 的 payload.contract_branch。

**Tech Stack:** Node.js, LangGraph (StateGraph + Annotation), PostgreSQL (jsonb payload), vitest。

---

## File Structure

- Create: `packages/brain/migrations/246_add_branch_to_initiative_contracts.sql`
- Create: `packages/brain/src/__tests__/harness-dag-contract-branch.test.js`
- Modify: `packages/brain/src/harness-dag.js`（upsertTaskPlan 接受 contractBranch）
- Modify: `packages/brain/src/workflows/harness-gan.graph.js`（GanContractState + proposer + return）
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`（两个 upsertTaskPlan 调用点 + initiative_contracts INSERT 增 branch）

---

### Task 1: Migration — initiative_contracts.branch 列

**Files:**
- Create: `packages/brain/migrations/246_add_branch_to_initiative_contracts.sql`

- [ ] **Step 1: 写 migration**

```sql
-- Migration 246: initiative_contracts 表新增 branch 列
-- 用途：Phase A GAN 批准合同所在的 git branch (e.g. cp-harness-propose-r3-xxxxxxxx)
-- 漏点：Phase B 入库 sub-task 时漏写 payload.contract_branch → harness-task-dispatch.js
--      注入 CONTRACT_BRANCH env 为空 → Generator ABORT。本列是 Initiative 级 SSOT。
-- 不加 NOT NULL（历史行已有），不加 DEFAULT（旧记录保持 NULL）。

ALTER TABLE initiative_contracts
  ADD COLUMN IF NOT EXISTS branch TEXT;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('246', 'Harness v6: initiative_contracts.branch 列（approved contract 的 propose branch）', NOW())
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 2: 提交**

```bash
git add packages/brain/migrations/246_add_branch_to_initiative_contracts.sql
git commit -m "feat(brain): add initiative_contracts.branch column (migration 246)"
```

---

### Task 2: 单元测试 — upsertTaskPlan 写入 contract_branch（先红）

**Files:**
- Create: `packages/brain/src/__tests__/harness-dag-contract-branch.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
/**
 * 回归测试：upsertTaskPlan 接收 contractBranch 参数时，
 * 每个 sub-task 的 payload.contract_branch 必须等于该值。
 *
 * 漏点：Phase B 入库 sub-task 时未写 contract_branch →
 *      harness-task-dispatch.js 注入空 CONTRACT_BRANCH → Generator ABORT。
 *      bb245cb4 / 576f6cf4 两次 Initiative 实证。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import { upsertTaskPlan } from '../harness-dag.js';

function makeMockClient() {
  let idCounter = 0;
  const queries = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/INSERT INTO tasks/.test(sql)) {
        idCounter += 1;
        return { rows: [{ id: `uuid-${idCounter}` }] };
      }
      return { rows: [] };
    }),
    _queries: queries,
  };
  return client;
}

const samplePlan = {
  initiative_id: 'init-1',
  tasks: [
    { task_id: 'ws1', title: 'WS1', scope: 'do A', complexity: 'M', estimated_minutes: 30, files: [], dod: [], depends_on: [] },
    { task_id: 'ws2', title: 'WS2', scope: 'do B', complexity: 'M', estimated_minutes: 30, files: [], dod: [], depends_on: ['ws1'] },
    { task_id: 'ws3', title: 'WS3', scope: 'do C', complexity: 'M', estimated_minutes: 30, files: [], dod: [], depends_on: ['ws1'] },
    { task_id: 'ws4', title: 'WS4', scope: 'do D', complexity: 'M', estimated_minutes: 30, files: [], dod: [], depends_on: ['ws2'] },
  ],
};

describe('upsertTaskPlan — payload.contract_branch（修 Generator ABORT 最后一跳）', () => {
  let client;
  beforeEach(() => { client = makeMockClient(); });

  it('contractBranch 非空 → 每个 sub-task payload 含 contract_branch', async () => {
    const branch = 'cp-harness-propose-r3-abcd1234';
    await upsertTaskPlan({
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-task',
      taskPlan: samplePlan,
      client,
      contractBranch: branch,
    });
    const taskInserts = client._queries.filter((q) => /INSERT INTO tasks/.test(q.sql));
    expect(taskInserts.length).toBe(4);
    for (const q of taskInserts) {
      const payload = JSON.parse(q.params[2]);
      expect(payload.contract_branch).toBe(branch);
    }
  });

  it('contractBranch 缺省 → payload 不含 contract_branch（向后兼容）', async () => {
    await upsertTaskPlan({
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-task',
      taskPlan: samplePlan,
      client,
    });
    const taskInserts = client._queries.filter((q) => /INSERT INTO tasks/.test(q.sql));
    for (const q of taskInserts) {
      const payload = JSON.parse(q.params[2]);
      expect(payload.contract_branch).toBeUndefined();
    }
  });

  it('contractBranch 为 null → payload 不含 contract_branch', async () => {
    await upsertTaskPlan({
      initiativeId: 'init-1',
      initiativeTaskId: 'parent-task',
      taskPlan: samplePlan,
      client,
      contractBranch: null,
    });
    const taskInserts = client._queries.filter((q) => /INSERT INTO tasks/.test(q.sql));
    for (const q of taskInserts) {
      const payload = JSON.parse(q.params[2]);
      expect(payload.contract_branch).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: 运行测试确认红**

```bash
cd packages/brain && npx vitest run src/__tests__/harness-dag-contract-branch.test.js --reporter=verbose
```

Expected: 第一个 `contractBranch 非空` 用例 FAIL（payload 缺 contract_branch key），后两个可能 PASS（旧行为已不写）

---

### Task 3: 实现 — upsertTaskPlan 接受 contractBranch

**Files:**
- Modify: `packages/brain/src/harness-dag.js:238-279`

- [ ] **Step 1: 改 upsertTaskPlan 签名 + payload**

将原来的：

```javascript
export async function upsertTaskPlan({ initiativeId, initiativeTaskId, taskPlan, client }) {
  if (!client) throw new Error('upsertTaskPlan: client required');
  if (!initiativeTaskId) throw new Error('upsertTaskPlan: initiativeTaskId required');
  if (!taskPlan || !Array.isArray(taskPlan.tasks)) {
    throw new Error('upsertTaskPlan: taskPlan.tasks required');
  }

  const idMap = {}; // logical -> uuid
  const insertedTaskIds = [];

  const order = topologicalOrder(taskPlan.tasks);

  for (const logicalId of order) {
    const t = taskPlan.tasks.find((x) => x.task_id === logicalId);

    // 默认 priority='P0'：harness_task 是当前 active Initiative 的子工作，
    // 而非背景 P2 任务，不应被 alertness pause_low_priority 自动 pause。
    // Initiative 本身通常是 P0，子任务继承即可（见 alertness/escalation.js
    // 的 pauseLowPriorityTasks 白名单，二者形成双层保护）。
    const taskInsert = await client.query(
      `INSERT INTO tasks (task_type, title, description, status, priority, payload)
       VALUES ('harness_task', $1, $2, 'queued', 'P0', $3::jsonb)
       RETURNING id`,
      [
        t.title,
        t.scope,
        JSON.stringify({
          logical_task_id: t.task_id,
          initiative_id: initiativeId,
          parent_task_id: initiativeTaskId,
          complexity: t.complexity,
          estimated_minutes: t.estimated_minutes,
          files: t.files,
          dod: t.dod,
          depends_on_logical: t.depends_on || [],
        }),
      ]
    );
```

替换为（注意新增 `contractBranch = null` 参数 + 条件写入 payload.contract_branch）：

```javascript
export async function upsertTaskPlan({
  initiativeId,
  initiativeTaskId,
  taskPlan,
  client,
  contractBranch = null,
}) {
  if (!client) throw new Error('upsertTaskPlan: client required');
  if (!initiativeTaskId) throw new Error('upsertTaskPlan: initiativeTaskId required');
  if (!taskPlan || !Array.isArray(taskPlan.tasks)) {
    throw new Error('upsertTaskPlan: taskPlan.tasks required');
  }

  const idMap = {}; // logical -> uuid
  const insertedTaskIds = [];

  const order = topologicalOrder(taskPlan.tasks);

  for (const logicalId of order) {
    const t = taskPlan.tasks.find((x) => x.task_id === logicalId);

    // 默认 priority='P0'：harness_task 是当前 active Initiative 的子工作，
    // 而非背景 P2 任务，不应被 alertness pause_low_priority 自动 pause。
    // Initiative 本身通常是 P0，子任务继承即可（见 alertness/escalation.js
    // 的 pauseLowPriorityTasks 白名单，二者形成双层保护）。
    //
    // contract_branch（v6 P0-final）：approved contract 的 propose branch。
    // harness-task-dispatch.js:67 用此字段注入 CONTRACT_BRANCH env，
    // 缺失时 Generator 容器拿到空串 → ABORT（实证 bb245cb4/576f6cf4）。
    // 仅当 contractBranch 非空时才写 payload，保持向后兼容（老调用方不传）。
    const payload = {
      logical_task_id: t.task_id,
      initiative_id: initiativeId,
      parent_task_id: initiativeTaskId,
      complexity: t.complexity,
      estimated_minutes: t.estimated_minutes,
      files: t.files,
      dod: t.dod,
      depends_on_logical: t.depends_on || [],
    };
    if (contractBranch) {
      payload.contract_branch = contractBranch;
    }

    const taskInsert = await client.query(
      `INSERT INTO tasks (task_type, title, description, status, priority, payload)
       VALUES ('harness_task', $1, $2, 'queued', 'P0', $3::jsonb)
       RETURNING id`,
      [t.title, t.scope, JSON.stringify(payload)]
    );
```

- [ ] **Step 2: 同时更新 JSDoc**

将函数顶部的 JSDoc `@param` 块（`packages/brain/src/harness-dag.js:231-237`）增加：

```javascript
 * @param {string} [p.contractBranch]   approved contract 的 propose branch（写入每个
 *                                       sub-task 的 payload.contract_branch；不传则不写）
```

- [ ] **Step 3: 运行测试确认绿**

```bash
cd packages/brain && npx vitest run src/__tests__/harness-dag-contract-branch.test.js --reporter=verbose
```

Expected: 3 用例全 PASS

- [ ] **Step 4: 跑 priority 回归测试确保未破坏**

```bash
cd packages/brain && npx vitest run src/__tests__/harness-dag-upsert-priority.test.js --reporter=verbose
```

Expected: 全 PASS（contractBranch 默认 null 不影响 priority 行为）

- [ ] **Step 5: 提交**

```bash
git add packages/brain/src/harness-dag.js packages/brain/src/__tests__/harness-dag-contract-branch.test.js
git commit -m "feat(brain): upsertTaskPlan 接收 contractBranch 写入 payload.contract_branch"
```

---

### Task 4: GAN graph state 扩展 — 捕获 propose_branch

**Files:**
- Modify: `packages/brain/src/workflows/harness-gan.graph.js:236-302`

- [ ] **Step 1: 写测试 — proposer 解析 propose_branch**

在 `packages/brain/src/__tests__/harness-gan-graph.test.js` 顶部已有 makeOpts 等 helper。在文件 `describe('runGanContractGraph', ...)` 块内追加用例：

```javascript
  it('proposer stdout 含 propose_branch → finalState 透传到返回值', async () => {
    let round = 0;
    const executor = vi.fn(async ({ task: { task_type } }) => {
      if (task_type === 'harness_contract_propose') {
        round += 1;
        return {
          exit_code: 0,
          stdout: `propose stuff\n{"verdict": "PROPOSED", "propose_branch": "cp-harness-propose-r${round}-deadbeef", "workstream_count": 4, "test_files_count": 4}\n`,
          cost_usd: 0.1,
        };
      }
      // reviewer 直接 APPROVED
      return {
        exit_code: 0,
        stdout: '```json\n{"dod_machineability":8,"scope_match_prd":8,"test_is_red":8,"internal_consistency":8,"risk_registered":8}\n```\nVERDICT: APPROVED',
        cost_usd: 0.1,
      };
    });
    const { runGanContractGraph } = await import('../../workflows/harness-gan.graph.js');
    const res = await runGanContractGraph({
      taskId: 't1',
      initiativeId: 'init-1',
      sprintDir: 'sprints',
      prdContent: 'PRD',
      executor,
      worktreePath: '/tmp/wt',
      githubToken: 'gh_xxx',
      readContractFile: async () => 'contract',
    });
    expect(res.propose_branch).toBe('cp-harness-propose-r1-deadbeef');
  });
```

注：`harness-gan-graph.test.js` 实际路径是 `packages/brain/src/__tests__/harness-gan-graph.test.js`，import 走 `../../workflows/harness-gan.graph.js`（参见现有第 408 行：`await import('../harness-gan-graph.js')` 是 shim — 我们直接 import workflow 路径以测真实实现）。

- [ ] **Step 2: 在 GanContractState Annotation 加 proposeBranch 字段**

在 `packages/brain/src/workflows/harness-gan.graph.js` 的 `GanContractState` 块（约第 238-248 行）末尾、`forcedApproval` 之后增加：

```javascript
  // proposeBranch: GAN proposer 每轮 push 到独立分支（cp-harness-propose-r{N}-{shortTask}）。
  // Reviewer APPROVED 后此值即 approved contract 的 git branch — Phase B 入库 sub-task
  // 时透传到 payload.contract_branch，供 harness-task-dispatch.js 注入 CONTRACT_BRANCH env。
  // 漏写会导致 Generator ABORT（v6 P0-final 修复点）。
  proposeBranch: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
```

- [ ] **Step 3: 在 proposer 节点解析 stdout 写 proposeBranch**

将原来（约第 273-303 行）：

```javascript
  async function proposer(state) {
    const nextRound = (state.round || 0) + 1;
    const result = await executor({
      task: { id: taskId, task_type: 'harness_contract_propose' },
      prompt: buildProposerPrompt(state.prdContent, state.feedback, nextRound),
      worktreePath,
      timeoutMs: 1800000,
      env: {
        // CECELIA_CREDENTIALS 不传 → executeInDocker middleware 走 selectBestAccount
        CECELIA_TASK_TYPE: 'harness_contract_propose',
        HARNESS_NODE: 'proposer',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_PROPOSE_ROUND: String(nextRound),
        TASK_ID: taskId,
        SPRINT_DIR: sprintDir,
        PLANNER_BRANCH: 'main',
        PROPOSE_ROUND: String(nextRound),
        GITHUB_TOKEN: githubToken,
      },
    });
    if (!result || result.exit_code !== 0) {
      throw new Error(`proposer_failed: exit=${result?.exit_code} stderr=${(result?.stderr || '').slice(0, 300)}`);
    }
    const contractContent = await readContractFile(worktreePath, sprintDir);
    return {
      round: nextRound,
      costUsd: (state.costUsd || 0) + Number(result.cost_usd || 0),
      contractContent,
    };
  }
```

替换为：

```javascript
  async function proposer(state) {
    const nextRound = (state.round || 0) + 1;
    const result = await executor({
      task: { id: taskId, task_type: 'harness_contract_propose' },
      prompt: buildProposerPrompt(state.prdContent, state.feedback, nextRound),
      worktreePath,
      timeoutMs: 1800000,
      env: {
        // CECELIA_CREDENTIALS 不传 → executeInDocker middleware 走 selectBestAccount
        CECELIA_TASK_TYPE: 'harness_contract_propose',
        HARNESS_NODE: 'proposer',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_PROPOSE_ROUND: String(nextRound),
        TASK_ID: taskId,
        SPRINT_DIR: sprintDir,
        PLANNER_BRANCH: 'main',
        PROPOSE_ROUND: String(nextRound),
        GITHUB_TOKEN: githubToken,
      },
    });
    if (!result || result.exit_code !== 0) {
      throw new Error(`proposer_failed: exit=${result?.exit_code} stderr=${(result?.stderr || '').slice(0, 300)}`);
    }
    const contractContent = await readContractFile(worktreePath, sprintDir);
    // 解析 stdout 中的 propose_branch（proposer SKILL Step 3 输出 JSON 字面量）
    // 即使本轮被打回，先把 branch 存下；后续轮次会覆写成新 branch（reducer 取最新）。
    // APPROVED 终态时即 approved contract 的 git branch。
    const proposeBranch = extractProposeBranch(result.stdout);
    return {
      round: nextRound,
      costUsd: (state.costUsd || 0) + Number(result.cost_usd || 0),
      contractContent,
      ...(proposeBranch ? { proposeBranch } : {}),
    };
  }
```

- [ ] **Step 4: 在 harness-gan.graph.js 顶部辅助函数区加 extractProposeBranch**

在文件 `extractFeedback` 函数（约第 111 行）之后追加：

```javascript
// 从 proposer 的 stdout 提取 propose_branch（SKILL Step 3 输出 JSON 字面量）。
// 找不到返回 null（兜底，不抛错）— upstream 需自行处理。
const PROPOSE_BRANCH_RE = /"propose_branch"\s*:\s*"([^"]+)"/;
export function extractProposeBranch(stdout) {
  const m = String(stdout || '').match(PROPOSE_BRANCH_RE);
  return m ? m[1] : null;
}
```

- [ ] **Step 5: runGanContractGraph 返回值加 propose_branch**

在 `runGanContractGraph` 函数（约第 405-438 行）末尾的 return 语句改成：

```javascript
  return {
    contract_content: finalState.contractContent,
    rounds: finalState.round,
    cost_usd: finalState.costUsd,
    propose_branch: finalState.proposeBranch || null,
  };
```

- [ ] **Step 6: 运行测试确认绿**

```bash
cd packages/brain && npx vitest run src/__tests__/harness-gan-graph.test.js --reporter=verbose
```

Expected: 全 PASS（包括新加的 `propose_branch` 用例）

- [ ] **Step 7: 提交**

```bash
git add packages/brain/src/workflows/harness-gan.graph.js packages/brain/src/__tests__/harness-gan-graph.test.js
git commit -m "feat(brain): GAN graph 透传 propose_branch（GanContractState + proposer + return）"
```

---

### Task 5: harness-initiative.graph.js — 透传 contractBranch + 写 initiative_contracts.branch

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:190-235`（runInitiative 旧路径）
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:669-716`（dbUpsertNode 新路径）

- [ ] **Step 1: 改 runInitiative 的 upsertTaskPlan 调用 + INSERT initiative_contracts**

将原来（约 195-212 行）：

```javascript
    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      initiativeId,
      initiativeTaskId: task.id,
      taskPlan,
      client,
    });

    // 建 initiative_contracts（approved 版，GAN 循环已产出 contract_content）
    const contractInsert = await client.query(
      `INSERT INTO initiative_contracts (
         initiative_id, version, status,
         prd_content, contract_content, review_rounds,
         budget_cap_usd, timeout_sec, approved_at
       )
       VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, NOW())
       RETURNING id`,
      [initiativeId, plannerOutput, ganResult.contract_content, ganResult.rounds, budgetUsd, timeoutSec]
    );
```

替换为：

```javascript
    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      initiativeId,
      initiativeTaskId: task.id,
      taskPlan,
      client,
      contractBranch: ganResult.propose_branch || null,
    });

    // 建 initiative_contracts（approved 版，GAN 循环已产出 contract_content）
    // branch 列（migration 246）= GAN propose_branch，Phase B 用此分支创 PR。
    const contractInsert = await client.query(
      `INSERT INTO initiative_contracts (
         initiative_id, version, status,
         prd_content, contract_content, review_rounds,
         budget_cap_usd, timeout_sec, branch, approved_at
       )
       VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id`,
      [initiativeId, plannerOutput, ganResult.contract_content, ganResult.rounds, budgetUsd, timeoutSec, ganResult.propose_branch || null]
    );
```

- [ ] **Step 2: 改 dbUpsertNode 的 upsertTaskPlan 调用 + INSERT initiative_contracts**

将原来（约 677-692 行）：

```javascript
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
```

替换为：

```javascript
    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      initiativeId: state.initiativeId,
      initiativeTaskId: state.task.id,
      taskPlan: state.taskPlan,
      client,
      contractBranch: state.ganResult.propose_branch || null,
    });
    const contractInsert = await client.query(
      `INSERT INTO initiative_contracts (
         initiative_id, version, status,
         prd_content, contract_content, review_rounds,
         budget_cap_usd, timeout_sec, branch, approved_at
       )
       VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id`,
      [state.initiativeId, state.plannerOutput, state.ganResult.contract_content, state.ganResult.rounds, budgetUsd, timeoutSec, state.ganResult.propose_branch || null]
    );
```

- [ ] **Step 3: 运行 graph 单元测试确认未破坏**

```bash
cd packages/brain && npx vitest run src/workflows/__tests__/harness-initiative-graph.test.js --reporter=verbose
```

Expected: 全 PASS（mock 的 ganResult 没 propose_branch 也走 || null 兜底）

- [ ] **Step 4: 跑 integration test**

```bash
cd packages/brain && npx vitest run src/__tests__/integration/harness-initiative-runner.integration.test.js --reporter=verbose
```

Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "feat(brain): Phase B 入库 sub-task 时透传 contract_branch"
```

---

### Task 6: 整体回归 + Learning 文档

**Files:**
- Create: `docs/learnings/cp-0425214048-phaseB-contract-branch-payload.md`

- [ ] **Step 1: 跑全 brain 测试**

```bash
cd packages/brain && npx vitest run --reporter=verbose 2>&1 | tail -50
```

Expected: 失败数为 0；新增的 4 个 contract_branch 用例全 PASS。

- [ ] **Step 2: facts-check 校验**

```bash
cd /Users/administrator/worktrees/cecelia/phaseB-contract-branch-payload && node scripts/facts-check.mjs
```

Expected: PASS

- [ ] **Step 3: 写 Learning**

```markdown
# Learning: Phase B sub-task 入库漏写 contract_branch（v6 P0-final）

> 分支: cp-0425214048-phaseB-contract-branch-payload
> Brain task: 1d37b05f-f367-4c92-876d-8245db7ebdd8
> 实证: bb245cb4 / 576f6cf4 两次 Initiative，所有 Generator 容器 ABORT

## 现象

P1-D 修了 harness-task-dispatch.js 注入 CONTRACT_BRANCH env，但运行时 env 仍为空字符串 → Generator 容器读到空 CONTRACT_BRANCH → ABORT。

## 根本原因

注入代码 `env.CONTRACT_BRANCH = payload.contract_branch || ''` 依赖 `tasks.payload.contract_branch`，但 `harness-dag.js::upsertTaskPlan` 在 Phase B 入库 4-5 个 sub-task 时压根没在 payload 里写这个字段。

更深层：GAN graph (`harness-gan.graph.js`) 自身从未捕获 proposer 输出的 propose_branch — 信息在 stdout 里被丢弃，从未流到 Phase B。

链路漏点：
1. proposer 节点不解析 stdout 的 propose_branch
2. GanContractState 无对应字段
3. runGanContractGraph 返回值无 propose_branch
4. harness-initiative.graph.js 自然没法透传给 upsertTaskPlan
5. upsertTaskPlan 也不接受这个参数

## 下次预防

- [ ] 任何"env 注入靠 payload 字段"的设计，必须从 payload 来源向上追溯到信息源头，确保链路上每跳都显式持久化
- [ ] GAN proposer SKILL 在 stdout 输出的 JSON 字段（propose_branch / review_branch）必须在 graph state 里有对应 Annotation
- [ ] initiative_contracts 表加 branch 列后，未来排查 Generator ABORT 可直接 `psql ... SELECT branch FROM initiative_contracts WHERE initiative_id=...` 一行定位
- [ ] feat(brain) PR 审查清单：若改 dispatch / spawn 路径的 env 注入，必须验证 payload 字段写入点存在
```

- [ ] **Step 4: 跑 DoD 映射检查**

```bash
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

Expected: PASS

- [ ] **Step 5: 跑 PRD/DoD branch-protect**

```bash
bash packages/engine/scripts/branch-protect.sh
```

Expected: PASS

- [ ] **Step 6: 提交 Learning**

```bash
git add docs/learnings/cp-0425214048-phaseB-contract-branch-payload.md
git commit -m "docs(learning): Phase B sub-task 漏写 contract_branch 的链路追溯"
```

---

## Self-Review

**Spec coverage:**
- ✅ Migration 246 → Task 1
- ✅ GAN proposer 解析 propose_branch + state 持久化 → Task 4
- ✅ runGanContractGraph 返回 propose_branch → Task 4
- ✅ upsertTaskPlan 接收 contractBranch → Task 3
- ✅ harness-initiative.graph.js 两个调用点透传 → Task 5
- ✅ initiative_contracts.branch 写入 → Task 5
- ✅ 单元测试 4 sub-task payload.contract_branch === branch → Task 2/3
- ✅ 向后兼容（不传 contractBranch 不写 payload） → Task 2/3

**Placeholder scan:** 无 TBD/TODO/"以此类推"。所有代码块均完整。

**Type consistency:**
- 入参名 `contractBranch` 全程一致
- payload key `contract_branch` 全程一致
- ganResult 字段 `propose_branch` 全程一致
- state 字段 `proposeBranch` (camelCase) 与外部 `propose_branch` (snake_case) 区分清晰
