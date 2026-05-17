# Harness v2 Phase A GAN Contract Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `harness-initiative-runner.js` 在 Planner 成功后跑 Proposer/Reviewer GAN 对抗循环，Reviewer APPROVED 后写 `initiative_contracts.status='approved'` + `contract_content`，让 PR-3 phase advancer 把 Initiative 推进到 B_task_loop。

**Architecture:** 新增 `harness-gan-loop.js` 封装 propose→review 循环（无轮次上限，budgetCapUsd 兜底）；runner Planner 成功后调 loop，DB tx 一次性 INSERT approved contract + B_task_loop run。

**Tech Stack:** Node.js ESM + vitest + existing docker-executor + fs/promises

---

## File Structure

**Create:**
- `packages/brain/src/harness-gan-loop.js` — `runGanContractLoop`, `extractVerdict`, `extractFeedback`, `buildProposerPrompt`, `buildReviewerPrompt`
- `packages/brain/src/__tests__/harness-gan-loop.test.js`
- `packages/brain/src/__tests__/harness-initiative-runner-gan.test.js`

**Modify:**
- `packages/brain/src/harness-initiative-runner.js` — Planner 成功后、BEGIN 前插入 GAN 调用；contract/run INSERT 改为 approved/B_task_loop

---

### Task 1: harness-gan-loop.js — GAN 循环模块

**Files:**
- Create: `packages/brain/src/harness-gan-loop.js`
- Test: `packages/brain/src/__tests__/harness-gan-loop.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/brain/src/__tests__/harness-gan-loop.test.js
import { describe, it, expect, vi } from 'vitest';

function baseOpts(overrides = {}) {
  return {
    taskId: 'task-abcdef1234567890',
    initiativeId: 'init-xxx',
    sprintDir: 'sprints/test',
    prdContent: '# PRD\n\nGoal: build X',
    worktreePath: '/tmp/wt/harness-v2/task-abcdef12',
    githubToken: 'ghs_test',
    budgetCapUsd: 10,
    ...overrides,
  };
}

describe('runGanContractLoop', () => {
  it('round 1 APPROVED → returns rounds=1 contract_content', async () => {
    const reads = [];
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        return { exit_code: 0, stdout: 'proposer-1 stdout', stderr: '', cost_usd: 0.1, timed_out: false };
      }
      return { exit_code: 0, stdout: 'analysis...\nVERDICT: APPROVED\n', stderr: '', cost_usd: 0.05, timed_out: false };
    });
    const readContractFile = vi.fn(async (wt, sd) => { reads.push([wt, sd]); return '# Contract R1'; });
    const { runGanContractLoop } = await import('../harness-gan-loop.js');
    const res = await runGanContractLoop({ ...baseOpts(), executor, readContractFile });
    expect(res.rounds).toBe(1);
    expect(res.contract_content).toBe('# Contract R1');
    expect(res.cost_usd).toBeCloseTo(0.15, 3);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it('round 1 REVISION → round 2 APPROVED; round 2 proposer prompt includes feedback', async () => {
    const capturedPrompts = [];
    let proposerCalls = 0;
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        proposerCalls++;
        capturedPrompts.push(opts.prompt);
        return { exit_code: 0, stdout: `proposer-${proposerCalls}`, stderr: '', cost_usd: 0.1, timed_out: false };
      }
      if (proposerCalls === 1) {
        return { exit_code: 0, stdout: '[Reviewer analysis]\nRisk: X unclear\nRisk: Y underspecified\n\nVERDICT: REVISION', stderr: '', cost_usd: 0.05, timed_out: false };
      }
      return { exit_code: 0, stdout: 'looks good\nVERDICT: APPROVED', stderr: '', cost_usd: 0.05, timed_out: false };
    });
    const readContractFile = vi.fn(async () => 'contract-roundN');
    const { runGanContractLoop } = await import('../harness-gan-loop.js');
    const res = await runGanContractLoop({ ...baseOpts(), executor, readContractFile });
    expect(res.rounds).toBe(2);
    expect(capturedPrompts.length).toBe(2);
    expect(capturedPrompts[0]).not.toMatch(/Risk: X unclear/);
    expect(capturedPrompts[1]).toMatch(/Risk: X unclear/);
    expect(capturedPrompts[1]).toMatch(/Risk: Y underspecified/);
  });

  it('accumulated cost exceeds budget → throws gan_budget_exceeded', async () => {
    const executor = vi.fn(async () => ({ exit_code: 0, stdout: 'VERDICT: REVISION', stderr: '', cost_usd: 3, timed_out: false }));
    const readContractFile = vi.fn(async () => 'c');
    const { runGanContractLoop } = await import('../harness-gan-loop.js');
    await expect(
      runGanContractLoop({ ...baseOpts({ budgetCapUsd: 5 }), executor, readContractFile })
    ).rejects.toThrow(/gan_budget_exceeded/);
  });

  it('proposer exit!=0 → throws proposer_failed', async () => {
    const executor = vi.fn(async () => ({ exit_code: 1, stdout: '', stderr: 'boom', cost_usd: 0.1, timed_out: false }));
    const readContractFile = vi.fn(async () => 'c');
    const { runGanContractLoop } = await import('../harness-gan-loop.js');
    await expect(
      runGanContractLoop({ ...baseOpts(), executor, readContractFile })
    ).rejects.toThrow(/proposer_failed/);
  });

  it('reviewer stdout has no VERDICT → treated as REVISION (continues)', async () => {
    let proposerCalls = 0;
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        proposerCalls++;
        return { exit_code: 0, stdout: `p${proposerCalls}`, stderr: '', cost_usd: 0.1, timed_out: false };
      }
      if (proposerCalls === 1) return { exit_code: 0, stdout: 'no verdict text', stderr: '', cost_usd: 0.05, timed_out: false };
      return { exit_code: 0, stdout: 'VERDICT: APPROVED', stderr: '', cost_usd: 0.05, timed_out: false };
    });
    const readContractFile = vi.fn(async () => 'c');
    const { runGanContractLoop } = await import('../harness-gan-loop.js');
    const res = await runGanContractLoop({ ...baseOpts(), executor, readContractFile });
    expect(res.rounds).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-gan-loop.test.js`
Expected: FAIL — "Cannot find module '../harness-gan-loop.js'"

- [ ] **Step 3: Write implementation**

```js
// packages/brain/src/harness-gan-loop.js
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const VERDICT_RE = /VERDICT:\s*(APPROVED|REVISION)/i;

async function defaultReadContractFile(worktreePath, sprintDir) {
  const full = path.join(worktreePath, sprintDir, 'contract-draft.md');
  return await readFile(full, 'utf8');
}

function extractVerdict(stdout) {
  const m = String(stdout || '').match(VERDICT_RE);
  return m ? m[1].toUpperCase() : 'REVISION';
}

function extractFeedback(stdout) {
  const s = String(stdout || '');
  if (!s) return '';
  return s.slice(-2000);
}

function buildProposerPrompt(prdContent, feedback, round) {
  const parts = [
    '/harness-contract-proposer',
    '',
    `round: ${round}`,
    '',
    '## PRD',
    prdContent,
  ];
  if (feedback) {
    parts.push('', '## 上轮 Reviewer 反馈（必须处理）', feedback);
  }
  return parts.join('\n');
}

function buildReviewerPrompt(prdContent, contractContent, round) {
  return [
    '/harness-contract-reviewer',
    '',
    `round: ${round}`,
    '',
    '## PRD',
    prdContent,
    '',
    '## Proposer 当前合同草案',
    contractContent,
    '',
    '## 任务',
    '严格找 ≥2 个风险点；找不到才 APPROVED；否则 REVISION + 具体修改建议。',
    '输出末尾必须有 `VERDICT: APPROVED` 或 `VERDICT: REVISION`。',
  ].join('\n');
}

/**
 * Harness v2 Phase A GAN 循环。
 * 无轮次上限；由 Reviewer 内置"找不到风险就 APPROVED"自然终止；budgetCapUsd 兜底。
 *
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.initiativeId
 * @param {string} opts.sprintDir
 * @param {string} opts.prdContent
 * @param {Function} opts.executor                executeInDocker 或 mock
 * @param {Function} [opts.readContractFile]      (worktreePath, sprintDir) => Promise<string>
 * @param {string} opts.worktreePath
 * @param {string} opts.githubToken
 * @param {number} [opts.budgetCapUsd=10]
 * @returns {Promise<{contract_content:string, rounds:number, cost_usd:number}>}
 */
export async function runGanContractLoop(opts) {
  const {
    taskId, initiativeId, sprintDir, prdContent,
    executor, worktreePath, githubToken,
    budgetCapUsd = 10,
  } = opts;
  const readContractFile = opts.readContractFile || defaultReadContractFile;

  let round = 0;
  let cost = 0;
  let feedback = null;
  let contractContent = null;

  while (true) {
    round += 1;

    const proposerResult = await executor({
      task: { id: taskId, task_type: 'harness_contract_propose' },
      prompt: buildProposerPrompt(prdContent, feedback, round),
      worktreePath,
      env: {
        CECELIA_CREDENTIALS: 'account1',
        CECELIA_TASK_TYPE: 'harness_contract_propose',
        HARNESS_NODE: 'proposer',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_PROPOSE_ROUND: String(round),
        GITHUB_TOKEN: githubToken,
      },
    });
    if (!proposerResult || proposerResult.exit_code !== 0) {
      throw new Error(`proposer_failed: exit=${proposerResult?.exit_code} stderr=${(proposerResult?.stderr || '').slice(0, 300)}`);
    }
    cost += Number(proposerResult.cost_usd || 0);

    contractContent = await readContractFile(worktreePath, sprintDir);

    const reviewerResult = await executor({
      task: { id: taskId, task_type: 'harness_contract_review' },
      prompt: buildReviewerPrompt(prdContent, contractContent, round),
      worktreePath,
      env: {
        CECELIA_CREDENTIALS: 'account1',
        CECELIA_TASK_TYPE: 'harness_contract_review',
        HARNESS_NODE: 'reviewer',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_REVIEW_ROUND: String(round),
        GITHUB_TOKEN: githubToken,
      },
    });
    if (!reviewerResult || reviewerResult.exit_code !== 0) {
      throw new Error(`reviewer_failed: exit=${reviewerResult?.exit_code}`);
    }
    cost += Number(reviewerResult.cost_usd || 0);

    if (cost > budgetCapUsd) {
      throw new Error(`gan_budget_exceeded: spent=${cost.toFixed(3)} cap=${budgetCapUsd}`);
    }

    const verdict = extractVerdict(reviewerResult.stdout);
    if (verdict === 'APPROVED') {
      return { contract_content: contractContent, rounds: round, cost_usd: cost };
    }
    feedback = extractFeedback(reviewerResult.stdout);
  }
}

export { extractVerdict, extractFeedback, buildProposerPrompt, buildReviewerPrompt };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-gan-loop.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-gan-loop
git add packages/brain/src/harness-gan-loop.js packages/brain/src/__tests__/harness-gan-loop.test.js
git commit -m "feat(harness-v2): add runGanContractLoop for phase A contract negotiation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: harness-initiative-runner.js — 集成 GAN 循环

**Files:**
- Modify: `packages/brain/src/harness-initiative-runner.js`
- Test: `packages/brain/src/__tests__/harness-initiative-runner-gan.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/brain/src/__tests__/harness-initiative-runner-gan.test.js
import { describe, it, expect, vi } from 'vitest';

describe('runInitiative GAN integration', () => {
  it('runs planner + GAN then writes approved contract + B_task_loop run', async () => {
    vi.resetModules();
    vi.doMock('../harness-worktree.js', () => ({
      ensureHarnessWorktree: vi.fn(async () => '/tmp/wt/harness-v2/task-abcdef12'),
      cleanupHarnessWorktree: vi.fn(),
    }));
    vi.doMock('../harness-credentials.js', () => ({
      resolveGitHubToken: vi.fn(async () => 'ghs_test'),
    }));
    vi.doMock('../harness-gan-loop.js', () => ({
      runGanContractLoop: vi.fn(async () => ({
        contract_content: '# Final Contract',
        rounds: 2,
        cost_usd: 0.3,
      })),
    }));

    const insertedContractArgs = [];
    const insertedRunArgs = [];
    const mockClient = {
      query: vi.fn(async (sql, params) => {
        if (/INSERT INTO initiative_contracts/i.test(sql)) {
          insertedContractArgs.push({ sql, params });
          return { rows: [{ id: 'contract-1' }] };
        }
        if (/INSERT INTO initiative_runs/i.test(sql)) {
          insertedRunArgs.push({ sql, params });
          return { rows: [{ id: 'run-1' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const mockPool = { connect: async () => mockClient };

    const plannerStdout = JSON.stringify({
      type: 'result',
      result: '```json\n{"initiative_id":"i","tasks":[{"logical_task_id":"ws1","title":"t","complexity":"S","files":[],"dod":[]}]}\n```',
    });
    const mockExec = vi.fn(async () => ({ exit_code: 0, stdout: plannerStdout, stderr: '', timed_out: false }));

    const { runInitiative } = await import('../harness-initiative-runner.js');
    const res = await runInitiative(
      { id: 'task-abcdef1234567890', title: 'x', description: 'y' },
      { executor: mockExec, pool: mockPool }
    );

    expect(res.success).toBe(true);
    expect(insertedContractArgs.length).toBe(1);
    expect(insertedContractArgs[0].sql).toMatch(/approved/);
    expect(insertedContractArgs[0].params).toEqual(expect.arrayContaining(['# Final Contract']));
    expect(insertedRunArgs.length).toBe(1);
    expect(insertedRunArgs[0].sql).toMatch(/B_task_loop/);
  });

  it('returns {success:false} when GAN throws', async () => {
    vi.resetModules();
    vi.doMock('../harness-worktree.js', () => ({
      ensureHarnessWorktree: vi.fn(async () => '/tmp/wt/harness-v2/task-abcdef12'),
      cleanupHarnessWorktree: vi.fn(),
    }));
    vi.doMock('../harness-credentials.js', () => ({
      resolveGitHubToken: vi.fn(async () => 'ghs_test'),
    }));
    vi.doMock('../harness-gan-loop.js', () => ({
      runGanContractLoop: vi.fn(async () => { throw new Error('gan_budget_exceeded: spent=11 cap=10'); }),
    }));

    const mockClient = {
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    };
    const mockPool = { connect: async () => mockClient };

    const plannerStdout = JSON.stringify({
      type: 'result',
      result: '```json\n{"initiative_id":"i","tasks":[{"logical_task_id":"ws1","title":"t","complexity":"S","files":[],"dod":[]}]}\n```',
    });
    const mockExec = vi.fn(async () => ({ exit_code: 0, stdout: plannerStdout, stderr: '', timed_out: false }));

    const { runInitiative } = await import('../harness-initiative-runner.js');
    const res = await runInitiative(
      { id: 'task-abcdef1234567890', title: 'x', description: 'y' },
      { executor: mockExec, pool: mockPool }
    );

    expect(res.success).toBe(false);
    expect(String(res.error || '')).toMatch(/gan|budget/);
    expect(mockClient.query).not.toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO initiative_contracts/));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-initiative-runner-gan.test.js`
Expected: FAIL — 目前 runner 没调 GAN，contract INSERT 是 draft 不是 approved

- [ ] **Step 3: Read existing runner Planner + contract INSERT block**

Run: `grep -n "harness_planner\|initiative_contracts\|initiative_runs\|BEGIN\|plannerOutput" packages/brain/src/harness-initiative-runner.js | head -25`

找到 3 处位置：
- Planner `executor({...})` 调用
- 事务 `BEGIN` 的 query
- `INSERT INTO initiative_contracts`
- `INSERT INTO initiative_runs`

读原文至少 60 行以确认插入点。

- [ ] **Step 4: Edit harness-initiative-runner.js**

**改动 1**：文件顶部 import 处加：
```js
import { runGanContractLoop } from './harness-gan-loop.js';
```

**改动 2**：Planner `const result = await executor({...})` 成功分支之后（确认 `result.exit_code === 0`、解析出 `plannerOutput`）、`await client.query('BEGIN')` 之前，插入：

```js
// Phase A — GAN 合同循环（PR-4）
let ganResult;
try {
  ganResult = await runGanContractLoop({
    taskId: task.id,
    initiativeId,
    sprintDir,
    prdContent: plannerOutput,
    executor,
    worktreePath,
    githubToken,
    budgetCapUsd: 10,
  });
} catch (err) {
  console.error(`[harness-initiative-runner] GAN failed task=${task.id}: ${err.message}`);
  return { success: false, taskId: task.id, initiativeId, error: `gan: ${err.message}` };
}
```

**改动 3**：INSERT contract query 改为：
```js
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

**改动 4**：INSERT run query 改 `'A_contract'` → `'B_task_loop'`。

- [ ] **Step 5: Run regression tests**

```
cd packages/brain && npx vitest run \
  src/__tests__/harness-gan-loop.test.js \
  src/__tests__/harness-initiative-runner-gan.test.js \
  src/__tests__/harness-initiative-runner-phase-c.test.js \
  src/__tests__/harness-initiative-runner-container-mount.test.js \
  src/__tests__/harness-phase-advancer.test.js \
  src/__tests__/harness-task-dispatch.test.js \
  2>&1 | tail -15
```
Expected: 5 + 2 + 17 + 2 + 7 + 7 = 40 PASS

对于 `harness-initiative-runner-container-mount.test.js`，因为它没 mock GAN，实际会跑到 GAN 调用。这个老测试可能需要补 `vi.doMock('../harness-gan-loop.js', ...)` 让它继续通过。如果失败了：

修 `harness-initiative-runner-container-mount.test.js` — 在现有 `vi.doMock('../harness-credentials.js', ...)` 之后补：
```js
vi.doMock('../harness-gan-loop.js', () => ({
  runGanContractLoop: vi.fn(async () => ({
    contract_content: '# mock contract',
    rounds: 1,
    cost_usd: 0.1,
  })),
}));
```

对于 integration 测试 `integration/harness-initiative-runner.integration.test.js` 同样可能失败，补相同 mock。

- [ ] **Step 6: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-gan-loop
git add packages/brain/src/harness-initiative-runner.js packages/brain/src/__tests__/harness-initiative-runner-gan.test.js
# 如果修了其他老测试：
git add packages/brain/src/__tests__/harness-initiative-runner-container-mount.test.js
git add packages/brain/src/__tests__/integration/harness-initiative-runner.integration.test.js
git commit -m "feat(harness-v2): integrate GAN contract loop into runInitiative

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Learning + DoD 勾选

**Files:**
- Create: `docs/learnings/cp-0420183355-harness-v2-gan-loop.md`
- Modify: `docs/superpowers/specs/2026-04-20-harness-v2-gan-loop-design.md`（5 DoD 全部 `[x]`）

- [ ] **Step 1: Write learning**

```markdown
# Harness v2 Phase A GAN Contract Loop

### 根本原因
Harness v2 的 Phase A 定义里只有 Planner 建 draft 合同，Proposer/Reviewer 对抗循环从未接入 runner。结果 `initiative_contracts.status` 永远是 draft，PR-3 phase advancer 等不到 approved 就不会晋级，Initiative 永远卡在 A_contract。

### 下次预防
- [ ] 新状态机必须同时实现"状态变迁触发器"而不是只定义状态枚举（本 PR 是例二，PR-3 是例一）
- [ ] GAN 循环不加轮次上限（memory harness-gan-design.md 的刻意设计），只加预算兜底
- [ ] 任何"循环 + LLM 调用"必须先在单测里用 mock 模拟 2-3 轮才真机跑，避免真机调试烧钱
- [ ] Reviewer 输出不含 VERDICT 时默认 REVISION（保守放大对抗）而非 APPROVED（避免静默放行）
```

- [ ] **Step 2: Tick DoD checkboxes**

Edit spec `## 成功标准` 全部 `- [ ]` → `- [x]`。

- [ ] **Step 3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-gan-loop
git add docs/learnings/cp-0420183355-harness-v2-gan-loop.md docs/superpowers/specs/2026-04-20-harness-v2-gan-loop-design.md
git commit -m "docs(harness-v2): learning + DoD [x] for PR-4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

1. **Spec coverage**：
   - `runGanContractLoop` → Task 1
   - runner 集成 + DB approved + B_task_loop → Task 2
   - GAN rounds / feedback propagation / budget / proposer fail / no VERDICT → Task 1 tests
   - GAN approved/fail 端到端 → Task 2 tests
   - DoD 5 条 → Task 3
2. **Placeholder scan**：无 TBD/TODO，代码完整。
3. **Type consistency**：`runGanContractLoop({ taskId, initiativeId, sprintDir, prdContent, executor, worktreePath, githubToken, budgetCapUsd })` 返回 `{contract_content, rounds, cost_usd}` 在 Task 1/2 一致。

---

## Execution Handoff

Plan 完成。/dev 自主规则 Subagent-Driven。
