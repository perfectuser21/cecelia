# B44 Harness Pipeline Sync Fix 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 WS3 async GAN 导致的三处 harness pipeline 断链 bug，让 `runGanContractGraph` 改回同步阻塞、`harness-thread-lookup.js` 映射到正确图、`runPlannerNode` prompt 删除矛盾的 task-plan.json 输出要求。

**Architecture:** 修复1 把 `proposer`/`reviewer` 节点改回阻塞 executor 模式（删除 spawnDockerDetached + interrupt 逻辑），`runGanContractGraph` 同步等 finalState 再返回完整结果。修复2 把 `harness-initiative` 映射到 `compileHarnessFullGraph`（全图）。修复3 删除 Planner prompt 中要求输出 task-plan.json 的矛盾行。所有 skip 的 WS3-async 相关测试改成 mock executor 阻塞方式并取消 skip。

**Tech Stack:** Node.js ESM, LangGraph (@langchain/langgraph), vitest, PostgreSQL

---

### Task 1: 修复 harness-gan.graph.js — proposer 节点改回阻塞 executor

**Files:**
- Modify: `packages/brain/src/workflows/harness-gan.graph.js`

- [ ] **Step 1: 确认在 worktree 分支**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
git branch --show-current
# Expected: cp-0530234353-B44-harness-sync-fix
```

- [ ] **Step 2: 在 `createGanContractNodes` 中，将 `proposer` 函数整体替换为阻塞 executor 模式**

在文件 `packages/brain/src/workflows/harness-gan.graph.js` 中找到 `async function proposer(state)` 函数（约第 360-421 行），将整个函数替换为：

```javascript
  async function proposer(state) {
    const nextRound = (state.round || 0) + 1;
    const computedBranch = `cp-harness-propose-r${nextRound}-${taskId.slice(0, 8)}`;

    // 清理上轮残留结果文件，防止 executor 失败时读到旧数据
    const { unlink } = await import('node:fs/promises');
    try { await unlink(path.join(worktreePath, '.brain-result.json')); } catch { /* 首轮不存在，忽略 */ }

    const acctOpts = { task: { id: taskId, task_type: 'harness_contract_propose' }, env: {} };
    try { await resolveAccount(acctOpts, { taskId }); } catch { /* non-blocking */ }

    // B44 fix: 改回阻塞 executor（WS3 async 已回退，根因 propose_branch 丢失）
    const result = await executor({
      task: { id: taskId, task_type: 'harness_contract_propose' },
      prompt: buildProposerPrompt(state.prdContent, state.feedback, nextRound, computedBranch),
      worktreePath,
      env: {
        ...acctOpts.env,
        CECELIA_TASK_TYPE: 'harness_contract_propose',
        HARNESS_NODE: 'proposer',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_PROPOSE_ROUND: String(nextRound),
        TASK_ID: taskId,
        SPRINT_DIR: sprintDir,
        PLANNER_BRANCH: plannerBranch,
        PROPOSE_ROUND: String(nextRound),
        PROPOSE_BRANCH: computedBranch,
        GITHUB_TOKEN: githubToken,
      },
    });

    if (result.exit_code !== 0 || result.timed_out) {
      throw new Error(`proposer_failed: exit=${result.exit_code}`);
    }

    const contractContent = await readContractFile(worktreePath, sprintDir);
    const resultData = await readBrainResult(worktreePath, ['propose_branch']).catch(() => ({}));
    const proposeBranch = resultData.propose_branch || computedBranch;
    await verifyProposer({ worktreePath, branch: proposeBranch, sprintDir, baseRepo }).catch(err => {
      console.warn(`[harness-gan] verifyProposer failed: ${err.message}`);
    });
    return {
      round: nextRound,
      costUsd: state.costUsd || 0,
      contractContent,
      proposeBranch,
    };
  }
```

- [ ] **Step 3: 将 `reviewer` 函数整体替换为阻塞 executor 模式**

找到 `async function reviewer(state)` 函数（约第 445-567 行），将整个函数替换为：

```javascript
  async function reviewer(state) {
    // 清理上轮残留结果文件，防止 executor 失败时读到旧数据
    const { unlink } = await import('node:fs/promises');
    try { await unlink(path.join(worktreePath, '.brain-result.json')); } catch { /* 忽略 */ }

    const currentRound = state.round || 0;

    const acctOpts = { task: { id: taskId, task_type: 'harness_contract_review' }, env: {} };
    try { await resolveAccount(acctOpts, { taskId }); } catch { /* non-blocking */ }

    // B44 fix: 改回阻塞 executor（WS3 async 已回退）
    const result = await executor({
      task: { id: taskId, task_type: 'harness_contract_review' },
      prompt: buildReviewerPrompt(state.prdContent, state.contractContent, currentRound),
      worktreePath,
      env: {
        ...acctOpts.env,
        CECELIA_TASK_TYPE: 'harness_contract_review',
        HARNESS_NODE: 'reviewer',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_REVIEW_ROUND: String(currentRound),
        TASK_ID: taskId,
        SPRINT_DIR: sprintDir,
        PLANNER_BRANCH: plannerBranch,
        REVIEW_ROUND: String(currentRound),
        GITHUB_TOKEN: githubToken,
      },
    });

    if (result.exit_code !== 0 || result.timed_out) {
      throw new Error(`reviewer_failed: exit=${result.exit_code}`);
    }

    const costAfterSpawn = state.costUsd || 0;
    if (costAfterSpawn > budgetCapUsd) {
      throw new Error(`gan_budget_exceeded: spent=${costAfterSpawn.toFixed(3)} cap=${budgetCapUsd}`);
    }

    let resultData = await readBrainResult(worktreePath, ['verdict', 'rubric_scores', 'feedback']).catch(() => ({}));
    const rawData = resultData;
    const hasRubricData = rawData.rubric_scores &&
      typeof rawData.rubric_scores === 'object' &&
      Object.keys(rawData.rubric_scores).length > 0;

    if (hasRubricData) {
      const loopResult = await runReviewerSchemaLoop(
        async () => ({ ...rawData, cost_usd: 0 }),
        ReviewerOutputSchema,
        budgetCapUsd,
        0,
      ).catch(() => rawData);
      resultData = loopResult;
    }

    const rubricScores = resultData.rubric_scores;
    const rubricVerdict = computeVerdictFromRubric(rubricScores, currentRound);
    let verdict = rubricVerdict || resultData.verdict;
    const verdictSource = rubricVerdict ? 'rubric' : 'file_verdict';
    if (rubricVerdict && rubricVerdict !== resultData.verdict) {
      console.warn(`[harness-gan] round=${currentRound} rubric_verdict=${rubricVerdict} ≠ file_verdict=${resultData.verdict} — 按 rubric 判（代码权威）`);
    }

    const newHistoryEntry = rubricScores ? { round: currentRound, scores: rubricScores } : null;
    const combinedHistory = newHistoryEntry
      ? [...(state.rubricHistory || []), newHistoryEntry]
      : (state.rubricHistory || []);
    const trend = detectConvergenceTrend(combinedHistory);
    let forcedApproval = false;
    if (verdict !== 'APPROVED' && (trend === 'diverging' || trend === 'oscillating')) {
      console.warn(`[harness-gan][P1] GAN ${trend} at round=${currentRound} — force APPROVED (verdict_before=${verdict}, verdictSource=${verdictSource}, history_len=${combinedHistory.length})`);
      verdict = 'APPROVED';
      forcedApproval = true;
    }

    const patch = {
      costUsd: costAfterSpawn,
      verdict,
      forcedApproval,
    };
    if (newHistoryEntry) patch.rubricHistory = [newHistoryEntry];
    if (verdict !== 'APPROVED') patch.feedback = resultData.feedback || '';
    return patch;
  }
```

- [ ] **Step 4: 更新 `GanContractState` — 删除 WS3 async 的 container 字段**

找到 `GanContractState` 定义中的这些字段（约第 315-325 行）并删除：

```javascript
  // WS3 async: context 字段（原来从 ctx 传入，现在也放进 state 让节点可读）
  taskId: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
  initiativeId: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
  sprintDir: Annotation({ reducer: (_old, neu) => neu, default: () => 'sprints' }),
  worktreePath: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
  githubToken: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
  budgetCapUsd: Annotation({ reducer: (_old, neu) => neu, default: () => 10 }),
  proposerContainerId: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
  reviewerContainerId: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
  proposerContainerRound: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
  reviewerContainerRound: Annotation({ reducer: (_old, neu) => neu, default: () => null }),
```

保留 `GanContractState` 中其他字段（prdContent, contractContent, feedback, round, costUsd, verdict, forcedApproval, proposeBranch, rubricHistory, session_map）不变。

- [ ] **Step 5: 更新 `runGanContractGraph` — 改回同步 invoke**

找到 `runGanContractGraph` 函数末尾（约第 662-677 行），将：

```javascript
  // WS3 async: invoke 到第一次 interrupt 就返回（kickoff，不阻塞等 GAN 完成）
  // GAN 推进靠 callback router Command(resume) 驱动
  await app.invoke(
    { prdContent, round: 0, costUsd: 0, feedback: null },
    {
      configurable: { thread_id: String(taskId) },
      recursionLimit,
    }
  ).catch(err => {
    // interrupt() 会抛出异常被 LangGraph 捕获；非 interrupt 错误才真正抛
    if (!err?.message?.includes('interrupt') && err?.name !== 'GraphInterrupt') throw err;
  });

  // kickoff 成功，GAN 已在第一次 interrupt 挂起，等 callback resume
  return { kickoff: true, thread_id: String(taskId) };
```

替换为：

```javascript
  // B44 fix: 同步等 GAN 完整跑完再返回（WS3 async 已回退，根因 propose_branch 丢失）
  const finalState = await app.invoke(
    { prdContent, round: 0, costUsd: 0, feedback: null },
    {
      configurable: { thread_id: String(taskId) },
      recursionLimit,
    }
  );
  return {
    contract_content: finalState.contractContent || '',
    propose_branch: finalState.proposeBranch || null,
    rounds: finalState.round || 0,
    cost_usd: finalState.costUsd || 0,
    verdict: finalState.verdict || 'APPROVED',
    forced_approval: finalState.forcedApproval || false,
  };
```

- [ ] **Step 6: 删除 `compileHarnessGanGraph` 函数（WS3 async 产物，不再需要）**

删除以下函数（约第 617-627 行）：

```javascript
export async function compileHarnessGanGraph(checkpointer) {
  const nodes = createGanContractNodes(null, {
    taskId: '__placeholder__', initiativeId: '__placeholder__',
    sprintDir: 'sprints', worktreePath: '/tmp', githubToken: '',
  });
  const graph = buildGanContractGraph(nodes);
  return graph.compile({ checkpointer, durability: 'sync' });
}
```

- [ ] **Step 7: 删除 WS3 async 的独立 spawn 节点 `proposerSpawnNode` 和 `reviewerSpawnNode`**

删除 `proposerSpawnNode`（约第 683-727 行）和 `reviewerSpawnNode`（约第 729-773 行）两个导出函数。

- [ ] **Step 8: 清理 import — 删除不再需要的 WS3 async 引入**

在文件顶部，删除以下两个 import 行（如果删除 proposer/reviewer 内的 spawnDockerDetached 引用，但保留 `interrupt` 的引用（harness-gan-async.test.js 的 BEHAVIOR 断言仍需要文件中有 `interrupt` — 等 Task 4 更新测试后可再清理 interrupt import）：

保留 `spawnDockerDetached` import（因为 `harness-gan-async.test.js` 的 BEHAVIOR 断言检查源码包含此 import），但在 proposer/reviewer 节点中不再调用它。

实际上，根据 Task 4 的测试修改方向（把 WS3 async 测试全部修改为 mock executor），需要先完成 Task 4 再决定是否删除。此步跳过，在 Task 4 完成后处理。

- [ ] **Step 9: 提交 Task 1**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
git add packages/brain/src/workflows/harness-gan.graph.js
git commit -m "fix(harness): B44 — GAN 改回同步 executor，删除 WS3 async spawnDockerDetached+interrupt"
```

---

### Task 2: 修复 harness-thread-lookup.js — harness-initiative 映射到 compileHarnessFullGraph

**Files:**
- Modify: `packages/brain/src/lib/harness-thread-lookup.js`

- [ ] **Step 1: 先写 failing test 验证当前 bug**

在测试文件中新增一个测试，验证 `harness-initiative` graphName 确实调用 `compileHarnessFullGraph`：

在 `packages/brain/src/lib/__tests__/` 目录下新建文件（如果目录不存在则创建）：

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
mkdir -p packages/brain/src/lib/__tests__
```

新建测试文件 `packages/brain/src/lib/__tests__/harness-thread-lookup.test.js`：

```javascript
/**
 * B44 fix — harness-thread-lookup.js 的 harness-initiative case 应用 compileHarnessFullGraph
 */
import { describe, it, expect, vi } from 'vitest';

// mock
const mockCompileFullGraph = vi.fn().mockResolvedValue({ invoke: vi.fn(), getState: vi.fn() });
const mockCompileInitiativeGraph = vi.fn().mockResolvedValue({ invoke: vi.fn() });
const mockPgCheckpointer = vi.fn().mockResolvedValue({});

vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: () => mockPgCheckpointer(),
}));
vi.mock('../../workflows/harness-initiative.graph.js', () => ({
  compileHarnessFullGraph: () => mockCompileFullGraph(),
  compileHarnessInitiativeGraph: () => mockCompileInitiativeGraph(),
}));
vi.mock('../../workflows/harness-task.graph.js', () => ({
  compileHarnessTaskGraph: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../workflows/walking-skeleton-1node.graph.js', () => ({
  getCompiledWalkingSkeleton: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../workflows/harness-gan.graph.js', () => ({
  compileHarnessGanGraph: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({
      rows: [{ thread_id: 'test-thread-1', graph_name: 'harness-initiative' }],
    }),
  },
}));

import { _resetHarnessTaskCacheForTests, lookupHarnessThread } from '../harness-thread-lookup.js';

describe('B44 — harness-initiative case uses compileHarnessFullGraph [BEHAVIOR]', () => {
  it('graph_name=harness-initiative → calls compileHarnessFullGraph (NOT compileHarnessInitiativeGraph)', async () => {
    _resetHarnessTaskCacheForTests();
    mockCompileFullGraph.mockClear();
    mockCompileInitiativeGraph.mockClear();

    const result = await lookupHarnessThread('container-abc');

    expect(result).not.toBeNull();
    expect(mockCompileFullGraph).toHaveBeenCalledTimes(1);
    expect(mockCompileInitiativeGraph).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试，确认 FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
npx vitest run packages/brain/src/lib/__tests__/harness-thread-lookup.test.js 2>&1 | tail -30
# Expected: FAIL — compileHarnessInitiativeGraph 被调用而非 compileHarnessFullGraph
```

- [ ] **Step 3: 修改 harness-thread-lookup.js**

在 `packages/brain/src/lib/harness-thread-lookup.js` 中，找到 `harness-initiative` case（约第 123-134 行）：

```javascript
  // WS2: harness-initiative graph（planner detached+interrupt）
  if (graphName === 'harness-initiative') {
    try {
      const { compileHarnessInitiativeGraph } = await import('../workflows/harness-initiative.graph.js');
      const checkpointer = await getPgCheckpointer();
      const compiledGraph = await compileHarnessInitiativeGraph(checkpointer);
      return { compiledGraph, threadId };
    } catch (err) {
      console.error(`[harness-thread-lookup] compile harness-initiative failed containerId=${containerId}: ${err.message}`);
      return null;
    }
  }
```

替换为：

```javascript
  // B44 fix: harness-initiative 用全图（compileHarnessFullGraph，executor 用的图）
  // 原来的 compileHarnessInitiativeGraph 只含 Phase A 节点，无法处理 callback resume
  if (graphName === 'harness-initiative') {
    try {
      const { compileHarnessFullGraph } = await import('../workflows/harness-initiative.graph.js');
      const compiledGraph = await compileHarnessFullGraph();
      return { compiledGraph, threadId };
    } catch (err) {
      console.error(`[harness-thread-lookup] compile harness-initiative failed containerId=${containerId}: ${err.message}`);
      return null;
    }
  }
```

- [ ] **Step 4: 运行测试，确认 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
npx vitest run packages/brain/src/lib/__tests__/harness-thread-lookup.test.js 2>&1 | tail -20
# Expected: PASS
```

- [ ] **Step 5: 同时删除 harness-thread-lookup.js 中 harness-gan case 对 compileHarnessGanGraph 的引用**

（因为 Task 1 已删除 `compileHarnessGanGraph` 导出）找到 `harness-gan` case（约第 112-121 行）：

```javascript
  // WS3: harness-gan graph（proposer/reviewer detached+interrupt）
  if (graphName === 'harness-gan') {
    try {
      const checkpointer = await getPgCheckpointer();
      const compiledGraph = await compileHarnessGanGraph(checkpointer);
      return { compiledGraph, threadId };
    } catch (err) {
      console.error(`[harness-thread-lookup] compile harness-gan failed containerId=${containerId}: ${err.message}`);
      return null;
    }
  }
```

替换为（B44 回退：GAN 改回同步，不再有 detached spawn，harness-gan graph_name 不再写入 thread_lookup）：

```javascript
  // B44: harness-gan 已改回同步，不再写 thread_lookup，此分支保留作兼容（返回 null 即可）
  if (graphName === 'harness-gan') {
    console.warn(`[harness-thread-lookup] harness-gan is now synchronous (B44), graph_name=${graphName} should not appear in thread_lookup`);
    return null;
  }
```

同时删除顶部的 import（如果存在）：

```javascript
import { compileHarnessGanGraph } from '../workflows/harness-gan.graph.js';
```

- [ ] **Step 6: 提交 Task 2**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
git add packages/brain/src/lib/harness-thread-lookup.js \
        packages/brain/src/lib/__tests__/harness-thread-lookup.test.js
git commit -m "fix(harness): B44 — harness-initiative 映射到 compileHarnessFullGraph"
```

---

### Task 3: 修复 harness-initiative.graph.js — runPlannerNode prompt 删除矛盾的 task-plan.json 要求

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`

- [ ] **Step 1: 先写 failing test 验证当前 prompt 包含矛盾内容**

在 `packages/brain/src/workflows/__tests__/` 目录新建测试文件 `harness-initiative-b44-planner-prompt.test.js`：

```javascript
/**
 * B44 — runPlannerNode prompt 不应包含要求输出 task-plan.json 的矛盾指令
 * task-plan.json 由 Proposer 写到 propose_branch，Planner 只需输出 sprint_dir verdict JSON
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(
  import.meta.dirname, '..', 'harness-initiative.graph.js'
);

describe('B44 — runPlannerNode prompt 源码契约 [BEHAVIOR]', () => {
  it('runPlannerNode prompt 不含"在 stdout 末尾输出 task-plan.json"', () => {
    const src = readFileSync(SRC, 'utf8');
    // 找到 runPlannerNode 函数内的 prompt 模板字符串
    // 不应包含要求 task-plan.json 输出的行
    expect(src).not.toMatch(/在 stdout 末尾输出 task-plan\.json/);
    expect(src).not.toMatch(/task-plan\.json 必须被.*代码块包裹/);
  });

  it('runPlannerNode prompt 包含 sprint_dir verdict JSON 输出要求', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/sprint_dir.*verdict.*DONE/);
  });
});
```

- [ ] **Step 2: 运行测试，确认 FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-b44-planner-prompt.test.js 2>&1 | tail -20
# Expected: FAIL — prompt 仍含 task-plan.json 要求
```

- [ ] **Step 3: 修改 runPlannerNode 的 prompt**

在 `packages/brain/src/workflows/harness-initiative.graph.js` 中，找到 `runPlannerNode` 函数内的 prompt（约第 628-648 行）：

```javascript
  const prompt = `你是 harness-planner agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${state.task.id}
**initiative_id**: ${initiativeId}
**sprint_dir**: ${sprintDir}

## 任务描述
${state.task.description || state.task.title || ''}

## PrepPRD（产品语言，用户确认过的需求文档）
${state.task?.payload?.prep_prd_body || '（未提供，Planner 从 sprint-prd.md 推断）'}

## 输出要求（v2）
1. 生成 ${sprintDir}/sprint-prd.md（What，不写 How）
2. 在 stdout 末尾输出 task-plan.json
3. task-plan.json 必须被 \`\`\`json ... \`\`\` 代码块包裹便于提取`;
```

替换为：

```javascript
  const prompt = `你是 harness-planner agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${state.task.id}
**initiative_id**: ${initiativeId}
**sprint_dir**: ${sprintDir}

## 任务描述
${state.task.description || state.task.title || ''}

## PrepPRD（产品语言，用户确认过的需求文档）
${state.task?.payload?.prep_prd_body || '（未提供，Planner 从 sprint-prd.md 推断）'}

## 输出要求（v2）
1. 生成 ${sprintDir}/sprint-prd.md（What，不写 How）
2. sprint-prd.md 写完后，在最后一行输出：{"verdict":"DONE","sprint_dir":"${sprintDir}"}`;
```

（注意：`task-plan.json` 由 Proposer 在合同 GAN 后写到 propose_branch，`inferTaskPlanNode` 从那里读取。Planner 只负责 sprint-prd.md。）

- [ ] **Step 4: 运行测试，确认 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-b44-planner-prompt.test.js 2>&1 | tail -20
# Expected: PASS
```

- [ ] **Step 5: 提交 Task 3**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
git add packages/brain/src/workflows/harness-initiative.graph.js \
        packages/brain/src/workflows/__tests__/harness-initiative-b44-planner-prompt.test.js
git commit -m "fix(harness): B44 — runPlannerNode prompt 删除矛盾的 task-plan.json 输出要求"
```

---

### Task 4: 更新 harness-gan.graph.test.js 和 harness-gan-convergence.test.js — 取消 skip，改用 mock executor

**Files:**
- Modify: `packages/brain/src/workflows/__tests__/harness-gan.graph.test.js`
- Modify: `packages/brain/src/workflows/__tests__/harness-gan-convergence.test.js`
- Modify: `packages/brain/src/workflows/__tests__/harness-gan-async.test.js`

- [ ] **Step 1: 更新 harness-gan.graph.test.js — 取消 skip，删除 WS3 async 注释**

在文件 `packages/brain/src/workflows/__tests__/harness-gan.graph.test.js` 中，找到：

```javascript
describe.skip('GAN proposer node task-plan.json access 校验 [BEHAVIOR] [WS3 async: 需迁移]', () => {
```

改为：

```javascript
describe('GAN proposer node task-plan.json access 校验 [BEHAVIOR]', () => {
```

这些测试使用的是 mock executor 模式（`makeExecutorWithResultFile`），与 B44 修复后的阻塞 executor 模式完全兼容。

- [ ] **Step 2: 更新 harness-gan-convergence.test.js — 取消 skip，改用 mock executor**

在文件 `packages/brain/src/workflows/__tests__/harness-gan-convergence.test.js` 中，找到：

```javascript
describe.skip('reviewer node 收敛检测集成 [BEHAVIOR] [WS3 async: 需迁移到 spawnDetached+interrupt mock 模式]', () => {
```

改为：

```javascript
describe('reviewer node 收敛检测集成 [BEHAVIOR]', () => {
```

`makeMockExecutor` 函数已经是阻塞式 executor mock（直接 `vi.fn(async ...)` 返回），与 B44 修复后的同步节点完全兼容。

- [ ] **Step 3: 更新 harness-gan-async.test.js — 整个文件标记为 skip（WS3 async 已回退）**

在文件 `packages/brain/src/workflows/__tests__/harness-gan-async.test.js` 中，在文件顶部注释后、所有 describe 块前，给每个 `describe(` 改为 `describe.skip(`：

```javascript
// WS3 async: 已回退（B44 fix），proposer/reviewer 改回阻塞 executor。
// 以下测试验证 WS3 架构（spawnDockerDetached + interrupt），已不适用。
// 保留文件供历史参考，全部 skip。
```

具体来说，找到文件中所有 `describe(` 开头的测试块：

1. `describe('WS3 DoD — harness-gan.graph.js 源码契约 [BEHAVIOR]', ...)` → `describe.skip(...)`
2. `describe('GanContractState — context 字段进 state', ...)` → `describe.skip(...)`
3. `describe('proposerSpawnNode (detached spawn + thread_lookup)', ...)` → `describe.skip(...)`

（其余 describe 块同样处理）

- [ ] **Step 4: 运行所有修改的测试，确认 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
npx vitest run \
  packages/brain/src/workflows/__tests__/harness-gan.graph.test.js \
  packages/brain/src/workflows/__tests__/harness-gan-convergence.test.js \
  2>&1 | tail -30
# Expected: PASS（convergence 测试 + proposer task-plan 访问测试全绿）
```

- [ ] **Step 5: 提交 Task 4**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
git add packages/brain/src/workflows/__tests__/harness-gan.graph.test.js \
        packages/brain/src/workflows/__tests__/harness-gan-convergence.test.js \
        packages/brain/src/workflows/__tests__/harness-gan-async.test.js
git commit -m "test(harness): B44 — 取消 WS3 async skip，改用阻塞 executor mock"
```

---

### Task 5: 跑全量 brain 测试，确认无回归

**Files:** 无新文件（验证步骤）

- [ ] **Step 1: 运行 brain 包完整测试**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
npx vitest run packages/brain/ 2>&1 | tail -50
# Expected: 全部 PASS（允许已有 skip 测试）
```

- [ ] **Step 2: 如果有 FAIL，定位根因并修复**

常见问题：
- 如果 `harness-gan-async.test.js` 中有 `proposerSpawnNode`/`reviewerSpawnNode` 的测试仍在运行（没有正确 skip），需要确认 Task 4 Step 3 的 skip 已生效
- 如果 `harness-thread-lookup.test.js` FAIL，检查 mock 路径是否与实际 import 路径匹配

- [ ] **Step 3: 写 Learning 文件**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
mkdir -p docs/learnings
```

新建文件 `docs/learnings/cp-0530234353-B44-harness-sync-fix.md`：

```markdown
# B44 — GAN async 回退：propose_branch 丢失导致 pipeline 全卡

### 根本原因

WS3 将 GAN proposer/reviewer 改为 `spawnDockerDetached + interrupt`（异步）后，
`runGanContractGraph` 在第一次 interrupt 就立即 return `{kickoff: true}`，
不等 GAN 完成。下游 `inferTaskPlanNode` 从 `ganResult.propose_branch` 读取
（此时为 undefined/null），`fetchAndShowOriginFile` 找不到 propose_branch，
`upsertTaskPlan(null)` 抛错，所有 initiative 任务失败。

### 根本设计问题

WS3 设计假设 Brain 可以通过 callback resume 推进 GAN，但这要求：
1. Docker 容器调 `/api/brain/harness/callback/${containerId}` 
2. `harness-thread-lookup.js` 能找到对应 graph 和 threadId
3. 居然还需要 `harness-initiative` graph 在 thread_lookup 能映射到正确的图

这三个假设在当前 Brain 版本都未完全打通（callback URL 注入、graph cache、
compileHarnessInitiativeGraph vs compileHarnessFullGraph 混用）。

### 下次预防

- [ ] 在修改同步→异步时，必须同时验证 `ganResult.propose_branch` 非空（集成测试）
- [ ] WS3 类异步改造，必须同时更新 `harness-thread-lookup.js` 的 dispatch case
- [ ] 异步节点的 callback URL 必须在真实 Docker 环境 smoke test 验证
- [ ] `runGanContractGraph` 的返回形状变更必须有专项测试覆盖（propose_branch 字段）
```

- [ ] **Step 4: 提交 Learning + 最终验证**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
git add docs/learnings/cp-0530234353-B44-harness-sync-fix.md
git commit -m "docs: B44 Learning — GAN async 回退教训"
```

---

### Task 6: Brain 版本 bump + push + PR

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`（自动更新）

- [ ] **Step 1: Brain 版本 bump**

查看当前版本：

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
cat packages/brain/package.json | grep '"version"'
# 记下当前版本如 "1.229.0"
```

Patch bump（修复类）：

```bash
cd packages/brain && npm version patch --no-git-tag-version && cd ../..
# Expected: 输出新版本如 v1.229.1
```

- [ ] **Step 2: 提交版本 bump**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
git add packages/brain/package.json packages/brain/package-lock.json
git commit -m "chore(brain): version bump for B44 fix"
```

- [ ] **Step 3: push 分支**

```bash
cd /Users/administrator/worktrees/cecelia/B44-harness-sync-fix
git push -u origin cp-0530234353-B44-harness-sync-fix
```

- [ ] **Step 4: 创建 PR**

```bash
gh pr create \
  --title "fix(harness): B44 — GAN 改回同步，修复 propose_branch 丢失导致 pipeline 全卡" \
  --body "## 根因
WS3 async GAN 改造让 runGanContractGraph 在第一次 interrupt 立即返回 {kickoff:true}，
ganResult.propose_branch=undefined，inferTaskPlanNode 找不到 task-plan.json，upsertTaskPlan(null) 抛错。

## 三处修复
1. **harness-gan.graph.js**: proposer/reviewer 改回阻塞 executor，runGanContractGraph 同步等 finalState
2. **harness-thread-lookup.js**: harness-initiative case 改用 compileHarnessFullGraph
3. **harness-initiative.graph.js**: runPlannerNode prompt 删除矛盾的 task-plan.json 输出要求

## 测试
- 新增 harness-thread-lookup.test.js 验证 compileHarnessFullGraph 被调用
- 新增 harness-initiative-b44-planner-prompt.test.js 验证 prompt 无矛盾
- 取消 WS3 async skip 的收敛测试，改用阻塞 executor mock"
```

---

## 文件变更总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/brain/src/workflows/harness-gan.graph.js` | 修改 | proposer/reviewer 改回阻塞；runGanContractGraph 同步；删除 WS3 async 函数 |
| `packages/brain/src/lib/harness-thread-lookup.js` | 修改 | harness-initiative 映射到 compileHarnessFullGraph；harness-gan case 简化 |
| `packages/brain/src/workflows/harness-initiative.graph.js` | 修改 | runPlannerNode prompt 删除矛盾的 task-plan.json 输出要求 |
| `packages/brain/src/lib/__tests__/harness-thread-lookup.test.js` | 新建 | B44 regression test |
| `packages/brain/src/workflows/__tests__/harness-initiative-b44-planner-prompt.test.js` | 新建 | B44 regression test |
| `packages/brain/src/workflows/__tests__/harness-gan.graph.test.js` | 修改 | 取消 WS3 async skip |
| `packages/brain/src/workflows/__tests__/harness-gan-convergence.test.js` | 修改 | 取消 WS3 async skip |
| `packages/brain/src/workflows/__tests__/harness-gan-async.test.js` | 修改 | 全部 skip（WS3 已回退） |
| `docs/learnings/cp-0530234353-B44-harness-sync-fix.md` | 新建 | Learning 文档 |
| `packages/brain/package.json` | 修改 | patch version bump |
