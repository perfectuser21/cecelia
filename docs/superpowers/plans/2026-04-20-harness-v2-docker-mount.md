# Harness v2 Docker Mount + GITHUB_TOKEN Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Harness v2 `harness-initiative-runner.js` 派的 Docker 容器挂载真实的 git worktree 并注入 `GITHUB_TOKEN`，容器内 agent 能真正 `git push` + `gh pr create`。

**Architecture:** 两个新 helper（`harness-worktree.js` 管 worktree 生命周期、`harness-credentials.js` 管 token 解析），在 `harness-initiative-runner.js` 的 `executeInDocker` 调用处补齐 `worktreePath` 和 `env.GITHUB_TOKEN`。

**Tech Stack:** Node.js ESM + vitest + `child_process.execSync`（git / gh CLI 调用）

---

## File Structure

**Create:**
- `packages/brain/src/harness-worktree.js` — `ensureHarnessWorktree`, `cleanupHarnessWorktree`
- `packages/brain/src/harness-credentials.js` — `resolveGitHubToken`
- `packages/brain/src/__tests__/harness-worktree.test.js`
- `packages/brain/src/__tests__/harness-credentials.test.js`
- `packages/brain/src/__tests__/harness-initiative-runner-container-mount.test.js`

**Modify:**
- `packages/brain/src/harness-initiative-runner.js` — 在 executor 调用前加 helper 调用，spawn 参数补 `worktreePath` + `env.GITHUB_TOKEN`

---

### Task 1: harness-credentials.js — GITHUB_TOKEN 解析器

**Files:**
- Create: `packages/brain/src/harness-credentials.js`
- Test: `packages/brain/src/__tests__/harness-credentials.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/brain/src/__tests__/harness-credentials.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveGitHubToken } from '../harness-credentials.js';

describe('resolveGitHubToken', () => {
  const origEnv = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    vi.resetModules();
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.GITHUB_TOKEN = origEnv;
    else delete process.env.GITHUB_TOKEN;
    vi.restoreAllMocks();
  });

  it('prefers process.env.GITHUB_TOKEN when non-empty', async () => {
    process.env.GITHUB_TOKEN = 'ghs_fromEnv';
    const token = await resolveGitHubToken({ execFn: async () => 'ghs_fromGh', readFileFn: async () => 'GITHUB_TOKEN=ghs_fromFile\n' });
    expect(token).toBe('ghs_fromEnv');
  });

  it('falls back to gh auth token when env missing', async () => {
    const token = await resolveGitHubToken({ execFn: async () => 'ghs_fromGh\n', readFileFn: async () => 'GITHUB_TOKEN=ghs_fromFile\n' });
    expect(token).toBe('ghs_fromGh');
  });

  it('falls back to credentials file when gh fails', async () => {
    const token = await resolveGitHubToken({
      execFn: async () => { throw new Error('gh not logged in'); },
      readFileFn: async () => 'GITHUB_TOKEN=ghs_fromFile\nOTHER=x\n',
    });
    expect(token).toBe('ghs_fromFile');
  });

  it('throws github_token_unavailable when all sources fail', async () => {
    await expect(resolveGitHubToken({
      execFn: async () => { throw new Error('no gh'); },
      readFileFn: async () => { throw new Error('no file'); },
    })).rejects.toThrow('github_token_unavailable');
  });

  it('treats empty env var as missing (not hit)', async () => {
    process.env.GITHUB_TOKEN = '';
    const token = await resolveGitHubToken({ execFn: async () => 'ghs_fromGh', readFileFn: async () => '' });
    expect(token).toBe('ghs_fromGh');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-credentials.test.js`
Expected: FAIL — "Cannot find module '../harness-credentials.js'"

- [ ] **Step 3: Write minimal implementation**

```js
// packages/brain/src/harness-credentials.js
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFile = promisify(execFileCb);

const DEFAULT_CREDS_FILE = path.join(os.homedir(), '.credentials', 'github.env');

async function tryGhAuthToken() {
  const { stdout } = await execFile('gh', ['auth', 'token'], { timeout: 5000 });
  return String(stdout || '').trim();
}

async function tryReadCredsFile(filePath = DEFAULT_CREDS_FILE) {
  const content = await readFile(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*GITHUB_TOKEN\s*=\s*(\S+)\s*$/);
    if (m && m[1]) return m[1];
  }
  return '';
}

/**
 * 按 env -> gh CLI -> credentials file 顺序解析 GitHub token。
 * 全失败则抛 'github_token_unavailable'。
 *
 * @param {object} [deps]
 * @param {Function} [deps.execFn]       测试注入 gh CLI 调用
 * @param {Function} [deps.readFileFn]   测试注入凭据文件读取
 * @param {string}   [deps.credsPath]    测试注入凭据文件路径
 * @returns {Promise<string>}
 */
export async function resolveGitHubToken(deps = {}) {
  const execFn = deps.execFn || tryGhAuthToken;
  const readFileFn = deps.readFileFn || (() => tryReadCredsFile(deps.credsPath));

  const envTok = process.env.GITHUB_TOKEN;
  if (envTok && envTok.trim()) return envTok.trim();

  try {
    const ghTok = await execFn();
    if (ghTok && String(ghTok).trim()) return String(ghTok).trim();
  } catch { /* fallthrough */ }

  try {
    const fileContent = await readFileFn();
    if (typeof fileContent === 'string') {
      for (const line of fileContent.split(/\r?\n/)) {
        const m = line.match(/^\s*GITHUB_TOKEN\s*=\s*(\S+)\s*$/);
        if (m && m[1]) return m[1];
      }
    }
  } catch { /* fallthrough */ }

  throw new Error('github_token_unavailable');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-credentials.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-docker-mount
git add packages/brain/src/harness-credentials.js packages/brain/src/__tests__/harness-credentials.test.js
git commit -m "feat(harness-v2): add GITHUB_TOKEN resolver for container injection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: harness-worktree.js — 独立 git worktree 生命周期

**Files:**
- Create: `packages/brain/src/harness-worktree.js`
- Test: `packages/brain/src/__tests__/harness-worktree.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/brain/src/__tests__/harness-worktree.test.js
import { describe, it, expect, vi } from 'vitest';
import { ensureHarnessWorktree, cleanupHarnessWorktree } from '../harness-worktree.js';

describe('ensureHarnessWorktree', () => {
  it('returns existing path when dir already a worktree (idempotent)', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (args[0] === '-C' && args[3] === 'rev-parse') return { stdout: 'true\n' };
      return { stdout: '' };
    };
    const statFn = async () => true;

    const p = await ensureHarnessWorktree({
      taskId: 'abcdef1234567890-xxx',
      baseRepo: '/tmp/cec',
      execFn, statFn,
    });
    expect(p).toBe('/tmp/cec/.claude/worktrees/harness-v2/task-abcdef12');
    expect(calls.some(c => c.startsWith('git worktree add'))).toBe(false);
  });

  it('creates new worktree when dir does not exist', async () => {
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
    const addCall = calls.find(c => c.startsWith('git -C /tmp/cec worktree add'));
    expect(addCall).toBeTruthy();
    expect(addCall).toContain('harness-v2/task-beefcafe');
    expect(addCall).toContain('main');
  });

  it('throws when taskId too short', async () => {
    await expect(ensureHarnessWorktree({
      taskId: 'abc',
      baseRepo: '/tmp/cec',
      execFn: async () => ({ stdout: '' }),
      statFn: async () => false,
    })).rejects.toThrow(/taskId/);
  });
});

describe('cleanupHarnessWorktree', () => {
  it('calls git worktree remove --force', async () => {
    const calls = [];
    await cleanupHarnessWorktree('/tmp/wt/task-xxx', {
      execFn: async (cmd, args) => { calls.push([cmd, ...args].join(' ')); return { stdout: '' }; },
      baseRepo: '/tmp/cec',
    });
    expect(calls.some(c => c.includes('worktree remove --force'))).toBe(true);
  });

  it('does not throw when path missing', async () => {
    await expect(cleanupHarnessWorktree('/tmp/wt/missing', {
      execFn: async () => { throw new Error("worktree not found"); },
      baseRepo: '/tmp/cec',
    })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-worktree.test.js`
Expected: FAIL — "Cannot find module '../harness-worktree.js'"

- [ ] **Step 3: Write minimal implementation**

```js
// packages/brain/src/harness-worktree.js
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const execFile = promisify(execFileCb);

const DEFAULT_BASE_REPO = '/Users/administrator/perfect21/cecelia';

async function defaultStat(p) {
  try { await stat(p); return true; } catch { return false; }
}

function defaultExec(cmd, args, opts = {}) {
  return execFile(cmd, args, { timeout: 30_000, ...opts });
}

function shortId(taskId) {
  if (!taskId || String(taskId).length < 8) {
    throw new Error(`ensureHarnessWorktree: taskId must be ≥8 chars, got ${taskId}`);
  }
  return String(taskId).slice(0, 8);
}

/**
 * 幂等创建/复用 Harness v2 专属 worktree。
 *
 * 目录：<baseRepo>/.claude/worktrees/harness-v2/task-<shortid>
 * 分支：harness-v2/task-<shortid>（基于 main）
 *
 * @param {object} opts
 * @param {string} opts.taskId                必填，用前 8 字符做 shortid
 * @param {string} [opts.initiativeId]        仅用于日志
 * @param {string} [opts.baseRepo]            cecelia 仓库绝对路径
 * @param {Function} [opts.execFn]            测试注入
 * @param {Function} [opts.statFn]            测试注入
 * @returns {Promise<string>}                  worktree 绝对路径
 */
export async function ensureHarnessWorktree(opts) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  const execFn = opts.execFn || defaultExec;
  const statFn = opts.statFn || defaultStat;

  const sid = shortId(opts.taskId);
  const branch = `harness-v2/task-${sid}`;
  const wtPath = path.join(baseRepo, '.claude', 'worktrees', 'harness-v2', `task-${sid}`);

  if (await statFn(wtPath)) {
    try {
      const { stdout } = await execFn('git', ['-C', wtPath, 'rev-parse', '--is-inside-work-tree']);
      if (String(stdout || '').trim() === 'true') return wtPath;
    } catch { /* not a worktree, fall through to re-create */ }
  }

  await execFn('git', ['-C', baseRepo, 'worktree', 'add', wtPath, '-b', branch, 'main']);
  return wtPath;
}

/**
 * 移除 Harness v2 worktree；幂等（不存在不抛）。
 *
 * @param {string} wtPath
 * @param {object} [opts]
 * @param {string} [opts.baseRepo]
 * @param {Function} [opts.execFn]
 */
export async function cleanupHarnessWorktree(wtPath, opts = {}) {
  const baseRepo = opts.baseRepo || DEFAULT_BASE_REPO;
  const execFn = opts.execFn || defaultExec;
  try {
    await execFn('git', ['-C', baseRepo, 'worktree', 'remove', '--force', wtPath]);
  } catch { /* idempotent */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-worktree.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-docker-mount
git add packages/brain/src/harness-worktree.js packages/brain/src/__tests__/harness-worktree.test.js
git commit -m "feat(harness-v2): add ensureHarnessWorktree / cleanupHarnessWorktree helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: harness-initiative-runner.js — spawn 补传 worktreePath + GITHUB_TOKEN

**Files:**
- Modify: `packages/brain/src/harness-initiative-runner.js` — `runInitiative` 的 executor 调用前加两行 helper 调用，spawn args 补两字段
- Test: `packages/brain/src/__tests__/harness-initiative-runner-container-mount.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/brain/src/__tests__/harness-initiative-runner-container-mount.test.js
import { describe, it, expect, vi } from 'vitest';

describe('runInitiative container mount', () => {
  it('passes worktreePath and GITHUB_TOKEN to executor', async () => {
    vi.resetModules();
    vi.doMock('../harness-worktree.js', () => ({
      ensureHarnessWorktree: vi.fn(async () => '/tmp/cec/.claude/worktrees/harness-v2/task-abcdef12'),
      cleanupHarnessWorktree: vi.fn(),
    }));
    vi.doMock('../harness-credentials.js', () => ({
      resolveGitHubToken: vi.fn(async () => 'ghs_test_token'),
    }));

    let captured = null;
    const mockExec = async (opts) => {
      captured = opts;
      return {
        exit_code: 0,
        timed_out: false,
        stdout: JSON.stringify({ type: 'result', result: '```json\n{"initiative_id":"i","tasks":[{"logical_task_id":"ws1","title":"t","complexity":"S","files":[],"dod":[]}]}\n```' }),
        stderr: '',
      };
    };

    const { runInitiative } = await import('../harness-initiative-runner.js');
    const res = await runInitiative(
      { id: 'abcdef1234567890-xxx', title: 'x', description: 'y' },
      {
        executor: mockExec,
        pool: { connect: async () => ({ query: async () => ({ rows: [{ id: 'contract-id' }] }), release: () => {} }) },
      }
    );

    // We don't care whether insert succeeded - we only care spawn opts were correct
    expect(captured).not.toBeNull();
    expect(captured.worktreePath).toBeTruthy();
    expect(captured.worktreePath).toContain('harness-v2');
    expect(captured.env.GITHUB_TOKEN).toBe('ghs_test_token');
  });

  it('fails fast when token unavailable', async () => {
    vi.resetModules();
    vi.doMock('../harness-worktree.js', () => ({
      ensureHarnessWorktree: vi.fn(async () => '/tmp/cec/.claude/worktrees/harness-v2/task-abcdef12'),
      cleanupHarnessWorktree: vi.fn(),
    }));
    vi.doMock('../harness-credentials.js', () => ({
      resolveGitHubToken: vi.fn(async () => { throw new Error('github_token_unavailable'); }),
    }));

    const mockExec = vi.fn();
    const { runInitiative } = await import('../harness-initiative-runner.js');
    const res = await runInitiative(
      { id: 'abcdef1234567890-xxx', title: 'x', description: 'y' },
      { executor: mockExec }
    );

    expect(res.success).toBe(false);
    expect(String(res.error || '')).toMatch(/github_token_unavailable/);
    expect(mockExec).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-initiative-runner-container-mount.test.js`
Expected: FAIL — assertions fail because current runner doesn't pass worktreePath or GITHUB_TOKEN

- [ ] **Step 3: Read existing runner executor call site**

Run: `grep -n "executor\|executeInDocker\|worktreePath\|CECELIA_CREDENTIALS" packages/brain/src/harness-initiative-runner.js | head -40`

Note target: find the block around line 97-108 where `executor({ task, prompt, env: { ... } })` is called for the Planner. We'll insert two lines before it and extend the args.

- [ ] **Step 4: Edit harness-initiative-runner.js**

Add imports near the top:
```js
import { ensureHarnessWorktree } from './harness-worktree.js';
import { resolveGitHubToken } from './harness-credentials.js';
```

Before the `const result = await executor({ ... })` call (around line 97-108), insert:

```js
let worktreePath;
let githubToken;
try {
  worktreePath = await ensureHarnessWorktree({ taskId: task.id, initiativeId });
  githubToken = await resolveGitHubToken();
} catch (err) {
  console.error(`[harness-initiative-runner] prep failed task=${task.id}: ${err.message}`);
  return { success: false, taskId: task.id, initiativeId, error: err.message };
}
```

Change the executor call to:

```js
const result = await executor({
  task: { ...task, task_type: 'harness_planner' },
  prompt,
  worktreePath,
  env: {
    CECELIA_CREDENTIALS: 'account1',
    CECELIA_TASK_TYPE: 'harness_planner',
    HARNESS_NODE: 'planner',
    HARNESS_SPRINT_DIR: sprintDir,
    HARNESS_INITIATIVE_ID: initiativeId,
    GITHUB_TOKEN: githubToken,
  },
});
```

(exact line numbers will shift; look for the executor({ task:…, task_type: 'harness_planner' }) call site and modify in place)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-initiative-runner-container-mount.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Run full integration test suite to check no regression**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/harness-initiative-runner.integration.test.js 2>&1 | tail -20`
Expected: Existing integration tests still pass OR updated to mock new helpers (若失败则给现有集成测试补 mock)

- [ ] **Step 7: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-docker-mount
git add packages/brain/src/harness-initiative-runner.js packages/brain/src/__tests__/harness-initiative-runner-container-mount.test.js
git commit -m "feat(harness-v2): inject worktreePath + GITHUB_TOKEN into Planner container

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Learning 文档 + DoD 勾选

**Files:**
- Create: `docs/learnings/cp-0420152150-harness-v2-docker-mount.md`
- Modify: spec's `## 成功标准` 条目勾选 `[x]`

- [ ] **Step 1: Write learning**

```markdown
<!-- docs/learnings/cp-0420152150-harness-v2-docker-mount.md -->
# Harness v2 Docker Mount + GITHUB_TOKEN 注入

### 根本原因
Harness v2 pipeline E2E 失败：容器内 agent 无法 `git push` 或 `gh pr create`。
`harness-initiative-runner.js` 调 `executeInDocker` 时未传 `worktreePath`，`docker-executor.js` 回落到默认值（cecelia 主仓库），但主仓库不是 worktree 且容器内没 `GITHUB_TOKEN`。Planner 输出 `/workspace is not a git repo in this sandbox, so the worktree→PR→CI path couldn't be walked end-to-end`。

### 下次预防
- [ ] 新增容器任务时，必须审查 `executeInDocker` 调用点是否传了 `worktreePath` 和必要的凭据 env
- [ ] 容器依赖的外部服务（GitHub / npm / postgres）凭据一律通过 `env`，不 hard-code、不依赖宿主 config 共享
- [ ] Harness 类任务统一用 `ensureHarnessWorktree(taskId)` helper 取 worktree，杜绝复用主仓库
```

- [ ] **Step 2: Update spec 勾选**

Edit `docs/superpowers/specs/2026-04-20-harness-v2-docker-mount-design.md` 下 `## 成功标准` 的 5 个条目全部改为 `[x]`（测试已通过 + 文件已创建）。

- [ ] **Step 3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-v2-docker-mount
git add docs/learnings/cp-0420152150-harness-v2-docker-mount.md docs/superpowers/specs/2026-04-20-harness-v2-docker-mount-design.md
git commit -m "docs(harness-v2): add learning + check DoD for PR-1

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

1. **Spec coverage**: ✅
   - helper `ensureHarnessWorktree` / `cleanupHarnessWorktree` → Task 2
   - helper `resolveGitHubToken` → Task 1
   - runner spawn 补字段 → Task 3
   - 5 个成功标准 [BEHAVIOR] × 3 + [ARTIFACT] × 2 → Task 1/2/3 的测试全覆盖
2. **Placeholder scan**: 无 TBD/TODO/"similar to"。全步骤有具体代码。
3. **Type consistency**: `ensureHarnessWorktree` 签名在 Task 2/3 一致；`resolveGitHubToken` 签名在 Task 1/3 一致。

---

## Execution Handoff

Plan complete. 按 /dev 自主规则使用 Subagent-Driven。
