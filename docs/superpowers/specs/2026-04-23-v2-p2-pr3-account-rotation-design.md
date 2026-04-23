# P2 PR 3：account-rotation Middleware 抽出

## 背景

v2 P2 第 3 PR。PR 1 建 spawn 骨架，PR 2 抽 docker-run middleware。本 PR 抽 `docker-executor.js:368-395` 的 `resolveAccountForOpts` 函数到 `packages/brain/src/spawn/middleware/account-rotation.js`。

Spec: `docs/design/brain-orchestrator-v2.md` §5.2（内层 attempt-loop 第 a 步）+ §5.3（cascade × rotation 顺序）。

## 目标

把账号轮换 + cap fallback + auth fallback 的逻辑搬到独立 middleware 文件。现阶段 `executeInDocker` 继续在 L412-413 处调用（接口不变），后续 PR 把它接到 attempt-loop 里做真正的内循环。

**零行为改动**。纯物理搬家 + rename 调用点。

## 交付物

### 1. 新建 `packages/brain/src/spawn/middleware/account-rotation.js`

```js
/**
 * account-rotation middleware — Brain v2 Layer 3 attempt-loop 内循环第 a 步。
 * 见 docs/design/brain-orchestrator-v2.md §5.2 + §5.3。
 *
 * 职责：根据 opts.env.CECELIA_CREDENTIALS（或空）+ cascade，选一个合适的账号，
 * 支持 capped/auth-failed fallback。**不**做模型降级（那是 cascade middleware 的事）。
 *
 * 遍历优先级（见 §5.3）：
 * - Caller 显式传 CECELIA_CREDENTIALS + 非 capped → 尊重
 * - 显式但 capped/auth-failed → 横切其它账号保持同一模型
 * - Caller 不传 → 走 selectBestAccount 默认序列（Sonnet 先横切账号→再降 Opus→再 Haiku）
 *
 * v2 P2 PR 3（本 PR）：纯代码搬家，从 docker-executor.js:368-395 抽出。
 * 接口和原 resolveAccountForOpts 完全一致 — caller 仍调 `await resolveAccount(opts, { taskId })`。
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

### 2. 改 `docker-executor.js`

删掉 L368-395 的 `resolveAccountForOpts` 函数（已搬到 middleware）。

加 import：
```js
import { resolveAccount } from './spawn/middleware/account-rotation.js';
```

改 L413 调用点：
```js
// 改前
await resolveAccountForOpts(opts, { taskId });

// 改后
await resolveAccount(opts, { taskId });
```

**重要**：原 `resolveAccountForOpts` 从 `docker-executor.js` 对外 export（L369 `export async function`）—— 检查整个仓库有多少其它 caller import 了 `resolveAccountForOpts`。**如果有外部 caller，保留一个 re-export** 使旧路径不坏：

```js
// docker-executor.js 底部加
export { resolveAccount as resolveAccountForOpts } from './spawn/middleware/account-rotation.js';
```

这样外部 import `{ resolveAccountForOpts }` 不挂。后续 PR 再统一迁移。

### 3. 新测试 `packages/brain/src/spawn/middleware/__tests__/account-rotation.test.js`

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account1'); // 不变
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

## 不做

- **不**把 cascade 逻辑抽出（PR 4）
- **不**改 account-usage.js 内部
- **不**把 `resolveAccount` 接到 attempt-loop（留给后续 PR 做真正的内循环）
- **不**删原 `resolveAccountForOpts` 的 re-export（避免 break 外部 caller）

## DoD

- [BEHAVIOR] `account-rotation.js` export `resolveAccount`
  Test: `manual:node -e "import('./packages/brain/src/spawn/middleware/account-rotation.js').then(m => { if(typeof m.resolveAccount !== 'function') process.exit(1) })"`
- [BEHAVIOR] `docker-executor.js` 内不再有 `export async function resolveAccountForOpts`（已搬到 middleware，只剩 re-export）
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(c.match(/export async function resolveAccountForOpts/)) process.exit(1)"`
- [BEHAVIOR] `docker-executor.js` 里仍可 import `resolveAccountForOpts`（re-export 保留旧接口）
  Test: `manual:node -e "import('./packages/brain/src/docker-executor.js').then(m => { if(typeof m.resolveAccountForOpts !== 'function') process.exit(1) })"`
- [BEHAVIOR] `docker-executor.js` L413 调用 `resolveAccount(opts,`
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(!c.match(/await resolveAccount\(opts,/)) process.exit(1)"`
- [BEHAVIOR] account-rotation test 文件存在
  Test: `manual:node -e "require('fs').accessSync('packages/brain/src/spawn/middleware/__tests__/account-rotation.test.js')"`
