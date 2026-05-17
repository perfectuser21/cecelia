# Harness v2 Worktree Clone Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** 把 `ensureHarnessWorktree` 从 `git worktree add -b` 改成独立 `git clone`，让容器挂载后所有 git 操作可用。`cleanupHarnessWorktree` 对应改成 `fs.rm`。

**Architecture:** 单文件手术 + 3 测试点替换。

**Tech Stack:** Node.js ESM + vitest + `child_process.execFile` + `fs/promises.rm`

---

### Task 1: harness-worktree.js 独立 clone

**Files:**
- Modify: `packages/brain/src/harness-worktree.js`
- Modify: `packages/brain/src/__tests__/harness-worktree.test.js`

- [ ] **Step 1: 改测试**

用如下替换整个 test 文件内容：

```js
import { describe, it, expect, vi } from 'vitest';
import { ensureHarnessWorktree, cleanupHarnessWorktree } from '../harness-worktree.js';

describe('ensureHarnessWorktree', () => {
  it('returns existing path when dir is a git repo (idempotent)', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (args[0] === '-C' && args[2] === 'rev-parse') return { stdout: 'true\n' };
      return { stdout: '' };
    };
    const statFn = async () => true;

    const p = await ensureHarnessWorktree({
      taskId: 'abcdef1234567890-xxx',
      baseRepo: '/tmp/cec',
      execFn, statFn,
    });
    expect(p).toBe('/tmp/cec/.claude/worktrees/harness-v2/task-abcdef12');
    expect(calls.some(c => c.includes('clone'))).toBe(false);
    expect(calls.some(c => c.includes('worktree add'))).toBe(false);
  });

  it('clones independent repo when dir does not exist', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: '' };
    };
    const statFn = async () => false;

    const p = await ensureHarnessWorktree({
      taskId: 'beefcafe11111111',
      baseRepo: '/tmp/cec',
      execFn, statFn,
    });
    expect(p).toBe('/tmp/cec/.claude/worktrees/harness-v2/task-beefcafe');
    const cloneCall = calls.find(c => c.startsWith('git clone'));
    expect(cloneCall).toBeTruthy();
    expect(cloneCall).toContain('--local');
    expect(cloneCall).toContain('--no-hardlinks');
    expect(cloneCall).toContain('--branch main');
    expect(cloneCall).toContain('--single-branch');
    expect(cloneCall).toContain('/tmp/cec');
    expect(cloneCall).toContain('/tmp/cec/.claude/worktrees/harness-v2/task-beefcafe');
    const checkoutCall = calls.find(c => c.includes('checkout -b'));
    expect(checkoutCall).toBeTruthy();
    expect(checkoutCall).toContain('harness-v2/task-beefcafe');
  });

  it('does not call git worktree add anywhere', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: '' };
    };
    const statFn = async () => false;

    await ensureHarnessWorktree({
      taskId: 'abcdef1234567890',
      baseRepo: '/tmp/cec',
      execFn, statFn,
    });
    expect(calls.some(c => c.includes('worktree add'))).toBe(false);
  });

  it('throws when taskId too short', async () => {
    await expect(ensureHarnessWorktree({
      taskId: 'abc',
      baseRepo: '/tmp/cec',
      execFn: async () => ({ stdout: '' }),
      statFn: async () => false,
    })).rejects.toThrow(/taskId/);
  });

  it('cleans dir and re-clones when dir exists but is not a git repo', async () => {
    const calls = [];
    let rmCalled = false;
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (args[0] === '-C' && args[2] === 'rev-parse') {
        throw new Error('not a git repo');
      }
      return { stdout: '' };
    };
    const statFn = async () => true;
    const rmFn = async () => { rmCalled = true; };

    await ensureHarnessWorktree({
      taskId: 'beefcafe11111111',
      baseRepo: '/tmp/cec',
      execFn, statFn, rmFn,
    });
    expect(rmCalled).toBe(true);
    expect(calls.some(c => c.startsWith('git clone'))).toBe(true);
  });
});

describe('cleanupHarnessWorktree', () => {
  it('calls rmFn with the path', async () => {
    const removed = [];
    await cleanupHarnessWorktree('/tmp/wt/task-xxx', {
      rmFn: async (p) => { removed.push(p); },
    });
    expect(removed).toEqual(['/tmp/wt/task-xxx']);
  });

  it('does not throw when rmFn fails', async () => {
    await expect(cleanupHarnessWorktree('/tmp/wt/missing', {
      rmFn: async () => { throw new Error('nope'); },
    })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试看失败**

```
cd /Users/administrator/worktrees/cecelia/harness-v2-worktree-clone-fix/packages/brain && npx vitest run src/__tests__/harness-worktree.test.js
```

Expected: 失败（现在实现还是 git worktree add + git worktree remove）

- [ ] **Step 3: 改实现**

替换 `packages/brain/src/harness-worktree.js` 整个内容为：

```js
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, rm } from 'node:fs/promises';
import path from 'node:path';

const execFile = promisify(execFileCb);

const DEFAULT_BASE_REPO = '/Users/administrator/perfect21/cecelia';

async function defaultStat(p) {
  try { await stat(p); return true; } catch { return false; }
}

function defaultExec(cmd, args, opts = {}) {
  return execFile(cmd, args, { timeout: 60_000, ...opts });
}

async function defaultRm(p) {
  await rm(p, { recursive: true, force: true });
}

function shortId(taskId) {
  if (!taskId || String(taskId).length < 8) {
    throw new Error(`ensureHarnessWorktree: taskId must be ≥8 chars, got ${taskId}`);
  }
  return String(taskId).slice(0, 8);
}

/**
 * 幂等创建/复用 Harness v2 专属独立 git clone。
 *
 * 目录：<baseRepo>/.claude/worktrees/harness-v2/task-<shortid>
 * 分支：harness-v2/task-<shortid>（基于 main）
 *
 * 用独立 clone 而非 git worktree add，避免容器内 .git 指针无法解析的问题。
 */
export async function ensureHarnessWorktree(opts) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  const execFn = opts.execFn || defaultExec;
  const statFn = opts.statFn || defaultStat;
  const rmFn = opts.rmFn || defaultRm;

  const sid = shortId(opts.taskId);
  const branch = `harness-v2/task-${sid}`;
  const wtPath = path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${sid}`);

  if (await statFn(wtPath)) {
    try {
      const { stdout } = await execFn('git', ['-C', wtPath, 'rev-parse', '--is-inside-work-tree']);
      if (String(stdout || '').trim() === 'true') return wtPath;
    } catch { /* not a git repo, fall through to cleanup + re-clone */ }
    await rmFn(wtPath);
  }

  await execFn('git', [
    'clone', '--local', '--no-hardlinks',
    '--branch', 'main', '--single-branch',
    baseRepo, wtPath,
  ]);
  await execFn('git', ['-C', wtPath, 'checkout', '-b', branch]);
  return wtPath;
}

/**
 * 移除 Harness v2 独立 clone；幂等（不存在不抛）。
 */
export async function cleanupHarnessWorktree(wtPath, opts = {}) {
  const rmFn = opts.rmFn || defaultRm;
  try {
    await rmFn(wtPath);
  } catch { /* idempotent */ }
}
```

- [ ] **Step 4: 跑测试看通过**

```
cd /Users/administrator/worktrees/cecelia/harness-v2-worktree-clone-fix/packages/brain && npx vitest run src/__tests__/harness-worktree.test.js
```

Expected: 7 PASS (5 ensureHarnessWorktree + 2 cleanupHarnessWorktree)

- [ ] **Step 5: 回归测 PR-1/2/3/4 相关测试**

```
cd /Users/administrator/worktrees/cecelia/harness-v2-worktree-clone-fix/packages/brain && npx vitest run \
  src/__tests__/harness-credentials.test.js \
  src/__tests__/harness-worktree.test.js \
  src/__tests__/harness-initiative-runner-container-mount.test.js \
  src/__tests__/harness-initiative-runner-gan.test.js \
  src/__tests__/harness-initiative-runner-phase-c.test.js \
  src/__tests__/harness-task-dispatch.test.js \
  src/__tests__/harness-phase-advancer.test.js \
  src/__tests__/harness-gan-loop.test.js \
  2>&1 | tail -15
```

Expected: 全绿（5+7+2+2+17+7+7+5 = 52 PASS）

- [ ] **Step 6: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-worktree-clone-fix
git add packages/brain/src/harness-worktree.js packages/brain/src/__tests__/harness-worktree.test.js
git commit -m "fix(harness-v2): use independent git clone instead of linked worktree

linked worktree 的 .git 是指向主仓库的文件，容器挂 worktree 后无法解析，
报 'not a git repository'。改用独立 clone 产出 self-contained repo。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Learning + DoD [x]

**Files:**
- Create: `docs/learnings/cp-0420191915-harness-v2-worktree-clone-fix.md`
- Modify: spec `## 成功标准` 全部 `[x]`

- [ ] **Step 1**: 写 learning
- [ ] **Step 2**: 勾 DoD
- [ ] **Step 3**: Commit

---

## Self-Review

覆盖 spec 5 个 DoD 对应的 5 个测试 + 回归 PR-1/2/3/4。无占位符。签名一致（`{taskId, baseRepo, execFn, statFn, rmFn}`）。

## Execution Handoff

Inline execution（单文件小改，4 个 Task 行不通）。
