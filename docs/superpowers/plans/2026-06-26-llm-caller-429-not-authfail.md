# llm-caller 429 限流误判 auth 失败 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 superpowers:executing-plans 逐 task 实现。步骤用 checkbox（`- [ ]`）跟踪。

**Goal:** llm-caller 在因 bridge `exit code 1` 熔断账号前，先用 token 实时探测 usage API 二次确认——仅 token 真失效（401/403）才 markAuthFailure，429 限流/临时失败不再误熔断有效账号。

**Architecture:** 新增 `verifyAccountTokenLive(accountId)`（account-usage.js）实时探测 token 有效性；llm-caller 的 bridge exit-1 熔断 gate 改为 markAuthFailure 前 await 该探测，按 valid/auth_failed/unknown 决策。

**Tech Stack:** Node.js (ESM), vitest, 现有 cecelia-bridge + account-usage 熔断基础设施。

---

## File Structure

- `packages/brain/src/account-usage.js` — 新增导出 `verifyAccountTokenLive`（复用现有 `getAccessToken` + `ANTHROPIC_USAGE_API`）
- `packages/brain/src/llm-caller.js` — import 增加 `verifyAccountTokenLive`；改造 line 392-405 的 markAuthFailure gate
- `packages/brain/src/__tests__/account-usage-verify-token-live.test.js` — 新建，测 verifyAccountTokenLive
- `packages/brain/src/__tests__/llm-caller-429-not-authfail.test.js` — 新建，测 gate 行为
- `packages/brain/src/__tests__/llm-caller-bridge-circuit-hardening.test.js` — 修改：给 account-usage mock 补 `verifyAccountTokenLive`（默认 auth_failed，保持原熔断预期）

---

### Task 1: account-usage.js 新增 verifyAccountTokenLive + 单测

**Files:**
- Create: `packages/brain/src/__tests__/account-usage-verify-token-live.test.js`
- Modify: `packages/brain/src/account-usage.js`（在 `fetchUsageFromAPI` 之后，约 line 404 后追加）

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/account-usage-verify-token-live.test.js`：

```javascript
/**
 * verifyAccountTokenLive — 实时 token 有效性探测
 * 200→valid / 401|403→auth_failed / 429|其他|网络错误→unknown / 无token→unknown
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// account-usage.js 的副作用 import 全部 mock 掉
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn(async () => {}) }));
vi.mock('../alerting.js', () => ({ raise: vi.fn(async () => {}) }));
vi.mock('../auth-cache.js', () => ({
  isSpendingCapped: vi.fn(() => false),
  isAuthFailed: vi.fn(() => false),
}));
// getAccessToken 读 ~/.claude-<id>/.credentials.json
vi.mock('fs', () => ({
  readFileSync: vi.fn(() =>
    JSON.stringify({ claudeAiOauth: { accessToken: 'tok-test', expiresAt: Date.now() + 1e9 } })
  ),
}));

import { verifyAccountTokenLive } from '../account-usage.js';

describe('verifyAccountTokenLive', () => {
  let origFetch;
  beforeEach(() => { origFetch = global.fetch; global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = origFetch; });

  it('usage API 200 → valid', async () => {
    global.fetch.mockResolvedValue({ status: 200 });
    expect(await verifyAccountTokenLive('account1')).toBe('valid');
  });

  it('401 → auth_failed', async () => {
    global.fetch.mockResolvedValue({ status: 401 });
    expect(await verifyAccountTokenLive('account1')).toBe('auth_failed');
  });

  it('403 → auth_failed', async () => {
    global.fetch.mockResolvedValue({ status: 403 });
    expect(await verifyAccountTokenLive('account1')).toBe('auth_failed');
  });

  it('429 限流 → unknown（非 auth 失败）', async () => {
    global.fetch.mockResolvedValue({ status: 429 });
    expect(await verifyAccountTokenLive('account1')).toBe('unknown');
  });

  it('网络错误 → unknown', async () => {
    global.fetch.mockRejectedValue(new Error('network'));
    expect(await verifyAccountTokenLive('account1')).toBe('unknown');
  });
});
```

- [ ] **Step 2: 运行测试，确认 RED**

Run: `cd /Users/administrator/worktrees/cecelia/llm-caller-429-not-authfail/packages/brain && npx vitest run src/__tests__/account-usage-verify-token-live.test.js`
Expected: FAIL（`verifyAccountTokenLive is not a function` / not exported）

- [ ] **Step 3: 实现 verifyAccountTokenLive**

在 `packages/brain/src/account-usage.js` 的 `fetchUsageFromAPI` 函数之后追加：

```javascript
/**
 * 实时探测账号 OAuth token 有效性（绕过 CACHE_TTL 缓存）。
 * 用于 markAuthFailure 前二次确认：限流(429)会让 CLI exit-1 但 token 仍有效，不应熔断。
 * @param {string} accountId
 * @returns {Promise<'valid'|'auth_failed'|'unknown'>}
 *   valid       — usage API 200（token 有效）
 *   auth_failed — 401/403（token 真失效）
 *   unknown     — 无 token / 429 / 其他状态 / 网络错误（保守：调用方不应据此熔断）
 */
export async function verifyAccountTokenLive(accountId) {
  const token = getAccessToken(accountId);
  if (!token) return 'unknown';
  try {
    const res = await fetch(ANTHROPIC_USAGE_API, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'claude-code/2.0.31',
        'anthropic-beta': 'oauth-2025-04-20',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 200) return 'valid';
    if (res.status === 401 || res.status === 403) return 'auth_failed';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
```

- [ ] **Step 4: 运行测试，确认 GREEN**

Run: `cd /Users/administrator/worktrees/cecelia/llm-caller-429-not-authfail/packages/brain && npx vitest run src/__tests__/account-usage-verify-token-live.test.js`
Expected: PASS（5 passed）

- [ ] **Step 5: commit**

```bash
cd /Users/administrator/worktrees/cecelia/llm-caller-429-not-authfail
git add packages/brain/src/__tests__/account-usage-verify-token-live.test.js packages/brain/src/account-usage.js
git commit -m "test+feat(brain): account-usage 新增 verifyAccountTokenLive 实时 token 探测"
```

---

### Task 2: llm-caller gate 改造（429 不误熔断）

**Files:**
- Create: `packages/brain/src/__tests__/llm-caller-429-not-authfail.test.js`
- Modify: `packages/brain/src/llm-caller.js:21`（import）和 `:392-405`（gate）
- Modify: `packages/brain/src/__tests__/llm-caller-bridge-circuit-hardening.test.js`（补 mock）

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/llm-caller-429-not-authfail.test.js`：

```javascript
/**
 * llm-caller — bridge exit-1 熔断前 token 探测 gate
 * exit-1 达阈值后：token valid→不熔断 / auth_failed→熔断 / unknown→不熔断（保守）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockMarkAuthFailure = vi.hoisted(() => vi.fn());
const mockSelectBestAccount = vi.hoisted(() => vi.fn());
const mockVerifyToken = vi.hoisted(() => vi.fn());

vi.mock('../account-usage.js', () => ({
  selectBestAccount: mockSelectBestAccount,
  markAuthFailure: mockMarkAuthFailure,
  verifyAccountTokenLive: mockVerifyToken,
}));
vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn(() => ({
    config: { cortex: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
  })),
}));
vi.mock('../langfuse-reporter.js', () => ({ reportCall: vi.fn().mockResolvedValue(undefined) }));
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => { throw new Error('File not found'); }),
}));

function makeBridgeExit1Response() {
  return { ok: false, status: 500, text: async () => JSON.stringify({ ok: false, error: 'exit code 1', elapsed_ms: 1200 }) };
}

let callLLM, _resetBridgeCircuitState;

describe('llm-caller — exit-1 熔断前 token 探测 gate', () => {
  let origFetch;
  beforeEach(async () => {
    origFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue(makeBridgeExit1Response());
    mockMarkAuthFailure.mockClear();
    mockVerifyToken.mockReset();
    mockSelectBestAccount.mockReset();
    mockSelectBestAccount.mockResolvedValue({ accountId: 'account1', model: 'sonnet' });
    const mod = await import('../llm-caller.js');
    callLLM = mod.callLLM;
    _resetBridgeCircuitState = mod._resetBridgeCircuitState;
    _resetBridgeCircuitState();
  });
  afterEach(() => { global.fetch = origFetch; });

  it('exit-1 达阈值 + token 探测 valid → 不 markAuthFailure（限流不误熔断）', async () => {
    mockVerifyToken.mockResolvedValue('valid');
    await expect(
      callLLM('cortex', '测试', { provider: 'anthropic', model: 'claude-sonnet-4-6' })
    ).rejects.toThrow();
    expect(mockMarkAuthFailure).not.toHaveBeenCalled();
  });

  it('exit-1 达阈值 + token 探测 auth_failed → markAuthFailure', async () => {
    mockVerifyToken.mockResolvedValue('auth_failed');
    await expect(
      callLLM('cortex', '测试', { provider: 'anthropic', model: 'claude-sonnet-4-6' })
    ).rejects.toThrow();
    expect(mockMarkAuthFailure).toHaveBeenCalled();
    expect(mockMarkAuthFailure.mock.calls[0][0]).toBe('account1');
    expect(mockMarkAuthFailure.mock.calls[0][2]).toBe('api_error');
  });

  it('exit-1 达阈值 + token 探测 unknown → 不 markAuthFailure（保守）', async () => {
    mockVerifyToken.mockResolvedValue('unknown');
    await expect(
      callLLM('cortex', '测试', { provider: 'anthropic', model: 'claude-sonnet-4-6' })
    ).rejects.toThrow();
    expect(mockMarkAuthFailure).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试，确认 RED**

Run: `cd /Users/administrator/worktrees/cecelia/llm-caller-429-not-authfail/packages/brain && npx vitest run src/__tests__/llm-caller-429-not-authfail.test.js`
Expected: FAIL — 第 1 个用例（valid→不熔断）失败，因当前代码不探测直接 markAuthFailure。

- [ ] **Step 3: 改 import（llm-caller.js:21）**

```javascript
import { selectBestAccount, markAuthFailure, verifyAccountTokenLive } from './account-usage.js';
```

- [ ] **Step 4: 改 gate（llm-caller.js，替换 line 395-404 的 `if (count >= BRIDGE_EXIT1_THRESHOLD) { ... }` 整块）**

```javascript
        if (count >= BRIDGE_EXIT1_THRESHOLD) {
          // 限流(429)会让 claude CLI exit-1，但 token 仍有效——不能当 auth 失败熔断。
          // markAuthFailure 前用 usage API 实时探测二次确认：仅 token 真失效才熔断。
          let tokenState = 'unknown';
          try {
            tokenState = await verifyAccountTokenLive(accountId);
          } catch (probeErr) {
            console.warn(`[llm-caller] [bridge-circuit] ${accountId}: token 探测异常 ${probeErr.message}，保守不熔断`);
          }
          if (tokenState === 'auth_failed') {
            try {
              const resetTime = new Date(Date.now() + BRIDGE_EXIT1_RESET_MS).toISOString();
              markAuthFailure(accountId, resetTime, 'api_error');
              console.warn(`[llm-caller] [bridge-circuit] ${accountId}: 连续 ${count} 次 exit-code-1 且 token 探测=auth_failed，熔断 1h`);
            } catch (mafErr) {
              console.warn(`[llm-caller] [bridge-circuit] markAuthFailure 失败: ${mafErr.message}`);
            }
          } else {
            console.warn(`[llm-caller] [bridge-circuit] ${accountId}: 连续 ${count} 次 exit-code-1 但 token 探测=${tokenState}（疑似限流，非 auth 失败），不熔断`);
          }
          _resetBridgeExit1(accountId);
        }
```

- [ ] **Step 5: 给现有 hardening 测试补 verifyAccountTokenLive mock**

修改 `packages/brain/src/__tests__/llm-caller-bridge-circuit-hardening.test.js`：
1. 顶部 hoisted 区（约 line 17 后）加：
```javascript
const mockVerifyToken = vi.hoisted(() => vi.fn());
```
2. `vi.mock('../account-usage.js', ...)`（line 19-22）改为：
```javascript
vi.mock('../account-usage.js', () => ({
  selectBestAccount: mockSelectBestAccount,
  markAuthFailure: mockMarkAuthFailure,
  verifyAccountTokenLive: mockVerifyToken,
}));
```
3. `beforeEach`（约 line 91 mockMarkAuthFailure.mockClear() 附近）加：
```javascript
    mockVerifyToken.mockReset();
    mockVerifyToken.mockResolvedValue('auth_failed'); // 保持原"3次exit-1→熔断"预期
```

- [ ] **Step 6: 运行全部相关测试，确认 GREEN**

Run: `cd /Users/administrator/worktrees/cecelia/llm-caller-429-not-authfail/packages/brain && npx vitest run src/__tests__/llm-caller-429-not-authfail.test.js src/__tests__/llm-caller-bridge-circuit-hardening.test.js src/__tests__/account-usage-verify-token-live.test.js`
Expected: 全部 PASS

- [ ] **Step 7: commit**

```bash
cd /Users/administrator/worktrees/cecelia/llm-caller-429-not-authfail
git add packages/brain/src/llm-caller.js packages/brain/src/__tests__/llm-caller-429-not-authfail.test.js packages/brain/src/__tests__/llm-caller-bridge-circuit-hardening.test.js
git commit -m "fix(brain): llm-caller 熔断前 token 探测，429 限流不再误判 auth 失败"
```

---

### Task 3: DevGate + 全量回归

- [ ] **Step 1: DevGate 三件套**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/llm-caller-429-not-authfail
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全部通过（本 PR 不改 DEFINITION.md/版本，facts-check 应绿）

- [ ] **Step 2: 全量 brain 测试无回归**

Run: `cd /Users/administrator/worktrees/cecelia/llm-caller-429-not-authfail/packages/brain && npx vitest run src/__tests__/llm-caller-account-selection.test.js src/__tests__/llm-caller-bridge-circuit-hardening-task-c.test.js src/__tests__/account-usage.test.js`
Expected: 全部 PASS（确认改动未破坏相邻测试）

---

## DoD（PR 描述用）

- [ARTIFACT] `verifyAccountTokenLive` 已导出 — `manual:node -e "const m=require('fs').readFileSync('packages/brain/src/account-usage.js','utf8'); process.exit(m.includes('export async function verifyAccountTokenLive')?0:1)"`
- [BEHAVIOR] exit-1 达阈值 + token valid 不熔断 — `tests/`: `packages/brain/src/__tests__/llm-caller-429-not-authfail.test.js`
- [BEHAVIOR] verifyAccountTokenLive 200→valid/401→auth_failed/429→unknown — `tests/`: `packages/brain/src/__tests__/account-usage-verify-token-live.test.js`
