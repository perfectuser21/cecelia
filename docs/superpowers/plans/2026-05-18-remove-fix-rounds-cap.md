# Remove Fix-Rounds Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 harness pipeline 两处 fix-round 上限，让 agent 无限重试直至修好。

**Architecture:** 改动仅在 `harness-initiative.graph.js` 一个文件。`finalEvaluateDispatchNode`（active 路径）的两个互斥 FAIL 分支合并为一个无上限重试；`routeAfterEvaluate`（dead code）同步清理；`MAX_FIX_ROUNDS` 常量删除。

**Tech Stack:** Node.js / LangGraph / Vitest

---

## 文件清单

| 文件 | 操作 |
|------|------|
| `packages/brain/src/__tests__/harness-initiative-evaluate.test.js` | 修改（更新 2 个测试 + 新增 1 个）|
| `packages/brain/src/workflows/harness-initiative.graph.js` | 修改（删常量 + 3 处逻辑变更）|

---

## Task 1: 写失败测试（TDD Red 阶段）

**NO PRODUCTION CODE WITHOUT FAILING TEST FIRST**

**Files:**
- Modify: `packages/brain/src/__tests__/harness-initiative-evaluate.test.js`

- [ ] **Step 1: 更新 `routeAfterEvaluate` 的 terminal_fail 测试**

  找到第 264 行的测试（`'FAIL + count >= 3 → terminal_fail'`），改成期望 `'retry'`：

  ```js
  it('FAIL + count >= 3 → retry (no cap)', () => {
    const state = {
      evaluate_verdict: 'FAIL',
      task_loop_index: 0,
      task_loop_fix_count: 3,
      taskPlan: { tasks: [{ id: 't1' }] },
    };
    expect(routeAfterEvaluate(state)).toBe('retry');
  });
  ```

- [ ] **Step 2: 更新 `finalEvaluateDispatchNode` 的 >= MAX 终止测试**

  找到第 508 行的测试（`'FAIL + final_e2e_fix_count=3 (>= MAX) → returns error'`），改成期望继续重试：

  ```js
  it('FAIL + final_e2e_fix_count=3 (>= old MAX) → continues retrying (no cap)', async () => {
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

    const result = await finalEvaluateDispatchNode(state, {
      executor: mockSpawnFn,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
    });

    expect(result.error).toBeUndefined();
    expect(result.final_e2e_verdict).toBe('FAIL');
    expect(result.final_e2e_fix_count).toBe(4);
    expect(result.task_loop_index).toBe(0);
  });
  ```

- [ ] **Step 3: 新增高轮次无上限测试**

  在同一 `describe('finalEvaluateDispatchNode — fix loop')` 块末尾追加：

  ```js
  it('FAIL + final_e2e_fix_count=10 → continues retrying (count becomes 11)', async () => {
    const mockSpawnFn = vi.fn().mockResolvedValue({
      exit_code: 1,
      timed_out: false,
      stderr: 'still failing',
    });

    const state = {
      final_e2e_fix_count: 10,
      task_loop_index: 0,
      task: { id: 'task-1', payload: { sprint_dir: 'sprints' } },
      taskPlan: { journey_type: 'autonomous' },
      worktreePath: '/tmp/wt',
      sub_tasks: [],
      initiativeId: 'init-1',
      githubToken: 'tok',
    };

    const result = await finalEvaluateDispatchNode(state, {
      executor: mockSpawnFn,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
    });

    expect(result.error).toBeUndefined();
    expect(result.final_e2e_fix_count).toBe(11);
    expect(result.task_loop_index).toBe(0);
  });
  ```

- [ ] **Step 4: 同时更新 `finalEvaluateDispatchNode` 第 461 行测试的描述（去掉 "< MAX 3"）**

  找到：
  ```js
  it('FAIL + final_e2e_fix_count=2 (< MAX 3) → returns fix_count:3 + task_loop_index:0', async () => {
  ```
  改为：
  ```js
  it('FAIL + final_e2e_fix_count=2 → returns fix_count:3 + task_loop_index:0', async () => {
  ```
  （行为不变，只改描述字符串，去掉 "(< MAX 3)" 注释）

- [ ] **Step 5: 运行测试，确认 RED**

  ```bash
  cd /Users/administrator/worktrees/cecelia/remove-fix-rounds-cap/packages/brain
  npx vitest run src/__tests__/harness-initiative-evaluate.test.js --reporter=verbose 2>&1 | tail -30
  ```

  期望：2-3 个测试 FAIL（`routeAfterEvaluate FAIL + count >= 3` 和 `finalEvaluateDispatchNode FAIL + count=3`），其余通过。

- [ ] **Step 6: Commit（Red 阶段）**

  ```bash
  cd /Users/administrator/worktrees/cecelia/remove-fix-rounds-cap
  git add packages/brain/src/__tests__/harness-initiative-evaluate.test.js
  git commit -m "test(brain): RED — remove fix-rounds cap: expect unlimited retries

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  ```

---

## Task 2: 实现变更（TDD Green 阶段）

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`

- [ ] **Step 1: 删除 `MAX_FIX_ROUNDS` 常量（Line 51）**

  找到：
  ```js
  const MAX_FIX_ROUNDS = 3; // fix_round > 3 → phase='failed'（PRD §6.3）
  ```
  删除整行。

- [ ] **Step 2: 更新 `terminalFailNode` reason 字符串（Line 1340）**

  找到：
  ```js
  const reason = `Evaluator FAIL after ${MAX_FIX_ROUNDS} retries on task index ${state.task_loop_index ?? 0}: ${(state.evaluate_feedback || '').slice(0, 300)}`;
  ```
  改为：
  ```js
  const reason = `Evaluator FAIL on task index ${state.task_loop_index ?? 0}: ${(state.evaluate_feedback || '').slice(0, 300)}`;
  ```

- [ ] **Step 3: 移除 `routeAfterEvaluate` 中的 terminal_fail 分支（Line 1373）**

  找到：
  ```js
  // FAIL (or null/unexpected verdict — treated as FAIL to prevent silent skip)
  if (fixCount >= MAX_FIX_ROUNDS) return 'terminal_fail';
  return 'retry';
  ```
  改为：
  ```js
  // FAIL (or null/unexpected verdict — treated as FAIL to prevent silent skip)
  return 'retry';
  ```

- [ ] **Step 4: 合并 `finalEvaluateDispatchNode` FAIL 分支（Lines 1502-1512）**

  找到：
  ```js
  const fixRound = state.final_e2e_fix_count ?? 0;

  // FAIL + fix rounds 未耗尽 → 重置 task_loop_index，routing 函数送回 pick_sub_task
  if (verdictDelta.final_e2e_verdict === 'FAIL' && fixRound < MAX_FIX_ROUNDS) {
    return { ...verdictDelta, final_e2e_fix_count: fixRound + 1, task_loop_index: 0 };
  }

  // FAIL + fix rounds 用尽 → 自动标 failed，不等人工介入
  if (verdictDelta.final_e2e_verdict === 'FAIL' && fixRound >= MAX_FIX_ROUNDS) {
    return { ...verdictDelta, error: { node: 'final_evaluate', message: `Final E2E 已重试 ${fixRound} 次仍失败，自动终止` } };
  }
  ```
  改为：
  ```js
  const fixRound = state.final_e2e_fix_count ?? 0;

  // FAIL → 始终重试，无上限
  if (verdictDelta.final_e2e_verdict === 'FAIL') {
    return { ...verdictDelta, final_e2e_fix_count: fixRound + 1, task_loop_index: 0 };
  }
  ```

- [ ] **Step 5: 运行测试，确认 GREEN**

  ```bash
  cd /Users/administrator/worktrees/cecelia/remove-fix-rounds-cap/packages/brain
  npx vitest run src/__tests__/harness-initiative-evaluate.test.js --reporter=verbose 2>&1 | tail -20
  ```

  期望：所有测试 PASS，含：
  - `routeAfterEvaluate > FAIL + count >= 3 → retry (no cap)` ✅
  - `finalEvaluateDispatchNode > FAIL + final_e2e_fix_count=3 (>= old MAX) → continues retrying` ✅
  - `finalEvaluateDispatchNode > FAIL + final_e2e_fix_count=10 → continues retrying (count becomes 11)` ✅

- [ ] **Step 6: 运行全套 brain 测试，确认无回归**

  ```bash
  cd /Users/administrator/worktrees/cecelia/remove-fix-rounds-cap/packages/brain
  NODE_OPTIONS="--max-old-space-size=3072" npx vitest run 2>&1 | tail -15
  ```

  期望：`Tests X passed`，无 FAIL。

- [ ] **Step 7: 确认 MAX_FIX_ROUNDS 已无残留引用**

  ```bash
  grep -rn "MAX_FIX_ROUNDS" /Users/administrator/worktrees/cecelia/remove-fix-rounds-cap/packages/brain/src/
  ```

  期望：无输出（零残留）。

- [ ] **Step 8: Commit（Green 阶段）**

  ```bash
  cd /Users/administrator/worktrees/cecelia/remove-fix-rounds-cap
  git add packages/brain/src/workflows/harness-initiative.graph.js
  git commit -m "fix(brain): 移除 harness fix-round 上限，无限重试直至成功

  - 删除 MAX_FIX_ROUNDS=3 常量
  - finalEvaluateDispatchNode: FAIL 始终重试（合并两 if 为一）
  - routeAfterEvaluate: 移除 terminal_fail 分支（dead code 清理）
  - terminalFailNode reason 字符串去掉字面量 MAX_FIX_ROUNDS 引用

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  ```
