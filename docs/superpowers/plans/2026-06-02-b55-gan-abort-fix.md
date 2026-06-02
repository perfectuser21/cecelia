# B55 GAN Abort 传播 + initiative_runs 早建 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复两个可见性 bug — GAN abort 后 tasks.status 自动变 failed（OPEN-5），initiative_runs 在 prepNode 就创建（OPEN-6），失败 run 进入监控。

**Architecture:** 在 `harness-initiative.graph.js` 的 `prepInitiativeNode` 早期 INSERT initiative_runs，把 run_id 存入 LangGraph state；GAN abort 时 catch 块同时 UPDATE tasks + initiative_runs；`dbUpsertNode` 把现有 INSERT 改为 UPDATE（用 state.initiative_run_id）。

**Tech Stack:** Node.js ESM, @langchain/langgraph Annotation state, pg pool（直接 DB 查询，不走 HTTP），vitest

---

### Task 1：State schema 加 `initiative_run_id` 字段

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:85-99`（InitiativeState）
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:499-520`（FullInitiativeState）
- Test: `packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js`（新建）

- [ ] **Step 1: 写 failing test**

新建 `packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InitiativeState } from '../harness-initiative.graph.js';

describe('InitiativeState schema', () => {
  it('有 initiative_run_id 字段，默认 null', () => {
    const defaults = {};
    for (const [k, ann] of Object.entries(InitiativeState.spec)) {
      defaults[k] = ann.default?.();
    }
    expect('initiative_run_id' in defaults).toBe(true);
    expect(defaults.initiative_run_id).toBeNull();
  });
});
```

- [ ] **Step 2: 运行 test 确认 FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/b55-gan-abort-fix
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js 2>&1 | tail -20
```

Expected: FAIL — `initiative_run_id` is not in `InitiativeState.spec`

- [ ] **Step 3: 在 `InitiativeState`（line ~85）和 `FullInitiativeState`（line ~499）加字段**

在 `InitiativeState` 的 `error` 行后加：

```js
  initiative_run_id: Annotation({ reducer: (_o, n) => n, default: () => null }),
```

在 `FullInitiativeState` 同样位置加相同行。

- [ ] **Step 4: 运行 test 确认 PASS**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/b55-gan-abort-fix
git add packages/brain/src/workflows/harness-initiative.graph.js \
        packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js
git commit -m "test(brain): B55 failing test — initiative_run_id in state schema"
```

---

### Task 2：prepInitiativeNode — INSERT initiative_runs，返回 run_id（OPEN-6）

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:103-119`（prepInitiativeNode）
- Test: `packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js`（续写）

- [ ] **Step 1: 加 failing test**

在 `harness-initiative-abort.test.js` 追加：

```js
import { prepInitiativeNode } from '../harness-initiative.graph.js';

describe('prepInitiativeNode — OPEN-6 initiative_runs 早建', () => {
  it('成功时 INSERT initiative_runs 并返回 initiative_run_id', async () => {
    const mockRunId = 'test-run-uuid-1234';
    const mockPool = {
      connect: vi.fn().mockResolvedValue(null),
      query: vi.fn().mockResolvedValue({ rows: [{ id: mockRunId }] }),
    };

    // mock ensureHarnessWorktree + resolveGitHubToken
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'prep-test-'));
    try {
      const state = {
        task: { id: 'task-uuid', payload: { base_repo: null, journey_id: 'j1' } },
      };
      const result = await prepInitiativeNode(state, {
        pool: mockPool,
        ensureWorktree: vi.fn().mockResolvedValue(tmp),
        resolveToken: vi.fn().mockResolvedValue('fake-token'),
      });
      expect(result.initiative_run_id).toBeTruthy();
      expect(result.worktreePath).toBe(tmp);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行 test 确认 FAIL**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js 2>&1 | tail -20
```

Expected: FAIL — prepInitiativeNode 没接受 ensureWorktree/resolveToken opts，没有 INSERT，没返回 initiative_run_id

- [ ] **Step 3: 修改 prepInitiativeNode 接受 opts 并 INSERT**

把 `prepInitiativeNode`（line ~103-119）改成：

```js
export async function prepInitiativeNode(state, opts = {}) {
  if (state.worktreePath) return { worktreePath: state.worktreePath };
  try {
    const initiativeId = state.task?.id;
    const baseRepo = state.task?.payload?.base_repo || undefined;
    if (!state.task?.payload?.journey_id) {
      console.warn(`[prep] journey_id missing in task.payload — initiative_run.journey_id will be null (task.id=${state.task?.id})`);
    }
    const ensureWorktreeFn = opts.ensureWorktree || ensureHarnessWorktree;
    const resolveTokenFn = opts.resolveToken || resolveGitHubToken;
    const dbPool = opts.pool || pool;

    const worktreePath = await ensureWorktreeFn({ taskId: state.task.id, initiativeId, baseRepo });
    const githubToken = await resolveTokenFn();

    const journeyType = state.task?.payload?.journey_type || 'autonomous';
    const journeyId = state.task?.payload?.journey_id || null;
    const runInsert = await dbPool.query(
      `INSERT INTO initiative_runs (initiative_id, phase, journey_type, journey_id)
       VALUES ($1::uuid, 'A_contract', $2, $3)
       RETURNING id`,
      [initiativeId, journeyType, journeyId],
    );
    const initiative_run_id = runInsert.rows[0]?.id || null;

    return { worktreePath, githubToken, initiativeId, initiative_run_id };
  } catch (err) {
    return { error: { node: 'prep', message: err.message } };
  }
}
```

- [ ] **Step 4: 运行 test 确认 PASS**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit（failing test 先于实现，均在此 commit）**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js \
        packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js
git commit -m "feat(brain): B55 OPEN-6 — prepInitiativeNode 早建 initiative_runs(phase=A_contract)"
```

---

### Task 3：runGanLoopNode catch — 传播 tasks.status=failed + initiative_runs.phase=failed（OPEN-5+6）

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:337-370`（runGanLoopNode）
- Test: `packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js`（续写）

- [ ] **Step 1: 加 failing test**

追加到 `harness-initiative-abort.test.js`：

```js
import { runGanLoopNode } from '../harness-initiative.graph.js';

describe('runGanLoopNode — OPEN-5+6 GAN abort 传播', () => {
  it('GAN 抛错 → tasks.status=failed + initiative_runs.phase=failed', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const state = {
      task: { id: 'task-id', payload: { sprint_dir: 'sprints', budget_usd: 1 } },
      initiativeId: 'task-id',
      initiative_run_id: 'run-uuid',
      prdContent: 'test',
      worktreePath: '/tmp/test',
      githubToken: 'fake',
      plannerOutput: 'output',
    };

    const result = await runGanLoopNode(state, {
      pool: mockPool,
      runGan: vi.fn().mockRejectedValue(new Error('gan_abort: test')),
      checkpointer: { get: vi.fn(), put: vi.fn(), list: vi.fn() },
    });

    // error 返回
    expect(result.error).toBeTruthy();
    expect(result.error.node).toBe('gan');

    // tasks UPDATE 被调用
    const taskUpdate = mockPool.query.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE tasks') && c[0].includes('failed')
    );
    expect(taskUpdate).toBeTruthy();

    // initiative_runs UPDATE 被调用
    const runUpdate = mockPool.query.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE initiative_runs') && c[0].includes('failed')
    );
    expect(runUpdate).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行 test 确认 FAIL**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js 2>&1 | tail -20
```

Expected: FAIL — runGanLoopNode 没接受 runGan opts，catch 没 UPDATE tasks/initiative_runs

- [ ] **Step 3: 修改 runGanLoopNode catch**

把 `runGanLoopNode`（line ~330-370）catch 块改为：

```js
export async function runGanLoopNode(state, opts = {}) {
  const dbPool = opts.pool || pool;
  await emitLangGraphStep(dbPool, state.initiativeId, { node: 'proposer', status: 'started' });
  const sprintDir = state.sprintDir || state.task?.payload?.sprint_dir || 'sprints';
  const budgetUsd = state.task?.payload?.budget_usd || DEFAULT_BUDGET_USD;
  const checkpointer = opts.checkpointer || await getPgCheckpointer();
  const runGanFn = opts.runGan || runGanContractGraph;
  try {
    const ganResult = await runGanFn({
      taskId: state.task.id,
      initiativeId: state.initiativeId,
      sprintDir,
      prdContent: state.prdContent,
      executor: opts.executor || spawn,
      worktreePath: state.worktreePath,
      githubToken: state.githubToken,
      plannerOutput: state.plannerOutput || '',
      budgetCapUsd: budgetUsd,
      checkpointer,
      baseRepo: state.task?.payload?.base_repo || undefined,
    });
    await emitLangGraphStep(dbPool, state.initiativeId, {
      node: 'reviewer',
      review_round: ganResult.rounds || 1,
      review_verdict: ganResult.verdict || null,
    });
    return { ganResult };
  } catch (err) {
    const msg = err.message || String(err);
    // OPEN-5: 传播 tasks.status=failed
    await dbPool.query(
      `UPDATE tasks SET status='failed', result=$1::jsonb, updated_at=NOW() WHERE id=$2::uuid`,
      [JSON.stringify({ error: msg }), state.task.id],
    ).catch(e => console.warn('[runGanLoopNode] tasks UPDATE failed (non-blocking):', e.message));
    // OPEN-6: 传播 initiative_runs.phase=failed
    if (state.initiative_run_id) {
      await dbPool.query(
        `UPDATE initiative_runs SET phase='failed', failure_reason=$1, completed_at=NOW(), updated_at=NOW() WHERE id=$2::uuid`,
        [msg.slice(0, 500), state.initiative_run_id],
      ).catch(e => console.warn('[runGanLoopNode] initiative_runs UPDATE failed (non-blocking):', e.message));
    }
    return { error: { node: 'gan', message: msg } };
  }
}
```

- [ ] **Step 4: 运行 test 确认 PASS**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js \
        packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js
git commit -m "fix(brain): B55 OPEN-5+6 — GAN abort 传播 tasks.status=failed + initiative_runs.phase=failed"
```

---

### Task 4：dbUpsertNode — initiative_runs INSERT 改 UPDATE（OPEN-6 收尾）

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:425-437`（dbUpsertNode 的 initiative_runs INSERT）

- [ ] **Step 1: 改 initiative_runs INSERT 为 UPDATE**

找到 `dbUpsertNode` 里的 initiative_runs INSERT（line ~425-437），把：

```js
const runInsert = await client.query(
  `INSERT INTO initiative_runs (
     initiative_id, contract_id, phase,
     deadline_at, journey_type, journey_id
   )
   VALUES ($1::uuid, $2::uuid, 'B_task_loop',
     NOW() + ($3 || ' seconds')::interval,
     $4, $5
   )
   RETURNING id`,
  [state.initiativeId, contractId, String(timeoutSec), journeyType, journeyId]
);
const runId = runInsert.rows[0].id;
```

改为（UPDATE 已有 prep 建的记录，ON CONFLICT 作 INSERT fallback 兜底）：

```js
// B55 OPEN-6: prep 节点已建 initiative_runs，这里只更新 phase/contract_id/deadline
// 若 initiative_run_id 缺失（旧版 resume）则 fallback 到 INSERT
let runId = state.initiative_run_id;
if (runId) {
  await client.query(
    `UPDATE initiative_runs
       SET phase='B_task_loop', contract_id=$2::uuid,
           deadline_at=NOW() + ($3 || ' seconds')::interval,
           updated_at=NOW()
     WHERE id=$1::uuid`,
    [runId, contractId, String(timeoutSec)],
  );
} else {
  const runInsert = await client.query(
    `INSERT INTO initiative_runs (
       initiative_id, contract_id, phase,
       deadline_at, journey_type, journey_id
     )
     VALUES ($1::uuid, $2::uuid, 'B_task_loop',
       NOW() + ($3 || ' seconds')::interval,
       $4, $5
     )
     RETURNING id`,
    [state.initiativeId, contractId, String(timeoutSec), journeyType, journeyId],
  );
  runId = runInsert.rows[0].id;
}
```

- [ ] **Step 2: 运行全部 brain tests 确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/b55-gan-abort-fix
npx vitest run packages/brain/src/workflows/__tests__/ 2>&1 | tail -20
```

Expected: 所有 tests PASS（包含 B54 的 harness-gan-reviewer-verdict tests）

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(brain): B55 OPEN-6 — dbUpsertNode initiative_runs 改 UPDATE，幂等 fallback INSERT"
```

---

### Task 5：Learning 文件 + 运行 DevGate

**Files:**
- Create: `docs/learnings/cp-0602HHNN-b55-gan-abort-fix.md`

- [ ] **Step 1: 运行 DevGate**

```bash
cd /Users/administrator/worktrees/cecelia/b55-gan-abort-fix
node scripts/facts-check.mjs 2>&1 | tail -10
bash scripts/check-version-sync.sh 2>&1 | tail -5
node packages/engine/scripts/devgate/check-dod-mapping.cjs 2>&1 | tail -5
```

Expected: 全 PASS（这次改动不涉及 DEFINITION.md 标注的 Brain 关键路径）

- [ ] **Step 2: 写 Learning 文件**

命名格式：`docs/learnings/cp-$(TZ=Asia/Shanghai date +%m%d%H%M)-b55-gan-abort-fix.md`

```markdown
# Learning: B55 — GAN Abort 传播 + initiative_runs 早建

### 根本原因
1. OPEN-5: `runGanLoopNode` catch 只 return error，没更新 `tasks.status`，zombie-reaper 又豁免 harness → 失败任务永远 in_progress
2. OPEN-6: `initiative_runs` INSERT 在 `dbUpsertNode`（GAN 成功后），GAN abort → 无 run 记录 → 监控看不见

### 下次预防
- [ ] GAN abort / 任何 critical node catch 必须在 catch 块内 UPDATE tasks.status，不依赖上层
- [ ] initiative_runs 应在 pipeline 最早期（prep 节点）建立，tracking 与 outcome 解耦
- [ ] 新增 pipeline 节点时，先问：「这个 catch 会不会造成 task 永远 in_progress」
```

- [ ] **Step 3: Commit**

```bash
LEARNING_FILE="docs/learnings/cp-$(TZ=Asia/Shanghai date +%m%d%H%M)-b55-gan-abort-fix.md"
git add "$LEARNING_FILE"
git commit -m "docs: B55 learning — GAN abort 传播 + initiative_runs 早建"
```

---

### 验收标准（所有 Task 完成后验证）

- [ ] `npx vitest run packages/brain/src/workflows/__tests__/` 全绿
- [ ] OPEN-5：触发 GAN abort 后，`tasks.status = 'failed'`（DB 查验）
- [ ] OPEN-6：`prepInitiativeNode` 执行后 initiative_runs 有记录（phase=A_contract），GAN abort 后 phase=failed
- [ ] `dbUpsertNode` GAN 成功路径：initiative_runs 变 phase=B_task_loop，contract_id 写入
- [ ] DevGate 全 PASS
