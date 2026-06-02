# harness-gan GitHub Token Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `verifyProposerOutput` 加 `githubToken` 参数，让 `git ls-remote` 和 `git fetch` 对 private repo 能正确认证。

**Architecture:** 在 `contract-verify.js` 提取 `injectToken(url, token)` helper，将 `https://github.com/...` 替换为 `https://x-access-token:TOKEN@github.com/...`；harness-gan.graph.js 传 `githubToken` 给调用。

**Tech Stack:** Node.js, vitest

---

### Task 1: 写 injectToken 和 verifyProposerOutput auth 的 failing test

**Files:**
- Create: `packages/brain/src/lib/__tests__/contract-verify-auth.test.js`

- [ ] **Step 1: 读取 contract-verify.js 第 39-90 行，确认函数签名**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-github-auth
sed -n '39,90p' packages/brain/src/lib/contract-verify.js
```

- [ ] **Step 2: 写 failing tests**

创建 `packages/brain/src/lib/__tests__/contract-verify-auth.test.js`，内容：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── injectToken tests ────────────────────────────────────────────────────────
// 注意：injectToken 尚未导出，这些测试会先 fail，实现后才 pass

describe('injectToken', () => {
  it('无 token 时返回原 URL', async () => {
    const { injectToken } = await import('../contract-verify.js');
    expect(injectToken('https://github.com/org/repo.git', null)).toBe(
      'https://github.com/org/repo.git'
    );
  });

  it('有 token 时注入 x-access-token', async () => {
    const { injectToken } = await import('../contract-verify.js');
    expect(injectToken('https://github.com/org/repo.git', 'ghp_abc123')).toBe(
      'https://x-access-token:ghp_abc123@github.com/org/repo.git'
    );
  });

  it('已有 token 的 URL 不重复注入（幂等）', async () => {
    const { injectToken } = await import('../contract-verify.js');
    const url = 'https://x-access-token:old@github.com/org/repo.git';
    expect(injectToken(url, 'newtoken')).toBe(url); // 不替换已有 token
  });

  it('非 HTTPS URL 原样返回', async () => {
    const { injectToken } = await import('../contract-verify.js');
    expect(injectToken('git@github.com:org/repo.git', 'tok')).toBe(
      'git@github.com:org/repo.git'
    );
  });
});

// ─── verifyProposerOutput with githubToken ───────────────────────────────────
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('../../../db.js', () => ({ default: {} }));

const { execFile } = await import('node:child_process');
const { verifyProposerOutput } = await import('../contract-verify.js');

describe('verifyProposerOutput — githubToken injection', () => {
  beforeEach(() => vi.resetAllMocks());

  it('ls-remote 使用带 token 的 URL', async () => {
    const calls = [];
    execFile.mockImplementation((cmd, args, _opts, cb) => {
      calls.push(args.join(' '));
      if (args[0] === 'ls-remote') {
        // simulate branch found
        cb(null, { stdout: 'abc123\trefs/heads/cp-test-branch' });
      } else if (args[0] === '-C' && args[2] === 'remote') {
        cb(null, { stdout: 'https://github.com/org/repo.git\n' });
      } else if (args[1] === 'fetch' || (args[0] === 'fetch')) {
        cb(null, { stdout: '' });
      } else if (args.includes('show')) {
        cb(null, { stdout: JSON.stringify({ initiative_id: 'init1', tasks: [{ id: 't1', title: 't', complexity: 'S' }] }) });
      } else {
        cb(null, { stdout: '' });
      }
    });

    await verifyProposerOutput({
      worktreePath: '/fake/wt',
      branch: 'cp-test-branch',
      sprintDir: 'sprints',
      baseRepo: '/fake/repo',
      githubToken: 'ghp_secret123',
    }).catch(() => {}); // task-plan 验证可能 fail，忽略

    const lsRemoteCall = calls.find(c => c.startsWith('ls-remote'));
    expect(lsRemoteCall).toContain('x-access-token:ghp_secret123@github.com');
  });
});
```

- [ ] **Step 3: 跑测试确认 fail**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-github-auth
npx vitest run --root packages/brain packages/brain/src/lib/__tests__/contract-verify-auth.test.js 2>&1 | tail -10
```

期望：`injectToken` 相关测试 FAIL（export 不存在）

- [ ] **Step 4: commit failing tests**

```bash
git add packages/brain/src/lib/__tests__/contract-verify-auth.test.js
git commit -m "test(contract-verify): 加 injectToken + githubToken auth failing tests"
```

---

### Task 2: 实现 injectToken + 修改 verifyProposerOutput

**Files:**
- Modify: `packages/brain/src/lib/contract-verify.js:39-90`

- [ ] **Step 1: 在 contract-verify.js 顶部加 injectToken helper（在第一个 export 之前）**

在 `export async function verifyProposerOutput(opts)` 之前插入：

```js
/**
 * 将 GITHUB_TOKEN 注入 HTTPS GitHub URL。
 * 对非 HTTPS URL 或已含认证信息的 URL 原样返回。
 *
 * @param {string} url
 * @param {string|null|undefined} token
 * @returns {string}
 */
export function injectToken(url, token) {
  if (!token) return url;
  if (!url.startsWith('https://github.com/')) return url;
  return url.replace('https://', `https://x-access-token:${token}@`);
}
```

- [ ] **Step 2: 修改 verifyProposerOutput opts 解构，加 githubToken**

将：
```js
  const { worktreePath, branch, sprintDir, execFn = execFile } = opts;
```
改为：
```js
  const { worktreePath, branch, sprintDir, execFn = execFile, githubToken } = opts;
```

- [ ] **Step 3: 修改 ls-remote 调用（第 63 行附近）注入 token**

将：
```js
    const { stdout } = await execFn('git', ['ls-remote', githubUrl, branch]);
```
改为：
```js
    const authedUrl = injectToken(githubUrl, githubToken);
    const { stdout } = await execFn('git', ['ls-remote', authedUrl, branch]);
```

- [ ] **Step 4: 修改 git fetch 调用（第 82 行附近）注入 token**

将：
```js
    await execFn('git', ['fetch', githubUrl, `${branch}:refs/remotes/origin/${branch}`], { cwd: worktreePath });
```
改为：
```js
    const authedFetchUrl = injectToken(githubUrl, githubToken);
    await execFn('git', ['fetch', authedFetchUrl, `${branch}:refs/remotes/origin/${branch}`], { cwd: worktreePath });
```

- [ ] **Step 5: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-github-auth
npx vitest run --root packages/brain packages/brain/src/lib/__tests__/contract-verify-auth.test.js 2>&1 | tail -8
```

期望：所有测试 PASS

- [ ] **Step 6: commit 实现**

```bash
git add packages/brain/src/lib/contract-verify.js
git commit -m "fix(contract-verify): 加 githubToken auth — ls-remote/fetch 支持 private repo"
```

---

### Task 3: harness-gan.graph.js 传 githubToken

**Files:**
- Modify: `packages/brain/src/workflows/harness-gan.graph.js:449`

- [ ] **Step 1: 定位第 449 行的 verifyProposer 调用**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-github-auth
sed -n '445,455p' packages/brain/src/workflows/harness-gan.graph.js
```

- [ ] **Step 2: 修改 verifyProposer 调用加 githubToken**

将：
```js
    await verifyProposer({ worktreePath, branch: proposeBranch, sprintDir, baseRepo }).catch(err => {
```
改为：
```js
    await verifyProposer({ worktreePath, branch: proposeBranch, sprintDir, baseRepo, githubToken }).catch(err => {
```

- [ ] **Step 3: 跑 Brain 全量测试确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-github-auth
npx vitest run --root packages/brain packages/brain/src/ 2>&1 | tail -5
```

- [ ] **Step 4: commit**

```bash
git add packages/brain/src/workflows/harness-gan.graph.js
git commit -m "fix(harness-gan): verifyProposer 传 githubToken 支持 private repo 认证"
```

---

### Task 4: Brain 版本 bump + push PR

- [ ] **Step 1: bump Brain patch 版本**

```bash
cd /Users/administrator/worktrees/cecelia/harness-gan-github-auth
node -e "
const fs = require('fs');
const p = 'packages/brain/package.json';
const pkg = JSON.parse(fs.readFileSync(p,'utf8'));
const parts = pkg.version.split('.');
parts[2] = String(Number(parts[2]) + 1);
pkg.version = parts.join('.');
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
console.log('bumped to', pkg.version);
"
```

- [ ] **Step 2: commit version bump**

```bash
git add packages/brain/package.json
git commit -m "chore(brain): bump patch 版本（github auth private repo）"
```

- [ ] **Step 3: push + 开 PR**

```bash
git push -u origin cp-0602122301-harness-gan-github-auth
gh pr create \
  --title "fix(harness-gan): verifyProposerOutput 加 githubToken auth 支持 private repo" \
  --body "## 问题

\`verifyProposerOutput\` 调用 \`git ls-remote\` 和 \`git fetch\` 时使用裸 HTTPS URL，
对 private repo 在 Brain 容器内 401 失败 → GAN 误判 proposer 没有 push → abort。

## 变更

- \`contract-verify.js\`：新增 \`injectToken(url, token)\` helper + opts 加 \`githubToken\`
- \`harness-gan.graph.js\`：verifyProposer 调用传 \`githubToken\`

## 测试

新增 5 个 unit test，覆盖 injectToken 和 ls-remote token 注入。"
```

