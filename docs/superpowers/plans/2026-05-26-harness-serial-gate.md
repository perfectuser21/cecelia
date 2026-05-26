# Harness Serial Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `advanceTaskIndexNode` 加 merge gate，防止上一个 WS 的 PR 未 merged 时 initiative 推进到下一个 WS。

**Architecture:** `advanceTaskIndexNode` 读取 `state.sub_tasks` 的最后一项，若 status !== 'merged' 则返回 `{error: {...}}`。已有的 `routeFromPickSubTask → if (state.error) return 'end'` 路径会自动路由到 END，`computeHarnessInitiativeOk` 检查 `final.error` 决定任务失败。无需修改图结构。

**Tech Stack:** Node.js ESM, vitest, `packages/brain/src/workflows/harness-initiative.graph.js`

---

## File Map

| 文件 | 操作 | 职责 |
|---|---|---|
| `packages/brain/src/__tests__/harness-serial-gate.test.js` | 新建 | regression test：advanceTaskIndexNode merge gate |
| `packages/brain/src/workflows/harness-initiative.graph.js` | 修改 `advanceTaskIndexNode`（第 1443 行） | 加 merge gate 检查 |

---

### Task 1: 写 failing regression test

**Files:**
- Create: `packages/brain/src/__tests__/harness-serial-gate.test.js`

- [ ] **Step 1: 创建测试文件**

路径：`packages/brain/src/__tests__/harness-serial-gate.test.js`

内容：

```js
import { describe, it, expect } from 'vitest';
import { advanceTaskIndexNode } from '../workflows/harness-initiative.graph.js';

describe('advanceTaskIndexNode — serial merge gate', () => {
  it('上一个 sub-task status=failed → 返回 error，不递增 index', async () => {
    const state = {
      task_loop_index: 1,
      sub_tasks: [{ id: 'ws1', status: 'failed' }],
    };
    const result = await advanceTaskIndexNode(state);
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('advance');
    expect(result.error.message).toContain('ws1');
    expect(result.task_loop_index).toBeUndefined();
  });

  it('上一个 sub-task status=undefined → 返回 error', async () => {
    const state = {
      task_loop_index: 0,
      sub_tasks: [{ id: 'ws2', status: undefined }],
    };
    const result = await advanceTaskIndexNode(state);
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('advance');
    expect(result.error.message).toContain('ws2');
  });

  it('上一个 sub-task status=timeout → 返回 error', async () => {
    const state = {
      task_loop_index: 0,
      sub_tasks: [{ id: 'ws1', status: 'timeout' }],
    };
    const result = await advanceTaskIndexNode(state);
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('advance');
  });

  it('上一个 sub-task status=merged → 正常递增 index，无 error', async () => {
    const state = {
      task_loop_index: 0,
      sub_tasks: [{ id: 'ws1', status: 'merged' }],
    };
    const result = await advanceTaskIndexNode(state);
    expect(result.error).toBeUndefined();
    expect(result.task_loop_index).toBe(1);
    expect(result.task_loop_fix_count).toBe(0);
    expect(result.evaluate_verdict).toBeNull();
    expect(result.evaluate_feedback).toBeNull();
  });

  it('sub_tasks 为空（防御性）→ 正常递增，无 error', async () => {
    const state = {
      task_loop_index: 0,
      sub_tasks: [],
    };
    const result = await advanceTaskIndexNode(state);
    expect(result.error).toBeUndefined();
    expect(result.task_loop_index).toBe(1);
  });
});
```

- [ ] **Step 2: 确认测试目前 FAIL**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-serial-gate
npx vitest run packages/brain/src/__tests__/harness-serial-gate.test.js 2>&1 | tail -20
```

期望输出：测试 FAIL（4 个用例失败，因为 `advanceTaskIndexNode` 尚无 merge gate）。  
`上一个 sub-task status=merged → 正常递增` 这个用例此时应 PASS（现有逻辑就能通过）。

- [ ] **Step 3: commit-1（failing test）**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-serial-gate
git add packages/brain/src/__tests__/harness-serial-gate.test.js
git commit -m "test(harness): add failing regression test for serial merge gate"
```

---

### Task 2: 实现 merge gate

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:1443-1450`

- [ ] **Step 1: 修改 advanceTaskIndexNode**

找到文件中 `advanceTaskIndexNode` 函数（约第 1443 行）：

当前代码：
```js
export async function advanceTaskIndexNode(state) {
  return {
    task_loop_index: (state.task_loop_index ?? 0) + 1,
    task_loop_fix_count: 0,
    evaluate_verdict: null,
    evaluate_feedback: null,
  };
}
```

替换为：
```js
export async function advanceTaskIndexNode(state) {
  // Serial merge gate: 上一个 sub-task 必须 merged 才能推进到下一个 WS
  const subTasks = state.sub_tasks || [];
  if (subTasks.length > 0) {
    const lastTask = subTasks[subTasks.length - 1];
    if (lastTask && lastTask.status !== 'merged') {
      return {
        error: {
          node: 'advance',
          message: `Serial gate: sub-task ${lastTask.id} did not merge (status=${lastTask.status ?? 'undefined'}). Next workstream blocked.`,
        },
      };
    }
  }
  return {
    task_loop_index: (state.task_loop_index ?? 0) + 1,
    task_loop_fix_count: 0,
    evaluate_verdict: null,
    evaluate_feedback: null,
  };
}
```

- [ ] **Step 2: 确认所有测试 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-serial-gate
npx vitest run packages/brain/src/__tests__/harness-serial-gate.test.js 2>&1 | tail -20
```

期望输出：全部 5 个用例 PASS。

- [ ] **Step 3: 跑 harness-initiative 相关测试，确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-serial-gate
npx vitest run packages/brain/src/__tests__/harness-initiative-executor-writeback.test.js packages/brain/src/__tests__/executor-harness-initiative-ok.test.js packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js 2>&1 | tail -30
```

期望输出：全 PASS（或 skip）。如有 FAIL，检查是否是因为现有测试 mock 了 `sub_tasks` 为空 —— 空 `sub_tasks` 已在 gate 里防御（`subTasks.length > 0` 时才检查），不应有影响。

- [ ] **Step 4: commit-2（fix implementation）**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-serial-gate
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(harness): advanceTaskIndexNode 加串行 merge gate — 阻止 WS N+1 在 WS N 未合并时启动"
```

---

### Task 3: 写 Learning 文件 + 验证 DoD

**Files:**
- Create: `docs/learnings/cp-0526145940-fix-harness-serial-gate.md`

- [ ] **Step 1: 创建 Learning 文件**

路径：`docs/learnings/cp-0526145940-fix-harness-serial-gate.md`

内容：
```markdown
# Learning: Harness Serial Gate — advanceTaskIndexNode merge 检查

**PR 分支**: cp-0526145940-fix-harness-serial-gate

### 根本原因

`advanceTaskIndexNode` 无条件递增 `task_loop_index`，不检查上一个 sub-task 是否真正 merged。
当 WS N 子图因任何原因（no_pr / timeout / failed / status:undefined）提前结束时，
initiative 照样推进到 WS N+1，导致"并行"开出多个 WS 的 PR。

### 下次预防

- [ ] 所有「串行推进」节点上线前必须有 merge gate test
- [ ] `advanceTaskIndexNode` 同等语义的新节点必须加同等 gate
- [ ] sub-task sub-graph 早退路径（no_pr/timeout）增加 status 明确赋值，避免 `status:undefined` 带来的歧义
```

- [ ] **Step 2: 检查 DoD 文件是否存在**

如果 sprint-prd.md 或 DoD 文件存在于 sprints 目录，跳过此步。本次是纯 bug fix，DoD 内联在 PR 描述里即可。

- [ ] **Step 3: 全量 brain-unit 快速验证**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-serial-gate
npx vitest run packages/brain/src/__tests__/ --reporter=verbose 2>&1 | grep -E "FAIL|PASS|Tests" | tail -10
```

期望：所有 PASS，0 FAIL。

- [ ] **Step 4: commit learning**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-serial-gate
git add docs/learnings/cp-0526145940-fix-harness-serial-gate.md
git commit -m "docs: learning for cp-0526145940-fix-harness-serial-gate"
```

- [ ] **Step 5: push + 开 PR**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-serial-gate
git push -u origin cp-0526145940-fix-harness-serial-gate
gh pr create \
  --title "fix(harness): advanceTaskIndexNode 加串行 merge gate — 防止 WS N+1 在 WS N 未合并时启动" \
  --body "$(cat <<'EOF'
## Summary

- **根因**: `advanceTaskIndexNode` 无 merge gate，WS N 子图以 `status: undefined/failed/timeout` 结束时，initiative 照样推进到 WS N+1
- **实证**: WS2 以 `status:undefined, pr_url:none` 结束，WS3 仍被 pick 并开出 PR，违反串行语义
- **修法**: 在 `advanceTaskIndexNode` 头部检查 `state.sub_tasks` 最后一项的 status；非 merged 则返回 `{error: ...}`，借助已有 `routeFromPickSubTask → 'end'` 路径终止 initiative

## Changes

- `packages/brain/src/workflows/harness-initiative.graph.js`: `advanceTaskIndexNode` 加 5 行 merge gate
- `packages/brain/src/__tests__/harness-serial-gate.test.js`: 5 个 regression test

## Test plan

- [x] `harness-serial-gate.test.js` 全 PASS
- [x] 既有 harness-initiative 测试无回归
- [x] brain-unit CI 全绿

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
