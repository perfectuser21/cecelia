# P2 PR 5：cap-marking Middleware（模块 + 测试，暂不接线）

## 背景

v2 P2 第 5 PR。spec §5.2 内层 attempt-loop 第 e 步 — 检测 `result.stdout` 里的 429 / spending cap 特征，并调 `markSpendingCap(accountId)`。当前逻辑分散在 `routes/execution.js:798`（callback 路径），本 PR 建立独立 middleware 模块。

**本 PR 只建立模块 + 单测**，暂不接线到 `executeInDocker`。等到后续 attempt-loop 整合 PR（~PR8-9）再真正接入。这样保持每个 PR 零行为改动。

## 目标

1. 新建 `packages/brain/src/spawn/middleware/cap-marking.js` export `checkCap(result, opts, ctx)` 函数
2. 新建 `__tests__/cap-marking.test.js` 5 cases
3. 不改 `executeInDocker`，不改 `execution.js`，不改 `account-usage.js`

## 交付物

### 1. `packages/brain/src/spawn/middleware/cap-marking.js`

```js
/**
 * cap-marking middleware — Brain v2 Layer 3 attempt-loop 内循环第 e 步。
 * 见 docs/design/brain-orchestrator-v2.md §5.2。
 *
 * 职责：检测 runDocker result 的 stdout/stderr 是否含 429 / spending cap 特征，若含
 * 且 opts.env.CECELIA_CREDENTIALS 可知，调 markSpendingCap 标记该账号为 capped。
 * 下次 attempt-loop 迭代时 account-rotation 自动换号。
 *
 * v2 P2 PR 5（本 PR）：建立模块 + 单测，暂不接线到 executeInDocker。
 * 未来 attempt-loop 整合 PR 在 runDocker 返回后调用它。
 *
 * 检测模式（任一命中即视为 capped）：
 *   - stdout/stderr 含 `api_error_status:429`
 *   - stdout/stderr 含 `"type":"rate_limit_error"`
 *   - stdout/stderr 含 `credit balance is too low`
 *
 * @param {object} result  runDocker 返回 { exit_code, stdout, stderr, ... }
 * @param {object} opts    executeInDocker 输入 { env: { CECELIA_CREDENTIALS } }
 * @param {object} ctx     { deps? } — 测试注入 { markSpendingCap }
 * @returns {Promise<{ capped: boolean, account: string|null, reason: string|null }>}
 */
const CAP_PATTERNS = [
  /api_error_status:\s*429/i,
  /"type"\s*:\s*"rate_limit_error"/i,
  /credit balance is too low/i,
];

export async function checkCap(result, opts, ctx = {}) {
  if (!result || typeof result !== 'object') {
    return { capped: false, account: null, reason: null };
  }
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  let matchedPattern = null;
  for (const p of CAP_PATTERNS) {
    if (p.test(combined)) {
      matchedPattern = p.source;
      break;
    }
  }
  if (!matchedPattern) {
    return { capped: false, account: null, reason: null };
  }
  const account = opts?.env?.CECELIA_CREDENTIALS || null;
  if (!account) {
    // 检测到 cap 但无法归账号，仅记录
    console.warn(`[cap-marking] detected cap pattern but no CECELIA_CREDENTIALS to mark`);
    return { capped: true, account: null, reason: matchedPattern };
  }
  try {
    let markFn;
    if (ctx.deps?.markSpendingCap) {
      markFn = ctx.deps.markSpendingCap;
    } else {
      const mod = await import('../../account-usage.js');
      markFn = mod.markSpendingCap;
    }
    markFn(account);
    console.log(`[cap-marking] marked ${account} as capped (pattern: ${matchedPattern})`);
  } catch (err) {
    console.warn(`[cap-marking] failed to mark ${account}: ${err.message}`);
  }
  return { capped: true, account, reason: matchedPattern };
}
```

### 2. `packages/brain/src/spawn/middleware/__tests__/cap-marking.test.js`

```js
import { describe, it, expect, vi } from 'vitest';
import { checkCap } from '../cap-marking.js';

function makeDeps(override = {}) {
  const calls = [];
  return {
    calls,
    deps: { markSpendingCap: (account) => calls.push(account), ...override },
  };
}

describe('checkCap() cap-marking middleware', () => {
  it('returns capped:false when stdout has no 429 pattern', async () => {
    const { deps } = makeDeps();
    const r = await checkCap({ stdout: 'all ok', stderr: '' }, { env: { CECELIA_CREDENTIALS: 'a1' } }, { deps });
    expect(r.capped).toBe(false);
  });

  it('returns capped:true and calls markSpendingCap on api_error_status:429', async () => {
    const { calls, deps } = makeDeps();
    const r = await checkCap({ stdout: 'fail api_error_status:429 rate', stderr: '' }, { env: { CECELIA_CREDENTIALS: 'a1' } }, { deps });
    expect(r.capped).toBe(true);
    expect(r.account).toBe('a1');
    expect(calls).toEqual(['a1']);
  });

  it('detects rate_limit_error JSON pattern in stderr', async () => {
    const { calls, deps } = makeDeps();
    const r = await checkCap({ stdout: '', stderr: '{"type":"rate_limit_error"}' }, { env: { CECELIA_CREDENTIALS: 'a2' } }, { deps });
    expect(r.capped).toBe(true);
    expect(calls).toEqual(['a2']);
  });

  it('detects credit balance too low', async () => {
    const { calls, deps } = makeDeps();
    const r = await checkCap({ stdout: 'credit balance is too low', stderr: '' }, { env: { CECELIA_CREDENTIALS: 'a3' } }, { deps });
    expect(r.capped).toBe(true);
    expect(calls).toEqual(['a3']);
  });

  it('returns capped:true but account:null when no CECELIA_CREDENTIALS', async () => {
    const { calls, deps } = makeDeps();
    const r = await checkCap({ stdout: 'api_error_status:429', stderr: '' }, { env: {} }, { deps });
    expect(r.capped).toBe(true);
    expect(r.account).toBeNull();
    expect(calls).toEqual([]);
  });

  it('returns capped:false when result is null/undefined', async () => {
    const { deps } = makeDeps();
    const r = await checkCap(null, { env: { CECELIA_CREDENTIALS: 'a1' } }, { deps });
    expect(r.capped).toBe(false);
  });
});
```

## 不做

- **不**接线到 `executeInDocker`（等后续整合 PR）
- **不**改 `routes/execution.js:798` 的 callback 路径
- **不**改 `account-usage.js` 的 markSpendingCap 实现
- **不**处理 reset time / 账号级 block timing（当前 markSpendingCap 有默认逻辑）

## DoD

- [BEHAVIOR] cap-marking.js export checkCap
  Test: `manual:node -e "import('./packages/brain/src/spawn/middleware/cap-marking.js').then(m => { if(typeof m.checkCap !== 'function') process.exit(1) })"`
- [BEHAVIOR] cap-marking test 存在
  Test: `manual:node -e "require('fs').accessSync('packages/brain/src/spawn/middleware/__tests__/cap-marking.test.js')"`
- [BEHAVIOR] executeInDocker 未被改动（本 PR 纯新增）
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(c.includes('checkCap(') || c.includes('cap-marking')) process.exit(1)"`
