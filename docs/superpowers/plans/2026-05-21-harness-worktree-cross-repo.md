# harness-worktree 跨仓库 bug 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `ensureHarnessWorktree` 把 worktree 路径派生自 `baseRepo` 的 bug，使 Brain harness 能正确开发任意仓库（ZenithJoy 等跨仓库场景）。

**Architecture:** 拆分 `baseRepo` 为两个变量：`cloneSource`（clone 源，可为任意 repo）和 `wtHostRepo`（worktree 物理位置，永远是 `DEFAULT_BASE_REPO` = cecelia）。两个 helper 函数同步修复。

**Tech Stack:** Node.js ESM, vitest, git CLI

---

## 文件范围

- Modify: `packages/brain/src/harness-worktree.js`（主函数 + 2 个 helper）
- Create: `packages/brain/src/__tests__/harness-worktree-cross-repo.test.js`（新测试）

---

### Task 1: 写失败的跨仓库测试（TDD Red）

**Files:**
- Create: `packages/brain/src/__tests__/harness-worktree-cross-repo.test.js`

- [ ] **Step 1: 写失败测试文件**

```js
// packages/brain/src/__tests__/harness-worktree-cross-repo.test.js
import { describe, it, expect } from 'vitest';
import {
  ensureHarnessWorktree,
  harnessTaskWorktreePath,
  harnessSubTaskWorktreePath,
  DEFAULT_BASE_REPO,
} from '../harness-worktree.js';

const ZENITHJOY = '/Users/administrator/perfect21/zenithjoy';

describe('harness-worktree cross-repo', () => {
  it('ensureHarnessWorktree: wtPath 在 DEFAULT_BASE_REPO 下，clone source 是 baseRepo', async () => {
    const calls = [];
    const execFn = async (_cmd, args) => {
      calls.push(args.join(' '));
      return { stdout: '' };
    };
    const statFn = async () => false; // 目录不存在，走 clone 路径

    const wtPath = await ensureHarnessWorktree({
      taskId: 'beefcafe11111111',
      baseRepo: ZENITHJOY,
      execFn,
      statFn,
      logFn: () => {},
    });

    // wtPath 必须在 cecelia 下，不在 zenithjoy 下
    expect(wtPath).toContain(DEFAULT_BASE_REPO);
    expect(wtPath).not.toContain(ZENITHJOY);

    // clone 命令：source = zenithjoy，dest = cecelia 下路径
    const cloneCall = calls.find(c => c.includes('clone'));
    expect(cloneCall).toContain(ZENITHJOY);       // source 是 zenithjoy
    expect(cloneCall).toContain(DEFAULT_BASE_REPO); // dest 在 cecelia 下
    // 关键：不能把 zenithjoy 克隆进自己
    expect(cloneCall).not.toMatch(new RegExp(`${ZENITHJOY}.*${ZENITHJOY}`));
  });

  it('harnessTaskWorktreePath: opts.baseRepo 不影响 wtPath', () => {
    const p = harnessTaskWorktreePath('beefcafe11111111', { baseRepo: ZENITHJOY });
    expect(p).toContain(DEFAULT_BASE_REPO);
    expect(p).not.toContain('zenithjoy');
  });

  it('harnessSubTaskWorktreePath: opts.baseRepo 不影响 wtPath', () => {
    const p = harnessSubTaskWorktreePath('init-id-1234', 'ws1', { baseRepo: ZENITHJOY });
    expect(p).toContain(DEFAULT_BASE_REPO);
    expect(p).not.toContain('zenithjoy');
  });
});
```

- [ ] **Step 2: 确认测试失败（Red）**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-worktree-cross-repo
npx vitest run packages/brain/src/__tests__/harness-worktree-cross-repo.test.js --reporter=verbose 2>&1 | tail -20
```

预期：3 个测试 FAIL（wtPath 包含 zenithjoy，不包含 cecelia）

- [ ] **Step 3: commit Red 测试**

```bash
git add packages/brain/src/__tests__/harness-worktree-cross-repo.test.js
git commit -m "test(harness): 跨仓库 wtPath 失败测试（TDD Red）

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 修复 helper 函数（harnessTaskWorktreePath + harnessSubTaskWorktreePath）

**Files:**
- Modify: `packages/brain/src/harness-worktree.js`（第 14-19 行、第 31-36 行、JSDoc）

- [ ] **Step 1: 修改 `harnessTaskWorktreePath`（第 16-19 行）**

将：
```js
export function harnessTaskWorktreePath(taskId, opts = {}) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  return path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${shortTaskId(taskId)}`);
}
```
改为：
```js
export function harnessTaskWorktreePath(taskId, _opts = {}) {
  return path.join(DEFAULT_BASE_REPO, '.claude', 'worktrees', 'harness-v2', `task-${shortTaskId(taskId)}`);
}
```

同时更新 JSDoc 注释（第 13 行）：
```
 * <DEFAULT_BASE_REPO>/.claude/worktrees/harness-v2/task-<shortTaskId>
```

- [ ] **Step 2: 修改 `harnessSubTaskWorktreePath`（第 31-36 行）**

将：
```js
export function harnessSubTaskWorktreePath(initiativeId, logicalTaskId, opts = {}) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  const init8 = String(initiativeId).slice(0, 8);
  return path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${init8}-${logicalTaskId}`);
}
```
改为：
```js
export function harnessSubTaskWorktreePath(initiativeId, logicalTaskId, _opts = {}) {
  const init8 = String(initiativeId).slice(0, 8);
  return path.join(DEFAULT_BASE_REPO, '.claude', 'worktrees', 'harness-v2', `task-${init8}-${logicalTaskId}`);
}
```

- [ ] **Step 3: 运行 helper 测试（Green）**

```bash
npx vitest run packages/brain/src/__tests__/harness-worktree-cross-repo.test.js --reporter=verbose -t "harnessTaskWorktreePath|harnessSubTaskWorktreePath" 2>&1 | tail -10
```

预期：2 个 helper 测试 PASS

---

### Task 3: 修复 ensureHarnessWorktree 主函数

**Files:**
- Modify: `packages/brain/src/harness-worktree.js`（主函数，涉及 5 处 `baseRepo` 用法）

- [ ] **Step 1: 拆分变量（函数入口，原第 101 行）**

将：
```js
export async function ensureHarnessWorktree(opts) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  const execFn = opts.execFn || defaultExec;
```
改为：
```js
export async function ensureHarnessWorktree(opts) {
  const cloneSource = opts.baseRepo || DEFAULT_BASE_REPO; // clone 源（可为任意 repo）
  const wtHostRepo = DEFAULT_BASE_REPO;                    // worktree 物理位置（永远 cecelia）
  const execFn = opts.execFn || defaultExec;
```

- [ ] **Step 2: 修改 wtPath 赋值（原第 111 行）**

将：
```js
  const wtPath = path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${wtKey}`);
```
改为：
```js
  const wtPath = path.join(wtHostRepo, '.claude', 'worktrees', 'harness-v2', `task-${wtKey}`);
```

- [ ] **Step 3: 修改孤儿校验中的 baseRepo 引用（原第 136-141 行）**

将：
```js
          try {
            const { stdout: gh } = await execFn('git', ['-C', baseRepo, 'remote', 'get-url', 'origin']);
            baseRepoGithubUrl = String(gh || '').trim();
          } catch { /* baseRepo 自己 origin 读不到，下面只校 baseRepo 路径 */ }
          const matchesBaseRepo = url && url.includes(baseRepo);
```
改为：
```js
          try {
            const { stdout: gh } = await execFn('git', ['-C', cloneSource, 'remote', 'get-url', 'origin']);
            baseRepoGithubUrl = String(gh || '').trim();
          } catch { /* cloneSource origin 读不到，下面只校 cloneSource 路径 */ }
          const matchesBaseRepo = url && url.includes(cloneSource);
```

- [ ] **Step 4: 修改 clone 命令（原第 173-177 行）**

将：
```js
  await execFn('git', [
    'clone', '--local', '--no-hardlinks',
    '--branch', 'main', '--single-branch',
    baseRepo, wtPath,
  ]);
```
改为：
```js
  await execFn('git', [
    'clone', '--local', '--no-hardlinks',
    '--branch', 'main', '--single-branch',
    cloneSource, wtPath,
  ]);
```

- [ ] **Step 5: 修改 H16 origin URL 设置（原第 183-184 行）**

将：
```js
    const { stdout: githubUrl } = await execFn('git', ['-C', baseRepo, 'remote', 'get-url', 'origin']);
```
改为：
```js
    const { stdout: githubUrl } = await execFn('git', ['-C', cloneSource, 'remote', 'get-url', 'origin']);
```

- [ ] **Step 6: 更新主函数 JSDoc 注释（函数头部）**

将：
```
 * 目录：<baseRepo>/.claude/worktrees/harness-v2/task-<shortid>
```
改为：
```
 * 目录：<DEFAULT_BASE_REPO>/.claude/worktrees/harness-v2/task-<shortid>（克隆源由 opts.baseRepo 指定）
```

- [ ] **Step 7: 运行全部跨仓库测试（Green）**

```bash
npx vitest run packages/brain/src/__tests__/harness-worktree-cross-repo.test.js --reporter=verbose 2>&1 | tail -15
```

预期：3 个测试全 PASS

---

### Task 4: 更新已有测试的路径期望值

**Files:**
- Modify: `packages/brain/src/__tests__/harness-worktree.test.js`

已有测试传 `baseRepo: '/tmp/cec'` 并断言 `wtPath` 包含 `/tmp/cec`。修复后 wtPath 固定走 `DEFAULT_BASE_REPO`，需更新期望值。

- [ ] **Step 1: 找出所有受影响断言**

```bash
grep -n "tmp/cec" packages/brain/src/__tests__/harness-worktree.test.js | head -20
```

- [ ] **Step 2: 将期望值从 `/tmp/cec` 改为 `DEFAULT_BASE_REPO`**

对每处 `expect(result).toContain('/tmp/cec')` 或 `expect(result).toBe('/tmp/cec/...')` 形式的断言，将 `/tmp/cec` 替换为 `DEFAULT_BASE_REPO` 的实际值 `/Users/administrator/perfect21/cecelia`。

例如：
```js
// 修改前
expect(wtPath).toContain('/tmp/cec');

// 修改后
expect(wtPath).toContain('/Users/administrator/perfect21/cecelia');
```

注意：`baseRepo` 参数作为 clone source 的行为保持不变（`git clone /tmp/cec → cecelia/.claude/worktrees/...`），只有路径断言要改。

- [ ] **Step 3: 运行已有测试套件（确保全绿）**

```bash
npx vitest run packages/brain/src/__tests__/harness-worktree.test.js --reporter=verbose 2>&1 | tail -20
```

预期：全部 PASS（无 regression）

- [ ] **Step 4: 运行全部 harness-worktree 相关测试**

```bash
npx vitest run packages/brain/src/__tests__/harness-worktree*.test.js --reporter=verbose 2>&1 | tail -20
```

预期：全部 PASS

- [ ] **Step 5: commit 实现 + 测试更新**

```bash
git add packages/brain/src/harness-worktree.js \
        packages/brain/src/__tests__/harness-worktree-cross-repo.test.js \
        packages/brain/src/__tests__/harness-worktree.test.js
git commit -m "fix(harness): worktree 路径固定用 DEFAULT_BASE_REPO，支持跨仓库开发

ensureHarnessWorktree / harnessTaskWorktreePath / harnessSubTaskWorktreePath
三处函数将 wtPath 固定派生自 DEFAULT_BASE_REPO（cecelia），
clone source 仍用 opts.baseRepo，解决跨仓库时克隆进自身子目录的 bug。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
