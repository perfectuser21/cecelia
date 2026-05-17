# v2 P2 PR3 account-rotation Middleware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 抽 `docker-executor.js:368-395` 的 `resolveAccountForOpts` 到 `packages/brain/src/spawn/middleware/account-rotation.js`，保留 re-export 兼容外部 caller。

**Architecture:** 纯代码搬家 + rename（resolveAccountForOpts → resolveAccount）+ re-export 兼容层。零行为改动。

**Tech Stack:** Node.js ESM + vitest。

---

## File Structure

- **Create** `packages/brain/src/spawn/middleware/account-rotation.js`
- **Create** `packages/brain/src/spawn/middleware/__tests__/account-rotation.test.js`
- **Modify** `packages/brain/src/docker-executor.js` — 删 L368-395 函数定义，加 import + re-export，改 L414 调用

为 bisect-safety，Task 顺序必须：先建文件 → 再在 docker-executor 引入 import/re-export/调用 → 最后删老定义 → 再加测试。

---

### Task 1: 建 account-rotation.js（完整实现）

**Files:**
- Create: `packages/brain/src/spawn/middleware/account-rotation.js`

- [ ] **Step 1: 写文件**

写入 `packages/brain/src/spawn/middleware/account-rotation.js`：

```js
/**
 * account-rotation middleware — Brain v2 Layer 3 attempt-loop 内循环第 a 步。
 * 见 docs/design/brain-orchestrator-v2.md §5.2 + §5.3。
 *
 * 职责：根据 opts.env.CECELIA_CREDENTIALS（或空）+ cascade，选一个合适的账号，
 * 支持 capped/auth-failed fallback。**不**做模型降级（那是 cascade middleware 的事）。
 *
 * v2 P2 PR 3（本 PR）：纯代码搬家，从 docker-executor.js:368-395 抽出。
 * 接口和原 resolveAccountForOpts 完全一致。
 *
 * @param {object} opts  { env, cascade, task }
 * @param {object} ctx   { taskId?, deps? } — deps 用于测试注入
 * @returns {Promise<void>} — 原地修改 opts.env
 */
export async function resolveAccount(opts, ctx = {}) {
  opts.env = opts.env || {};
  try {
    const deps = ctx.deps || await import('../../account-usage.js');
    const { isSpendingCapped, isAuthFailed, selectBestAccount } = deps;
    const explicit = opts.env.CECELIA_CREDENTIALS;
    const capped = explicit ? isSpendingCapped(explicit) : false;
    const authFailed = explicit ? isAuthFailed(explicit) : false;
    const needsFallback = !explicit || capped || authFailed;
    if (!needsFallback) return;
    const selection = await selectBestAccount({ cascade: opts.cascade });
    if (!selection || !selection.accountId) return;
    const taskId = ctx.taskId || opts.task?.id || 'unknown';
    if (explicit && explicit !== selection.accountId) {
      const reason = capped ? 'spending-capped' : (authFailed ? 'auth-failed' : 'unset');
      console.log(`[account-rotation] rotate: ${explicit} ${reason} → ${selection.accountId} (task=${taskId})`);
    } else if (!explicit) {
      console.log(`[account-rotation] select: ${selection.accountId} model=${selection.model} (task=${taskId})`);
    }
    opts.env.CECELIA_CREDENTIALS = selection.accountId;
    if (selection.modelId && !opts.env.CLAUDE_MODEL_OVERRIDE) {
      opts.env.CECELIA_MODEL = selection.modelId;
    }
  } catch (err) {
    console.warn(`[account-rotation] middleware failed (keeping caller env): ${err.message}`);
  }
}
```

- [ ] **Step 2: 语法检查**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && node --check packages/brain/src/spawn/middleware/account-rotation.js
```

Expected: 无输出。

- [ ] **Step 3: import smoke**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && node -e "import('./packages/brain/src/spawn/middleware/account-rotation.js').then(m => { if(typeof m.resolveAccount !== 'function') process.exit(1); console.log('ok'); })"
```

Expected: `ok`。

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && git add packages/brain/src/spawn/middleware/account-rotation.js && git commit -m "feat(brain): v2 P2 PR3 新增 spawn/middleware/account-rotation.js"
```

---

### Task 2: docker-executor.js 加 import + re-export + 改调用点 + 删老定义

**Files:**
- Modify: `packages/brain/src/docker-executor.js` (import 区 + L369-395 + L414)

- [ ] **Step 1: 加 import 行**

用 Edit 在 `docker-executor.js` 顶部 import 区找最后一行 `import { ... } from './xxx';`（PR2 加的 `import { runDocker } from './spawn/middleware/docker-run.js';` 附近）后，加入：

```js
import { resolveAccount } from './spawn/middleware/account-rotation.js';
```

- [ ] **Step 2: 删老 resolveAccountForOpts 定义（L368-395）**

用 Edit 把这段整块删除（包括前面的 JSDoc）。定位 old_string（大约 L357-395 之间）：

```js
/**
 * 账号轮换 middleware（PR #2534）：如果 caller 没传 CECELIA_CREDENTIALS，或指定账号 spending-capped / auth-failed，
 * 自动走 selectBestAccount fallback；尊重 caller 显式传入且未 cap 的 account。
 * 导出给 harness runner / CI 测试复用。
 *
 * @param {object} opts — executeInDocker 参数
 * @param {object} ctx  — { deps?: { isSpendingCapped, isAuthFailed, selectBestAccount } } — 注入可替换（tests）
 * @param {string} ctx.taskId — 可选，仅用于日志
 */
export async function resolveAccountForOpts(opts, ctx = {}) {
  opts.env = opts.env || {};
  try {
    const deps = ctx.deps || await import('./account-usage.js');
    const { isSpendingCapped, isAuthFailed, selectBestAccount } = deps;
    const explicit = opts.env.CECELIA_CREDENTIALS;
    const capped = explicit ? isSpendingCapped(explicit) : false;
    const authFailed = explicit ? isAuthFailed(explicit) : false;
    const needsFallback = !explicit || capped || authFailed;
    if (!needsFallback) return;
    const selection = await selectBestAccount({ cascade: opts.cascade });
    if (!selection || !selection.accountId) return;
    const taskId = ctx.taskId || opts.task?.id || 'unknown';
    if (explicit && explicit !== selection.accountId) {
      const reason = capped ? 'spending-capped' : (authFailed ? 'auth-failed' : 'unset');
      console.log(`[docker-executor] account rotation: ${explicit} ${reason} → ${selection.accountId} (task=${taskId})`);
    } else if (!explicit) {
      console.log(`[docker-executor] account selected: ${selection.accountId} model=${selection.model} (task=${taskId})`);
    }
    opts.env.CECELIA_CREDENTIALS = selection.accountId;
    if (selection.modelId && !opts.env.CLAUDE_MODEL_OVERRIDE) {
      opts.env.CECELIA_MODEL = selection.modelId;
    }
  } catch (err) {
    console.warn(`[docker-executor] account rotation middleware failed (keeping caller env): ${err.message}`);
  }
}
```

替换为：
```js
// account-rotation 已迁到 spawn/middleware/account-rotation.js（PR #2545 v2 P2 PR3）
// 保留 re-export 供外部 caller（含测试）继续用旧名字
export { resolveAccount as resolveAccountForOpts } from './spawn/middleware/account-rotation.js';
```

- [ ] **Step 3: 改 L414 调用点**

用 Edit 在 `executeInDocker` 函数体内：

改前：
```js
  await resolveAccountForOpts(opts, { taskId });
```

改后：
```js
  await resolveAccount(opts, { taskId });
```

- [ ] **Step 4: 语法 + smoke**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && node --check packages/brain/src/docker-executor.js && node -e "import('./packages/brain/src/docker-executor.js').then(m => { if(typeof m.executeInDocker !== 'function' || typeof m.resolveAccountForOpts !== 'function') process.exit(1); console.log('ok'); })"
```

Expected: `ok`。（两个 export 都要存在：`executeInDocker` 和 re-exported `resolveAccountForOpts`）

- [ ] **Step 5: 验证旧函数定义已消失**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && grep -c "^export async function resolveAccountForOpts" packages/brain/src/docker-executor.js
```

Expected: `0`（只剩 re-export，没有 `export async function` 的原定义）。

- [ ] **Step 6: 跑老测试（确认 re-export 兼容）**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && npx vitest run packages/brain/src/__tests__/docker-executor-account-rotation.test.js 2>&1 | tail -10
```

Expected: 全通过。老测试用 `import { resolveAccountForOpts } from '../docker-executor.js'`，应该通过 re-export 依旧工作。

- [ ] **Step 7: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && git add packages/brain/src/docker-executor.js && git commit -m "refactor(brain): v2 P2 PR3 docker-executor 用 resolveAccount middleware + re-export 旧名兼容"
```

---

### Task 3: 建 account-rotation 新测试

**Files:**
- Create: `packages/brain/src/spawn/middleware/__tests__/account-rotation.test.js`

- [ ] **Step 1: 写测试文件**

写入 `packages/brain/src/spawn/middleware/__tests__/account-rotation.test.js`：

```js
/**
 * account-rotation middleware 单测。
 * 覆盖：显式 happy / capped fallback / auth-failed fallback / 自动选择 /
 *       CLAUDE_MODEL_OVERRIDE 尊重 / deps 抛错降级 / log 输出。
 */
import { describe, it, expect } from 'vitest';
import { resolveAccount } from '../account-rotation.js';

function makeDeps(overrides = {}) {
  return {
    isSpendingCapped: () => false,
    isAuthFailed: () => false,
    selectBestAccount: async () => ({ accountId: 'account2', model: 'sonnet', modelId: 'claude-sonnet-4-5' }),
    ...overrides,
  };
}

describe('resolveAccount() account-rotation middleware', () => {
  it('respects explicit account when not capped/auth-failed', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' } };
    await resolveAccount(opts, { deps: makeDeps() });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account1');
  });

  it('rotates away from capped explicit account', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' } };
    const deps = makeDeps({ isSpendingCapped: (id) => id === 'account1' });
    await resolveAccount(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account2');
  });

  it('rotates away from auth-failed explicit account', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' } };
    const deps = makeDeps({ isAuthFailed: (id) => id === 'account1' });
    await resolveAccount(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account2');
  });

  it('selects best account when none explicit', async () => {
    const opts = { env: {} };
    await resolveAccount(opts, { deps: makeDeps() });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account2');
    expect(opts.env.CECELIA_MODEL).toBe('claude-sonnet-4-5');
  });

  it('does not override CLAUDE_MODEL_OVERRIDE', async () => {
    const opts = { env: { CLAUDE_MODEL_OVERRIDE: 'opus' } };
    await resolveAccount(opts, { deps: makeDeps() });
    expect(opts.env.CLAUDE_MODEL_OVERRIDE).toBe('opus');
    expect(opts.env.CECELIA_MODEL).toBeUndefined();
  });

  it('keeps caller env when deps throw', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' } };
    const deps = makeDeps({ selectBestAccount: async () => { throw new Error('boom'); } });
    await resolveAccount(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account1');
  });

  it('logs rotation when explicit → selected are different', async () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      const opts = { env: { CECELIA_CREDENTIALS: 'account1' } };
      const deps = makeDeps({ isSpendingCapped: (id) => id === 'account1' });
      await resolveAccount(opts, { deps, taskId: 't42' });
      expect(logs.some(l => l.includes('[account-rotation] rotate:') && l.includes('t42'))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });
});
```

- [ ] **Step 2: 语法检查**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && node --check packages/brain/src/spawn/middleware/__tests__/account-rotation.test.js
```

Expected: 无输出。

- [ ] **Step 3: 跑 vitest**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && npx vitest run packages/brain/src/spawn/middleware/__tests__/account-rotation.test.js 2>&1 | tail -10
```

Expected: 7 pass。

- [ ] **Step 4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && git add packages/brain/src/spawn/middleware/__tests__/account-rotation.test.js && git commit -m "test(brain): v2 P2 PR3 account-rotation middleware 单测 (7 cases)"
```

---

### Task 4: DoD 终验

- [ ] **DoD 1 — account-rotation.js export resolveAccount**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && node -e "import('./packages/brain/src/spawn/middleware/account-rotation.js').then(m => { if(typeof m.resolveAccount !== 'function') process.exit(1) })" ; echo "exit=$?"
```
Expected: `exit=0`

- [ ] **DoD 2 — docker-executor.js 不再有 export async function resolveAccountForOpts**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(c.match(/export async function resolveAccountForOpts/)) process.exit(1)" ; echo "exit=$?"
```
Expected: `exit=0`

- [ ] **DoD 3 — resolveAccountForOpts 仍可 import（re-export）**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && node -e "import('./packages/brain/src/docker-executor.js').then(m => { if(typeof m.resolveAccountForOpts !== 'function') process.exit(1) })" ; echo "exit=$?"
```
Expected: `exit=0`

- [ ] **DoD 4 — docker-executor.js 改调 resolveAccount**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(!c.match(/await resolveAccount\(opts,/)) process.exit(1)" ; echo "exit=$?"
```
Expected: `exit=0`

- [ ] **DoD 5 — account-rotation test 文件存在**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && node -e "require('fs').accessSync('packages/brain/src/spawn/middleware/__tests__/account-rotation.test.js')" ; echo "exit=$?"
```
Expected: `exit=0`

- [ ] **facts-check**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && node scripts/facts-check.mjs 2>&1 | tail -3
```
Expected: `All facts consistent.`

- [ ] **老测试兼容（4 cases）**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr3-account-rotation-middleware && npx vitest run packages/brain/src/__tests__/docker-executor-account-rotation.test.js 2>&1 | tail -5
```
Expected: 全通过（re-export 起作用）。

---

## Self-Review

### Spec Coverage

| Spec 要求 | Task |
|---|---|
| 建 `account-rotation.js` 含 `resolveAccount` | Task 1 |
| 删 `resolveAccountForOpts` 定义 | Task 2 Step 2 |
| 加 re-export 兼容层 | Task 2 Step 2 |
| 改 `executeInDocker` 调 `resolveAccount` | Task 2 Step 3 |
| 建 account-rotation 单测 7 cases | Task 3 |
| DoD 5 条 [BEHAVIOR] | Task 4 |
| 老测试 4 cases 仍通过（re-export） | Task 4 最后 |

### Commit 顺序 bisect-safety

- Task 1 建新 file：新 file 内部闭合，但老 `resolveAccountForOpts` 还在 docker-executor.js → 可 import ✓
- Task 2 删老+加 re-export 同 commit：docker-executor.js 切换瞬间，`resolveAccountForOpts` 通过 re-export 仍可 import ✓
- Task 3 建新测试：纯独立 ✓

每个 intermediate commit 都可 import。

### Placeholder Scan

无 TBD / TODO。

### Type Consistency

- `resolveAccount(opts, ctx)` 签名在所有 task 一致
- `ctx.deps` / `ctx.taskId` 字段一致
