# v2 P2 PR5 cap-marking Middleware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** 建立 `packages/brain/src/spawn/middleware/cap-marking.js`（`checkCap` 函数）+ 6 cases 单测。**不**接线 executeInDocker（纯新增）。

**Architecture:** 纯函数 — 匹配 stdout/stderr 3 个 cap pattern regex，若命中且能定位 CECELIA_CREDENTIALS，调 markSpendingCap。ctx.deps 注入支持测试。

**Tech Stack:** Node.js ESM + vitest。

---

## File Structure

- **Create** `packages/brain/src/spawn/middleware/cap-marking.js`
- **Create** `packages/brain/src/spawn/middleware/__tests__/cap-marking.test.js`

---

### Task 1: 建 cap-marking.js

- [ ] **Step 1: 用 Write 写 `packages/brain/src/spawn/middleware/cap-marking.js`**

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

- [ ] **Step 2: 语法 + import smoke**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr5-cap-marking && node --check packages/brain/src/spawn/middleware/cap-marking.js && node -e "import('./packages/brain/src/spawn/middleware/cap-marking.js').then(m => { if(typeof m.checkCap !== 'function') process.exit(1); console.log('ok'); })"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr5-cap-marking && git add packages/brain/src/spawn/middleware/cap-marking.js && git commit -m "feat(brain): v2 P2 PR5 新增 spawn/middleware/cap-marking.js"
```

---

### Task 2: 建单测

- [ ] **Step 1: 用 Write 写 `packages/brain/src/spawn/middleware/__tests__/cap-marking.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { checkCap } from '../cap-marking.js';

function makeDeps(override = {}) {
  const calls = [];
  return {
    calls,
    deps: { markSpendingCap: (account) => calls.push(account), ...override },
  };
}

describe('checkCap() cap-marking middleware', () => {
  it('returns capped:false when stdout has no cap pattern', async () => {
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

- [ ] **Step 2: 语法 + vitest**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr5-cap-marking && node --check packages/brain/src/spawn/middleware/__tests__/cap-marking.test.js && npx vitest run packages/brain/src/spawn/middleware/__tests__/cap-marking.test.js 2>&1 | tail -10
```

Expected: 6/6 pass

- [ ] **Step 3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr5-cap-marking && git add packages/brain/src/spawn/middleware/__tests__/cap-marking.test.js && git commit -m "test(brain): v2 P2 PR5 cap-marking middleware 单测 (6 cases)"
```

---

### Task 3: DoD 终验

- [ ] **DoD 1 — cap-marking.js export checkCap**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr5-cap-marking && node -e "import('./packages/brain/src/spawn/middleware/cap-marking.js').then(m => { if(typeof m.checkCap !== 'function') process.exit(1) })" ; echo "exit=$?"
```

- [ ] **DoD 2 — test 存在**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr5-cap-marking && node -e "require('fs').accessSync('packages/brain/src/spawn/middleware/__tests__/cap-marking.test.js')" ; echo "exit=$?"
```

- [ ] **DoD 3 — executeInDocker 未被改**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr5-cap-marking && node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8'); if(c.includes('checkCap(') || c.includes('cap-marking')) process.exit(1)" ; echo "exit=$?"
```

- [ ] **facts-check**
```bash
cd /Users/administrator/worktrees/cecelia/v2-p2-pr5-cap-marking && node scripts/facts-check.mjs 2>&1 | tail -3
```

Expected 全 `exit=0` + `All facts consistent.`

---

## Self-Review

| Spec 要求 | Task |
|---|---|
| cap-marking.js export checkCap | Task 1 |
| 3 个 cap pattern 检测 | Task 1 Step 1（CAP_PATTERNS 数组） |
| markSpendingCap 调用（有 account 时） | Task 1 Step 1 |
| ctx.deps 注入支持 | Task 1 Step 1 |
| 6 cases 单测 | Task 2 |
| DoD 3 条 | Task 3 |

Placeholder scan: 无。
Type consistency: checkCap(result, opts, ctx) 一致。
Scope: 不改 executeInDocker / execution.js / account-usage.js。
