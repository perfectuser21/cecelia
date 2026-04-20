# Harness v2 `harness_task` Container Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `harness_task` 类型的 Task 通过 Docker 容器跑 `/harness-generator`（复用 PR-1 的 worktree + GITHUB_TOKEN），而不是落到默认 bridge 派发。

**Architecture:** 新增 `harness-task-dispatch.js` 封装容器派发；`executor.js` 的 `triggerCeceliaRun` 入口早期加 `harness_task` 分支调它。

**Tech Stack:** Node.js ESM + vitest + `ensureHarnessWorktree` / `resolveGitHubToken`（PR-1 已并入 main）

---

## File Structure

**Create:**
- `packages/brain/src/harness-task-dispatch.js` — `triggerHarnessTaskDispatch`
- `packages/brain/src/__tests__/harness-task-dispatch.test.js`

**Modify:**
- `packages/brain/src/executor.js` — 在 `triggerCeceliaRun(task)` 的 `harness_initiative` 分支附近加 `harness_task` 分支（≤10 行）

---

### Task 1: harness-task-dispatch.js — 容器派发函数

**Files:**
- Create: `packages/brain/src/harness-task-dispatch.js`
- Test: `packages/brain/src/__tests__/harness-task-dispatch.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/brain/src/__tests__/harness-task-dispatch.test.js
import { describe, it, expect, vi } from 'vitest';

describe('triggerHarnessTaskDispatch', () => {
  function baseTask(overrides = {}) {
    return {
      id: 'task-abcdef1234567890',
      task_type: 'harness_task',
      title: 'impl ws1',
      description: 'write schema file',
      payload: {
        parent_task_id: 'initiative-xxx',
        logical_task_id: 'ws1',
        dod: ['[ARTIFACT] schema.ts exists'],
        files: ['packages/brain/src/schema.ts'],
        fix_mode: false,
      },
      ...overrides,
    };
  }

  it('passes worktreePath + env.GITHUB_TOKEN to executor', async () => {
    let captured = null;
    const deps = {
      executor: async (opts) => {
        captured = opts;
        return { exit_code: 0, stdout: '{"result":"ok"}', stderr: '', timed_out: false };
      },
      ensureWorktree: async ({ taskId }) => `/tmp/wt/harness-v2/task-${String(taskId).slice(0, 8)}`,
      resolveToken: async () => 'ghs_test',
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    const res = await triggerHarnessTaskDispatch(baseTask(), deps);
    expect(res.success).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured.worktreePath).toContain('harness-v2');
    expect(captured.env.GITHUB_TOKEN).toBe('ghs_test');
    expect(captured.env.CECELIA_TASK_TYPE).toBe('harness_task');
    expect(captured.env.HARNESS_NODE).toBe('generator');
    expect(captured.env.HARNESS_INITIATIVE_ID).toBe('initiative-xxx');
    expect(captured.env.HARNESS_TASK_ID).toBe('task-abcdef1234567890');
  });

  it('maps payload.fix_mode=true to env.HARNESS_FIX_MODE=true', async () => {
    let captured = null;
    const deps = {
      executor: async (opts) => { captured = opts; return { exit_code: 0, stdout: '', stderr: '', timed_out: false }; },
      ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
      resolveToken: async () => 'ghs_test',
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    await triggerHarnessTaskDispatch(baseTask({ payload: { parent_task_id: 'i', fix_mode: true } }), deps);
    expect(captured.env.HARNESS_FIX_MODE).toBe('true');
  });

  it('maps missing/false fix_mode to env.HARNESS_FIX_MODE=false', async () => {
    let captured = null;
    const deps = {
      executor: async (opts) => { captured = opts; return { exit_code: 0, stdout: '', stderr: '', timed_out: false }; },
      ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
      resolveToken: async () => 'ghs_test',
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    await triggerHarnessTaskDispatch(baseTask({ payload: { parent_task_id: 'i' } }), deps);
    expect(captured.env.HARNESS_FIX_MODE).toBe('false');
  });

  it('returns {success:false} when token resolver fails, without spawning', async () => {
    const exec = vi.fn();
    const deps = {
      executor: exec,
      ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
      resolveToken: async () => { throw new Error('github_token_unavailable'); },
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    const res = await triggerHarnessTaskDispatch(baseTask(), deps);
    expect(res.success).toBe(false);
    expect(String(res.error || '')).toMatch(/github_token_unavailable/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('returns {success:false} when worktree creation fails, without spawning', async () => {
    const exec = vi.fn();
    const deps = {
      executor: exec,
      ensureWorktree: async () => { throw new Error('worktree add failed'); },
      resolveToken: async () => 'ghs_test',
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    const res = await triggerHarnessTaskDispatch(baseTask(), deps);
    expect(res.success).toBe(false);
    expect(String(res.error || '')).toMatch(/worktree add failed/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('returns {success:false} when container exit_code != 0', async () => {
    const deps = {
      executor: async () => ({ exit_code: 1, stdout: 'oops', stderr: 'bang', timed_out: false }),
      ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
      resolveToken: async () => 'ghs_test',
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    const res = await triggerHarnessTaskDispatch(baseTask(), deps);
    expect(res.success).toBe(false);
    expect(String(res.error || '')).toMatch(/exit_code|bang/);
  });

  it('returns {success:true} when container exit_code === 0', async () => {
    const deps = {
      executor: async () => ({ exit_code: 0, stdout: '{"ok":true}', stderr: '', timed_out: false }),
      ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
      resolveToken: async () => 'ghs_test',
    };
    const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
    const res = await triggerHarnessTaskDispatch(baseTask(), deps);
    expect(res.success).toBe(true);
    expect(res.result).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-task-dispatch.test.js`
Expected: FAIL — "Cannot find module '../harness-task-dispatch.js'"

- [ ] **Step 3: Write minimal implementation**

```js
// packages/brain/src/harness-task-dispatch.js
import { ensureHarnessWorktree as defaultEnsureWorktree } from './harness-worktree.js';
import { resolveGitHubToken as defaultResolveToken } from './harness-credentials.js';

/**
 * Phase B dispatcher：把 harness_task 派到 Docker 容器跑 /harness-generator。
 *
 * @param {object} task                   {id, task_type, title, description, payload}
 * @param {object} [deps]
 * @param {Function} [deps.executor]      默认 dynamic import './docker-executor.js'.executeInDocker
 * @param {Function} [deps.ensureWorktree]
 * @param {Function} [deps.resolveToken]
 * @returns {Promise<{success, result?, cost_usd?, error?}>}
 */
export async function triggerHarnessTaskDispatch(task, deps = {}) {
  const ensureWorktree = deps.ensureWorktree || defaultEnsureWorktree;
  const resolveToken = deps.resolveToken || defaultResolveToken;
  const executor = deps.executor || (async (opts) => {
    const mod = await import('./docker-executor.js');
    return mod.executeInDocker(opts);
  });

  const payload = task.payload || {};
  const initiativeId = payload.parent_task_id || payload.initiative_id || task.id;
  const fixMode = payload.fix_mode === true;

  let worktreePath;
  let token;
  try {
    worktreePath = await ensureWorktree({ taskId: task.id, initiativeId });
    token = await resolveToken();
  } catch (err) {
    console.error(`[harness-task-dispatch] prep failed task=${task.id}: ${err.message}`);
    return { success: false, error: err.message };
  }

  const prompt = buildGeneratorPrompt(task, { fixMode });

  let result;
  try {
    result = await executor({
      task: { ...task, task_type: 'harness_task' },
      prompt,
      worktreePath,
      env: {
        CECELIA_CREDENTIALS: 'account1',
        CECELIA_TASK_TYPE: 'harness_task',
        HARNESS_NODE: 'generator',
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_TASK_ID: task.id,
        HARNESS_FIX_MODE: fixMode ? 'true' : 'false',
        GITHUB_TOKEN: token,
      },
    });
  } catch (err) {
    console.error(`[harness-task-dispatch] spawn failed task=${task.id}: ${err.message}`);
    return { success: false, error: err.message };
  }

  if (!result || result.exit_code !== 0) {
    const detail = result?.stderr?.slice(0, 500) || `exit_code=${result?.exit_code}`;
    return { success: false, error: `container failed: ${detail}` };
  }

  return {
    success: true,
    result: result.stdout,
    cost_usd: result.cost_usd,
  };
}

function buildGeneratorPrompt(task, { fixMode }) {
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

Run: `cd packages/brain && npx vitest run src/__tests__/harness-task-dispatch.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-task-dispatch
git add packages/brain/src/harness-task-dispatch.js packages/brain/src/__tests__/harness-task-dispatch.test.js
git commit -m "feat(harness-v2): add triggerHarnessTaskDispatch for container-based Phase B

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: executor.js — 加 harness_task 分支

**Files:**
- Modify: `packages/brain/src/executor.js` — 在 `triggerCeceliaRun(task)` 的 `harness_initiative` 分支（约 line 2807）之后加 `harness_task` 分支

- [ ] **Step 1: Locate existing `harness_initiative` branch**

Run: `grep -n "harness_initiative" packages/brain/src/executor.js | head -5`
Expected: 看到 `if (task.task_type === 'harness_initiative')` 分支，记住文件第几行。

- [ ] **Step 2: Edit executor.js**

在现有 `harness_initiative` 分支闭合 `}` 之后，插入：

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

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-task-dispatch.test.js src/__tests__/harness-initiative-runner-phase-c.test.js 2>&1 | tail -15`
Expected: 7 + 17 = 24 PASS，无回归。

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-task-dispatch
git add packages/brain/src/executor.js
git commit -m "feat(harness-v2): executor route harness_task to container dispatch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Learning 文档 + DoD 勾选

**Files:**
- Create: `docs/learnings/cp-0420175006-harness-v2-task-dispatch.md`
- Modify: `docs/superpowers/specs/2026-04-20-harness-v2-task-dispatch-design.md` 勾选 `[x]`

- [ ] **Step 1: Write learning**

```markdown
# Harness v2 harness_task 容器派发

### 根本原因
PR-1 只接通了 Planner 的容器路径，Phase B 子 Task 被 Cecelia 默认 dispatcher 派 bridge headless Claude Code，没走 Docker，绕过了 PR-1 的 worktree+GITHUB_TOKEN 成果。task-router 虽写 `/_internal` 占位，executor.js 里其实没 harness_task 显式分支。

### 下次预防
- [ ] 给新 task_type 加 route 时，一定在 executor.js 里补显式分支（而不是依赖默认落位）
- [ ] Phase A/B/C 各阶段的 dispatcher 全链路必须一次讲清，不能只改一段
- [ ] PR 完成后跑一次 "真实 /api/brain/tasks 派一个 harness_task" 验证，而不是只信任单测
```

- [ ] **Step 2: Update spec DoD 勾选**

Edit `docs/superpowers/specs/2026-04-20-harness-v2-task-dispatch-design.md` 下 `## 成功标准` 5 条全部改成 `[x]`。

- [ ] **Step 3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-task-dispatch
git add docs/learnings/cp-0420175006-harness-v2-task-dispatch.md docs/superpowers/specs/2026-04-20-harness-v2-task-dispatch-design.md
git commit -m "docs(harness-v2): learning + DoD [x] for PR-2

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

1. **Spec coverage**：
   - `harness-task-dispatch.js` 新建 → Task 1
   - `executor.js` 分支 → Task 2
   - 7 个单测覆盖 `worktreePath` / `GITHUB_TOKEN` / `HARNESS_FIX_MODE` / helper fail / 容器 exit → Task 1 测试
   - 5 个 DoD [x] → Task 3
2. **Placeholder scan**：无 TBD/TODO。
3. **Type consistency**：`ensureWorktree` / `resolveToken` / `executor` 签名在 Task 1 和 Task 2 一致。

---

## Execution Handoff

Plan 完成。按 /dev 自主规则 Subagent-Driven。
