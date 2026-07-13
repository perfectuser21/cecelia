# 协议卫生包实施计划（失败分类重试 + 告警去抖 + 副作用幂等）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 Brain 三个协议卫生缺口：失败分类重试 SSOT（四类各自 backoff 数组）、通用告警去抖（连续 N 次 + 冷却期，opt-in）、副作用 DB 级 dedupe_key 幂等（side_effect_dedupe 表 + 三入口接线）。

**Architecture:** 三个独立 lib 模块（`src/lib/retry-policy.js` / `src/lib/alert-debounce.js` / `src/lib/dedupe.js`）+ 最小侵入接线。`getRetryStrategy()` 签名返回结构一字不动；`raise()`/`createTask`/`sendFeishu` 均新增可选参数，存量调用零变更。设计文档：`docs/superpowers/specs/2026-07-09-protocol-hygiene-pack-design.md`。

**Tech Stack:** Node.js ESM（package.json type:module）、PostgreSQL（pg pool，`src/db.js` 默认导出）、vitest（`src/__tests__/` 同层就近，mock 用 `vi.mock`，真 DB 测试仿 `quarantine-classification.test.js`）。

## Global Constraints

- 全 ESM：`import`/`export`，禁 require。
- 时间源：dedupe 表相关全部 DB 端 `NOW()`，禁 JS `Date.now()` 混入 SQL。
- `getRetryStrategy` 返回字段名不可变：`should_retry` / `next_run_at` / `needs_human_review` / `billing_pause` / `reason`。
- fail-open 拍板：dedupe 任何 DB 错误 → `{claimed:true, degraded:true}`，不阻断主流程。
- P0 告警禁止套 debounce（首击即响）。
- 所有新测试必须可单文件跑（`npx vitest run src/__tests__/<file> --pool=forks`；brain 全量 vitest 有环境级 OOM 前科，验证一律单文件跑，禁全量）。
- TDD 死规矩：每个 Task commit-1 = failing test，commit-2 = 实现变绿。
- 实现提醒（审查裁决附带）：`isTransientClass` 把 `auth` 列入瞬态是沿用 `callback-processor.js` 现状语义，与 quarantine AUTH「不重试」并存，**不要顺手统一**。

---

### Task 1: retry-policy 查表模块

**Files:**
- Create: `packages/brain/src/lib/retry-policy.js`
- Test: `packages/brain/src/__tests__/retry-policy.test.js`

**Interfaces:**
- Produces: `RETRY_POLICY`（对象表）、`getBackoffMs(failureClass, retryCount) → number|null`、`getMaxRetries(failureClass) → number`、`isTransientClass(cls) → boolean`。Task 2/3 消费。

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/retry-policy.test.js
import { describe, it, expect } from 'vitest';
import { RETRY_POLICY, getBackoffMs, getMaxRetries, isTransientClass } from '../lib/retry-policy.js';

describe('retry-policy 查表', () => {
  it('四类各自 backoff 数组', () => {
    expect(RETRY_POLICY.rate_limit.backoffMs).toEqual([2 * 60_000, 4 * 60_000, 8 * 60_000]);
    expect(RETRY_POLICY.network.backoffMs).toEqual([5 * 60_000, 10 * 60_000, 15 * 60_000]);
    expect(RETRY_POLICY.timeout.backoffMs).toEqual([3 * 60_000, 6 * 60_000, 12 * 60_000]);
    expect(RETRY_POLICY.server_error.backoffMs).toEqual([1 * 60_000, 5 * 60_000, 15 * 60_000]);
  });

  it('getBackoffMs 按 retryCount 取数组元素', () => {
    expect(getBackoffMs('rate_limit', 0)).toBe(2 * 60_000);
    expect(getBackoffMs('rate_limit', 2)).toBe(8 * 60_000);
    expect(getBackoffMs('server_error', 1)).toBe(5 * 60_000);
  });

  it('retryCount 越界（≥maxRetries）返回 null', () => {
    expect(getBackoffMs('rate_limit', 3)).toBe(null);
    expect(getBackoffMs('network', 99)).toBe(null);
  });

  it('未知类别返回 null / maxRetries=0', () => {
    expect(getBackoffMs('no_such_class', 0)).toBe(null);
    expect(getMaxRetries('no_such_class')).toBe(0);
  });

  it('getMaxRetries 四类均为 3', () => {
    for (const cls of ['rate_limit', 'network', 'timeout', 'server_error']) {
      expect(getMaxRetries(cls)).toBe(3);
    }
  });

  it('isTransientClass：新旧瞬态类别判定（回归：server_error/timeout 与 network 同为瞬态）', () => {
    for (const cls of ['rate_limit', 'network', 'timeout', 'server_error', 'auth']) {
      expect(isTransientClass(cls)).toBe(true);
    }
    for (const cls of ['task_error', 'billing_cap', 'resource', 'unknown', undefined, null]) {
      expect(isTransientClass(cls)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/retry-policy.test.js --pool=forks`
Expected: FAIL（Cannot find module '../lib/retry-policy.js'）

- [ ] **Step 3: 最小实现**

```js
// packages/brain/src/lib/retry-policy.js
/**
 * retry-policy — 失败分类重试策略 SSOT（查表）
 *
 * 消费方：quarantine.js getRetryStrategy()（task 级、分钟级 next_run_at 退避）。
 *
 * ⚠️ 显式豁免：src/spawn/middleware/retry-circuit.js 不消费本表。
 * 理由：retry-circuit 是 attempt 级零 sleep 进程内循环（spawn.js attemptLoop，
 * 同步重试 3 次立即返回），消费分钟级 backoff 数组会让 spawn 阻塞占 slot 几分钟。
 * 两层语义不同（attempt 级瞬态重试 vs task 级退避重排），不要来"统一"。
 */

const MIN = 60_000;

// 类别 → backoff 数组（第 N 次重试等待 backoffMs[N]）+ 重试上限
const RETRY_POLICY = {
  rate_limit:   { backoffMs: [2 * MIN, 4 * MIN, 8 * MIN],   maxRetries: 3 }, // 指数（沿用现状）
  network:      { backoffMs: [5 * MIN, 10 * MIN, 15 * MIN], maxRetries: 3 }, // 线性长延迟（沿用现状）
  timeout:      { backoffMs: [3 * MIN, 6 * MIN, 12 * MIN],  maxRetries: 3 }, // 新独立类（原并入 network）
  server_error: { backoffMs: [1 * MIN, 5 * MIN, 15 * MIN],  maxRetries: 3 }, // 新独立类（5xx，原并入 network）
};

/**
 * 瞬态类别集中判定 — 替换下游散落的类别枚举
 * （callback-processor / routes/execution / quarantine.checkSystemicFailurePattern / routes/task-tasks）。
 *
 * ⚠️ 'auth' 在此列表是沿用 callback-processor.js 现状语义（auth 错误跳过熔断计数，
 * 因为是凭据问题而非系统健康问题）；与 quarantine getRetryStrategy 里 AUTH「不重试、
 * 需人工介入」的语义是两回事（是否重试 ≠ 是否计入失败），并存是刻意的，勿统一。
 */
const TRANSIENT_CLASSES = new Set(['rate_limit', 'network', 'timeout', 'server_error', 'auth']);

function getBackoffMs(failureClass, retryCount) {
  const policy = RETRY_POLICY[failureClass];
  if (!policy) return null;
  if (retryCount >= policy.maxRetries) return null;
  return policy.backoffMs[Math.min(retryCount, policy.backoffMs.length - 1)];
}

function getMaxRetries(failureClass) {
  return RETRY_POLICY[failureClass]?.maxRetries ?? 0;
}

function isTransientClass(cls) {
  return TRANSIENT_CLASSES.has(cls);
}

export { RETRY_POLICY, getBackoffMs, getMaxRetries, isTransientClass };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/retry-policy.test.js --pool=forks`
Expected: PASS（6 个用例全绿）

- [ ] **Step 5: 两次 commit（TDD 顺序）**

```bash
git add packages/brain/src/__tests__/retry-policy.test.js
git commit -m "test: retry-policy 查表模块 failing test（协议卫生包 T2）"
git add packages/brain/src/lib/retry-policy.js
git commit -m "feat(brain): retry-policy 失败分类重试 SSOT 查表（四类各自 backoff 数组）"
```

---

### Task 2: quarantine.js 拆分 TIMEOUT/SERVER_ERROR + getRetryStrategy 查表化

**Files:**
- Modify: `packages/brain/src/quarantine.js`（FAILURE_CLASS 约 L63、NETWORK_PATTERNS 约 L103、failureClassTTL 约 L176、getRetryStrategy 约 L730、checkSystemicFailurePattern 约 L885、export 块约 L1300）
- Test: `packages/brain/src/__tests__/quarantine-timeout-server-error.test.js`

**Interfaces:**
- Consumes: Task 1 的 `getBackoffMs`、`getMaxRetries`、`isTransientClass`。
- Produces: `FAILURE_CLASS.TIMEOUT = 'timeout'`、`FAILURE_CLASS.SERVER_ERROR = 'server_error'`、`TIMEOUT_PATTERNS`、`SERVER_ERROR_PATTERNS`（导出，测试用）。Task 3 消费类别字符串。

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/quarantine-timeout-server-error.test.js
import { describe, it, expect, beforeAll, vi } from 'vitest';

let classifyFailure, getRetryStrategy, FAILURE_CLASS;

beforeAll(async () => {
  vi.resetModules();
  ({ classifyFailure, getRetryStrategy, FAILURE_CLASS } = await import('../quarantine.js'));
});

describe('quarantine TIMEOUT/SERVER_ERROR 拆分（协议卫生包）', () => {
  it('新 FAILURE_CLASS 常量存在', () => {
    expect(FAILURE_CLASS.TIMEOUT).toBe('timeout');
    expect(FAILURE_CLASS.SERVER_ERROR).toBe('server_error');
  });

  it('5xx / internal server error / bad gateway → server_error（不再是 network）', () => {
    expect(classifyFailure('502 error from upstream').class).toBe('server_error');
    expect(classifyFailure('Internal Server Error').class).toBe('server_error');
    expect(classifyFailure('bad gateway').class).toBe('server_error');
    expect(classifyFailure('service unavailable').class).toBe('server_error');
  });

  it('ETIMEDOUT / timed out → timeout（不再是 network）', () => {
    expect(classifyFailure('connect ETIMEDOUT 1.2.3.4:443').class).toBe('timeout');
    expect(classifyFailure('request timed out after 30000ms').class).toBe('timeout');
  });

  it('ECONNREFUSED / socket hang up 仍是 network（回归）', () => {
    expect(classifyFailure('ECONNREFUSED: Connection refused').class).toBe('network');
    expect(classifyFailure('socket hang up').class).toBe('network');
  });

  it('429 仍是 rate_limit（回归：分类顺序 rate_limit 优先）', () => {
    expect(classifyFailure('429 too many requests').class).toBe('rate_limit');
  });

  it('getRetryStrategy timeout：3/6/12min 退避，返回结构不变', () => {
    const s0 = getRetryStrategy('timeout', { retryCount: 0 });
    expect(s0.should_retry).toBe(true);
    expect(new Date(s0.next_run_at).getTime() - Date.now()).toBeGreaterThan(2.9 * 60_000);
    expect(new Date(s0.next_run_at).getTime() - Date.now()).toBeLessThan(3.1 * 60_000);
    const s2 = getRetryStrategy('timeout', { retryCount: 2 });
    expect(new Date(s2.next_run_at).getTime() - Date.now()).toBeGreaterThan(11.9 * 60_000);
  });

  it('getRetryStrategy server_error：1/5/15min 退避', () => {
    const s0 = getRetryStrategy('server_error', { retryCount: 0 });
    expect(s0.should_retry).toBe(true);
    expect(new Date(s0.next_run_at).getTime() - Date.now()).toBeLessThan(1.1 * 60_000);
  });

  it('getRetryStrategy 耗尽（retryCount=3）→ needs_human_review（timeout/server_error 同 network 语义）', () => {
    for (const cls of ['timeout', 'server_error']) {
      const s = getRetryStrategy(cls, { retryCount: 3 });
      expect(s.should_retry).toBe(false);
      expect(s.needs_human_review).toBe(true);
    }
  });

  it('getRetryStrategy rate_limit/network 行为回归不变', () => {
    const rl = getRetryStrategy('rate_limit', { retryCount: 0 });
    expect(new Date(rl.next_run_at).getTime() - Date.now()).toBeGreaterThan(1.9 * 60_000);
    const nw = getRetryStrategy('network', { retryCount: 1 });
    expect(new Date(nw.next_run_at).getTime() - Date.now()).toBeGreaterThan(9.9 * 60_000);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/quarantine-timeout-server-error.test.js --pool=forks`
Expected: FAIL（FAILURE_CLASS.TIMEOUT undefined；5xx 被分类为 network）

- [ ] **Step 3: 改 quarantine.js**

3a. `FAILURE_CLASS` 加两项（在 `NETWORK: 'network',` 后）：

```js
  NETWORK: 'network',             // 网络 - 5min+ 延迟重试（避免暴力重试）
  TIMEOUT: 'timeout',             // 超时 - 3/6/12min 退避（协议卫生包拆自 NETWORK）
  SERVER_ERROR: 'server_error',   // 5xx 服务器错误 - 1/5/15min 退避（协议卫生包拆自 NETWORK）
```

3b. 从 `NETWORK_PATTERNS` 拆出两组（NETWORK_PATTERNS 中**删除**这些行）：

```js
const SERVER_ERROR_PATTERNS = [
  /5\d{2}\s+error|internal\s+server\s+error/i,
  /service\s+unavailable|bad\s+gateway/i,
  /upstream\s+connect\s+error/i,
];

const TIMEOUT_PATTERNS = [
  /ETIMEDOUT/i,
  /timed?\s*out/i,
  /lock\s+timeout/i,
];
```

⚠️ 注意：原 `NETWORK_PATTERNS` 第一行 `/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ENETUNREACH/i` 要把 `ETIMEDOUT` 摘出去改为 `/ECONNREFUSED|ENOTFOUND|ENETUNREACH/i`；原 `/deadlock\s+detected|lock\s+timeout/i` 拆为 network 保留 `/deadlock\s+detected/i`、timeout 拿走 `lock timeout`。`SYSTEMIC_PATTERNS`（legacy 合集）追加 `...SERVER_ERROR_PATTERNS, ...TIMEOUT_PATTERNS` 保持向后兼容覆盖面不变。

3c. `classifyFailure()` 的匹配顺序中，在 RATE_LIMIT 之后、NETWORK 之前插入 SERVER_ERROR、TIMEOUT 两组检查（更具体的先匹配）。找到现有逐组匹配逻辑（`RATE_LIMIT_PATTERNS` → `AUTH_PATTERNS` → `NETWORK_PATTERNS` 的顺序遍历处），插入：

```js
    for (const pattern of SERVER_ERROR_PATTERNS) {
      if (pattern.test(errorStr)) {
        return { class: FAILURE_CLASS.SERVER_ERROR, pattern: pattern.toString(), confidence: 0.9 };
      }
    }
    for (const pattern of TIMEOUT_PATTERNS) {
      if (pattern.test(errorStr)) {
        return { class: FAILURE_CLASS.TIMEOUT, pattern: pattern.toString(), confidence: 0.9 };
      }
    }
```

（返回对象的具体字段以该函数现有 network 分支为准照抄，含 retry_strategy 附带逻辑如有。）

3d. `getRetryStrategy()`：顶部 import Task 1 模块 `import { getBackoffMs, getMaxRetries } from './lib/retry-policy.js';`，RATE_LIMIT / NETWORK 两个 case 的 backoff 计算改为查表（**返回结构与 reason 文案格式保持一致**），并新增 TIMEOUT / SERVER_ERROR case：

```js
    case FAILURE_CLASS.RATE_LIMIT: {
      const backoffMs = getBackoffMs(FAILURE_CLASS.RATE_LIMIT, retryCount);
      if (backoffMs === null) {
        return { should_retry: false, needs_human_review: true, reason: 'Rate limit retries exhausted (3/3)' };
      }
      return {
        should_retry: true,
        next_run_at: new Date(Date.now() + backoffMs).toISOString(),
        reason: `Rate limited, retry #${retryCount + 1} in ${backoffMs / 60000}min`,
      };
    }

    case FAILURE_CLASS.NETWORK: {
      const backoffMs = getBackoffMs(FAILURE_CLASS.NETWORK, retryCount);
      if (backoffMs === null) {
        return { should_retry: false, needs_human_review: true, reason: 'Network retries exhausted (3/3)' };
      }
      return {
        should_retry: true,
        next_run_at: new Date(Date.now() + backoffMs).toISOString(),
        reason: `Network error, retry #${retryCount + 1} in ${backoffMs / 60000}min`,
      };
    }

    case FAILURE_CLASS.TIMEOUT:
    case FAILURE_CLASS.SERVER_ERROR: {
      const backoffMs = getBackoffMs(failureClass, retryCount);
      if (backoffMs === null) {
        return { should_retry: false, needs_human_review: true, reason: `${failureClass} retries exhausted (${getMaxRetries(failureClass)}/${getMaxRetries(failureClass)})` };
      }
      return {
        should_retry: true,
        next_run_at: new Date(Date.now() + backoffMs).toISOString(),
        reason: `${failureClass}, retry #${retryCount + 1} in ${backoffMs / 60000}min`,
      };
    }
```

（`NETWORK_RETRY_DELAY_MS` env 覆盖能力随查表化移除——该 env 从未在生产配置过；若 grep `.env*` 与 docker-compose 发现有配置则保留 env 读取并在 retry-policy.js 里消费，二选一，不留死变量。）

3e. `failureClassTTL`（quarantineTask 内约 L176）补两条：

```js
      rate_limit: 30 * 60 * 1000,             // 30 分钟
      network: 30 * 60 * 1000,                // 30 分钟
      timeout: 30 * 60 * 1000,                // 30 分钟（协议卫生包：拆自 network，TTL 同源）
      server_error: 30 * 60 * 1000,           // 30 分钟（协议卫生包：拆自 network，TTL 同源）
```

3f. `checkSystemicFailurePattern`（约 L885）白名单改为集中判定（保持排除 AUTH 的现状——这里 import `isTransientClass` 但 auth 语义不同，所以用显式列表补新类别，不硬套）：

```js
      if ([FAILURE_CLASS.NETWORK, FAILURE_CLASS.TIMEOUT, FAILURE_CLASS.SERVER_ERROR, FAILURE_CLASS.RATE_LIMIT, FAILURE_CLASS.BILLING_CAP, FAILURE_CLASS.RESOURCE].includes(c.class)) {
```

3g. export 块追加 `TIMEOUT_PATTERNS, SERVER_ERROR_PATTERNS`（细分模式测试用区）。

- [ ] **Step 4: 跑新测试 + 存量 quarantine 回归**

Run: `cd packages/brain && npx vitest run src/__tests__/quarantine-timeout-server-error.test.js --pool=forks`
Expected: PASS
Run: `cd packages/brain && npx vitest run src/__tests__/quarantine.test.js src/__tests__/quarantine-classification.test.js src/__tests__/quarantine-systemic.test.js src/__tests__/quarantine-billing-pause.test.js --pool=forks`
Expected: PASS（若存量断言「ETIMEDOUT→network」「5xx→network」而失败：这是本次刻意的语义变更，**更新该断言为新类别**并在 commit message 里说明，不是回退实现）

- [ ] **Step 5: 两次 commit**

```bash
git add packages/brain/src/__tests__/quarantine-timeout-server-error.test.js
git commit -m "test: quarantine TIMEOUT/SERVER_ERROR 拆分 failing test"
git add packages/brain/src/quarantine.js packages/brain/src/__tests__/
git commit -m "feat(brain): quarantine 拆分 timeout/server_error 独立退避 + getRetryStrategy 查表化"
```

---

### Task 3: 下游瞬态判定同步（防韧性回归）

**Files:**
- Modify: `packages/brain/src/callback-processor.js:284`（`['rate_limit','network','auth'].includes(...)`）
- Modify: `packages/brain/src/routes/execution.js:680`（`classification.class === 'network'` 连等判定）
- Modify: `packages/brain/src/routes/task-tasks.js:25-38`（`TTL_MAP` + 内联 `FAILURE_CLASS` 常量）
- Modify: `packages/brain/src/thalamus.js:850-869`（只加 TODO 注释）
- Test: `packages/brain/src/__tests__/transient-class-sync.test.js`

**Interfaces:**
- Consumes: Task 1 `isTransientClass`；Task 2 的新类别字符串。

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/transient-class-sync.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { isTransientClass } from '../lib/retry-policy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('下游瞬态判定同步（协议卫生包：防 5xx/timeout 被误计失败误隔离）', () => {
  it('isTransientClass 覆盖 callback-processor 语义（含 auth）', () => {
    expect(isTransientClass('server_error')).toBe(true);
    expect(isTransientClass('timeout')).toBe(true);
    expect(isTransientClass('auth')).toBe(true);
  });

  it('callback-processor.js 改用 isTransientClass，不再散落类别枚举', () => {
    const code = src('callback-processor.js');
    expect(code).toMatch(/isTransientClass/);
    expect(code).not.toMatch(/\['rate_limit',\s*'network',\s*'auth'\]\.includes/);
  });

  it('routes/execution.js 改用 isTransientClass', () => {
    const code = src('routes/execution.js');
    expect(code).toMatch(/isTransientClass/);
  });

  it('routes/task-tasks.js TTL_MAP 与 FAILURE_CLASS 常量补齐新类别', () => {
    const code = src('routes/task-tasks.js');
    expect(code).toMatch(/timeout:\s*\d/);
    expect(code).toMatch(/server_error:\s*\d/);
    expect(code).toMatch(/TIMEOUT:\s*'timeout'/);
    expect(code).toMatch(/SERVER_ERROR:\s*'server_error'/);
  });

  it('thalamus.js 重复分类表已标注不一致风险 TODO', () => {
    const code = src('thalamus.js');
    expect(code).toMatch(/TODO.*(retry-policy|quarantine).*不一致|TODO.*分类.*(retry-policy|quarantine)/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/transient-class-sync.test.js --pool=forks`
Expected: FAIL（callback-processor 无 isTransientClass 引用等）

- [ ] **Step 3: 四处修改**

3a. `callback-processor.js:284` 附近：

```js
      // 改前：const isTransientApiError = ['rate_limit', 'network', 'auth'].includes(classification.class);
      const { isTransientClass } = await import('./lib/retry-policy.js');
      const isTransientApiError = isTransientClass(classification.class);
```

（该处已在 `await import('./quarantine.js')` 的动态 import 块内，跟随同一风格用动态 import；bypassReason 字符串 `'rate_limit/network/auth'` 更新为 `'transient(rate_limit/network/timeout/server_error/auth)'`。）

3b. `routes/execution.js:680` 附近，把连等判定替换：

```js
        // 改前：isTransientApiError = classification.class === 'rate_limit' || === 'network' || === 'auth' || exit_code === 137;
        isTransientApiError = isTransientClass(classification.class) || exit_code === 137;
```

顶部静态 import：`import { isTransientClass } from '../lib/retry-policy.js';`（execution.js 若被 vitest mock 严格检查所困——参考 task-tasks.js 内联常量的先例注释——则改为函数内动态 import，与 callback-processor 同法。）

3c. `routes/task-tasks.js`：`TTL_MAP` 补 `timeout: 5 * 60 * 1000, server_error: 5 * 60 * 1000,`（与 network 同值）；内联 `FAILURE_CLASS` 常量补 `TIMEOUT: 'timeout', SERVER_ERROR: 'server_error',`。

3d. `thalamus.js:850` 分类 pattern 表上方加注释：

```js
// TODO(协议卫生包 follow-up): 本表是 quarantine.js classifyFailure 的独立重复实现，
// 5xx/timeout 在这里仍映射 'network'，与 retry-policy.js/quarantine.js 的拆分结果不一致。
// 短期接受（丘脑分类只影响 thalamus 决策文案，不进 failure_classification 落库链路）；
// 迁移方向：删本表改调 quarantine.classifyFailure。
```

- [ ] **Step 4: 跑测试确认通过 + 存量回归**

Run: `cd packages/brain && npx vitest run src/__tests__/transient-class-sync.test.js src/__tests__/callback-processor*.test.js --pool=forks`
Expected: PASS
Run: `cd packages/brain && npx vitest run src/routes/__tests__/ --pool=forks 2>/dev/null || npx vitest run src/__tests__/execution*.test.js --pool=forks`
Expected: PASS（无相关文件则跳过）

- [ ] **Step 5: 两次 commit**

```bash
git add packages/brain/src/__tests__/transient-class-sync.test.js
git commit -m "test: 下游瞬态判定同步 failing test"
git add packages/brain/src/callback-processor.js packages/brain/src/routes/execution.js packages/brain/src/routes/task-tasks.js packages/brain/src/thalamus.js
git commit -m "fix(brain): 下游瞬态判定改用 isTransientClass 集中判定，防 timeout/server_error 误计失败"
```

---

### Task 4: alert-debounce（opt-in）+ raise() 接入 + 示范消费方

**Files:**
- Create: `packages/brain/src/lib/alert-debounce.js`
- Modify: `packages/brain/src/alerting.js`（raise 签名 + P0/P1/P2 分支前置检查）
- Modify: `packages/brain/src/account-usage.js:321`（token_expiring_soon 示范接入）
- Test: `packages/brain/src/__tests__/alert-debounce.test.js`

**Interfaces:**
- Produces: `shouldFire(eventKey, {n, cooldownMs}) → boolean`、`resetDebounce(eventKey)`、`_debounceStatus()`（测试用）。`raise(level, eventType, message, opts?)` 第 4 参 `{debounce:{n, cooldownMs}}`。

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/alert-debounce.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../notifier.js', () => ({
  sendFeishu: vi.fn().mockResolvedValue(true),
}));

import { sendFeishu } from '../notifier.js';
import { shouldFire, resetDebounce, _debounceStatus } from '../lib/alert-debounce.js';
import { raise } from '../alerting.js';

describe('alert-debounce 核心', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('连续 N 次才放行：前 N-1 次 false，第 N 次 true', () => {
    const opts = { n: 3, cooldownMs: 60_000 };
    expect(shouldFire('ev-a', opts)).toBe(false);
    expect(shouldFire('ev-a', opts)).toBe(false);
    expect(shouldFire('ev-a', opts)).toBe(true);
  });

  it('放行后进入冷却：冷却期内继续 false，冷却结束后重新计数', () => {
    const opts = { n: 2, cooldownMs: 60_000 };
    shouldFire('ev-b', opts);
    expect(shouldFire('ev-b', opts)).toBe(true);   // 第2次放行
    expect(shouldFire('ev-b', opts)).toBe(false);  // 冷却中
    vi.advanceTimersByTime(61_000);
    expect(shouldFire('ev-b', opts)).toBe(false);  // 冷却结束，重新计数第1次
    expect(shouldFire('ev-b', opts)).toBe(true);   // 第2次再放行
  });

  it('resetDebounce 清零计数（恢复期单次失败不告警）', () => {
    const opts = { n: 2, cooldownMs: 60_000 };
    shouldFire('ev-c', opts);
    resetDebounce('ev-c');
    expect(shouldFire('ev-c', opts)).toBe(false); // 重新从 1 开始
  });

  it('n=1 首击即放行（纯冷却模式）', () => {
    const opts = { n: 1, cooldownMs: 60_000 };
    expect(shouldFire('ev-d', opts)).toBe(true);
    expect(shouldFire('ev-d', opts)).toBe(false);
  });

  it('Map 上限 1000 + 过期 GC（防内存泄漏，抄 notifier 教训）', () => {
    const opts = { n: 5, cooldownMs: 1_000 };
    for (let i = 0; i < 1100; i++) shouldFire(`ev-bulk-${i}`, opts);
    expect(_debounceStatus().entries).toBeLessThanOrEqual(1000);
  });
});

describe('raise() debounce opt-in + 三层串联不吞真告警', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('不传 debounce 完全走老路径（P0 立即发）', async () => {
    await raise('P0', `legacy-${Date.now()}-${Math.random()}`, '老路径回归');
    expect(sendFeishu).toHaveBeenCalledTimes(1);
  });

  it('P1 + debounce{n:2}：第 1 次不入 buffer，第 2 次入', async () => {
    const { getStatus } = await import('../alerting.js');
    const ev = `flap-${Date.now()}`;
    const before = getStatus().p1_pending;
    await raise('P1', ev, '抖动1', { debounce: { n: 2, cooldownMs: 60_000 } });
    expect(getStatus().p1_pending).toBe(before);
    await raise('P1', ev, '抖动2', { debounce: { n: 2, cooldownMs: 60_000 } });
    expect(getStatus().p1_pending).toBe(before + 1);
  });

  it('组合行为：debounce 放行的第一次真告警必达 P0 发送（debounce→P0限流 串联）', async () => {
    const ev = `combo-${Date.now()}`;
    await raise('P0', ev, '第1次', { debounce: { n: 2, cooldownMs: 600_000 } });
    expect(sendFeishu).not.toHaveBeenCalled();
    await raise('P0', ev, '第2次', { debounce: { n: 2, cooldownMs: 600_000 } });
    expect(sendFeishu).toHaveBeenCalledTimes(1); // debounce 放行后 P0 限流是首次，不吞
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/alert-debounce.test.js --pool=forks`
Expected: FAIL（Cannot find module '../lib/alert-debounce.js'）

- [ ] **Step 3: 实现 alert-debounce.js**

```js
// packages/brain/src/lib/alert-debounce.js
/**
 * alert-debounce — 通用告警去抖：连续 N 次才放行 + 放行后冷却期静默（opt-in）
 *
 * 与现有三层限流的关系（串联语义，本层最先）：
 *   debounce（连续N+冷却，opt-in） → alerting P0 5min/eventType 限流 → notifier 60s/eventKey 限流
 * 本层只决定"这次事件够不够格成为一条告警"；后两层是发送频控。
 *
 * ⚠️ P0 事件禁止套 debounce（首击即响）——见 alerting.js raise() 注释。
 * 纯内存态：Brain 重启（蓝绿部署）计数清零，接受此限制（P2 卫生包，不落 DB）。
 */

const _states = new Map(); // eventKey → { count, lastAt, cooldownUntil }
const _MAX_ENTRIES = 1000;
// 计数条目过期：两次事件间隔超过此值视为"不连续"，计数重置
const STALE_MS = 30 * 60 * 1000;

function _gc(now) {
  for (const [key, s] of _states) {
    if (now - s.lastAt >= STALE_MS && (s.cooldownUntil || 0) <= now) _states.delete(key);
  }
}

/**
 * @param {string} eventKey
 * @param {{n: number, cooldownMs: number}} opts - n=连续次数阈值；cooldownMs=放行后静默期
 * @returns {boolean} true=本次应告警
 */
function shouldFire(eventKey, { n, cooldownMs }) {
  const now = Date.now();
  if (_states.size >= _MAX_ENTRIES) _gc(now);
  if (_states.size >= _MAX_ENTRIES) {
    // 兜底：仍超限则删最旧（防 eventKey 基数失控撑爆内存）
    const oldest = [..._states.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)[0];
    if (oldest) _states.delete(oldest[0]);
  }

  const s = _states.get(eventKey) || { count: 0, lastAt: 0, cooldownUntil: 0 };

  if (now < s.cooldownUntil) {
    s.lastAt = now;
    _states.set(eventKey, s);
    return false; // 冷却期内静默
  }
  // 冷却刚结束或间隔过久 → 重新计数
  if (s.cooldownUntil && now >= s.cooldownUntil) s.count = 0;
  if (s.lastAt && now - s.lastAt >= STALE_MS) s.count = 0;
  s.cooldownUntil = 0;

  s.count += 1;
  s.lastAt = now;

  if (s.count >= n) {
    s.count = 0;
    s.cooldownUntil = now + cooldownMs;
    _states.set(eventKey, s);
    return true;
  }
  _states.set(eventKey, s);
  return false;
}

/** 成功/恢复路径调用：清零计数，防"累计 N 次"语义退化 */
function resetDebounce(eventKey) {
  _states.delete(eventKey);
}

/** 测试/状态查询用 */
function _debounceStatus() {
  return { entries: _states.size };
}

export { shouldFire, resetDebounce, _debounceStatus };
```

- [ ] **Step 4: 改 alerting.js raise()**

```js
import { shouldFire } from './lib/alert-debounce.js';

/**
 * 触发一条报警
 * @param {'P0'|'P1'|'P2'|'P3'} level
 * @param {string} eventType  - 事件类型标识（用于 P0 限流 key）
 * @param {string} message    - 人可读的报警信息
 * @param {Object} [opts]     - { debounce?: { n, cooldownMs } } 连续 N 次才响 + 冷却期（opt-in）
 *                              ⚠️ P0 宕机/熔断类事件禁止套 debounce——P0 的价值是首击即响；
 *                              debounce 只给抖动型事件（每周期重复触发的状态检测）。
 */
async function raise(level, eventType, message, opts = {}) {
  if (!VALID_LEVELS.includes(level)) {
    console.warn(`[alerting] 未知级别 ${level}，忽略`);
    return;
  }

  if (opts.debounce) {
    if (!shouldFire(eventType, opts.debounce)) {
      console.log(`[alerting] ${level} ${eventType} debounce 未达阈值/冷却中，跳过`);
      return;
    }
  }

  console.log(`[alerting] ${level} ${eventType}: ${message}`);
  // ……以下原有 P0/P1/P2 分支不动
```

- [ ] **Step 5: 示范消费方 account-usage.js token_expiring_soon（L321）**

```js
          // 改前：raise('P1', `token_expiring_soon_${accountId}`, `⏰ ...`).catch(() => {});
          raise('P1', `token_expiring_soon_${accountId}`,
            `⏰ ${accountId} OAuth token 将在 ${Math.floor(minsRemaining)} 分钟后过期 — 请提前刷新凭证`,
            { debounce: { n: 2, cooldownMs: 2 * 60 * 60 * 1000 } } // 连续2个检查周期确认才响，响后2h冷却
          ).catch(() => {});
```

- [ ] **Step 6: 跑测试确认通过 + alerting 回归**

Run: `cd packages/brain && npx vitest run src/__tests__/alert-debounce.test.js src/__tests__/alerting.test.js src/__tests__/account-usage.test.js --pool=forks`
Expected: PASS

- [ ] **Step 7: 两次 commit**

```bash
git add packages/brain/src/__tests__/alert-debounce.test.js
git commit -m "test: alert-debounce 连续N次+冷却期 failing test（含三层串联组合行为）"
git add packages/brain/src/lib/alert-debounce.js packages/brain/src/alerting.js packages/brain/src/account-usage.js
git commit -m "feat(brain): alert-debounce 通用告警去抖（opt-in）+ token_expiring_soon 示范接入"
```

---

### Task 5: side_effect_dedupe 表 + dedupe.js

**Files:**
- Create: `packages/brain/migrations/326_side_effect_dedupe.sql`
- Create: `packages/brain/src/lib/dedupe.js`
- Test: `packages/brain/src/__tests__/dedupe.test.js`（mock pg）
- Test: `packages/brain/src/__tests__/integration/dedupe.integration.test.js`（真 DB 并发竞态）

**Interfaces:**
- Produces: `claimDedupeKey(kind, key, ttlSec) → Promise<{claimed: boolean, degraded?: boolean}>`、`releaseDedupeKey(kind, key) → Promise<void>`。Task 6/7/8 消费。

- [ ] **Step 1: 写 migration**

```sql
-- packages/brain/migrations/326_side_effect_dedupe.sql
-- 协议卫生包：副作用短期去重表（建任务/spawn/发通知 三入口 DB 级幂等）
-- 语义：claim 即占位；过期行可被重占（ON CONFLICT DO UPDATE WHERE expired），无独立清理循环。
CREATE TABLE IF NOT EXISTS side_effect_dedupe (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  dedupe_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (kind, dedupe_key)
);

COMMENT ON TABLE side_effect_dedupe IS '副作用幂等短期去重（协议卫生包）：kind=create_task|spawn|notify';
```

- [ ] **Step 2: 写 failing test（mock pg）**

```js
// packages/brain/src/__tests__/dedupe.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => mockQuery(...a) } }));
vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));

import { raise } from '../alerting.js';
import { claimDedupeKey, releaseDedupeKey } from '../lib/dedupe.js';

describe('dedupe claimDedupeKey', () => {
  beforeEach(() => vi.clearAllMocks());

  it('抢占成功（rowCount=1）→ claimed:true', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] });
    const r = await claimDedupeKey('notify', 'k1', 300);
    expect(r.claimed).toBe(true);
    expect(r.degraded).toBeUndefined();
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/ON CONFLICT \(kind, dedupe_key\)/);
    expect(sql).toMatch(/expires_at < NOW\(\)/); // 过期即重占
    expect(sql).not.toMatch(/\$\{/); // 无模板注入
  });

  it('已被占（rowCount=0）→ claimed:false', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const r = await claimDedupeKey('spawn', 'task-123', 120);
    expect(r.claimed).toBe(false);
  });

  it('fail-open：DB 错误 → claimed:true + degraded:true + P2 降级告警', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const r = await claimDedupeKey('create_task', 'k2', 300);
    expect(r.claimed).toBe(true);
    expect(r.degraded).toBe(true);
    expect(raise).toHaveBeenCalledWith('P2', 'dedupe_degraded', expect.stringContaining('create_task'));
  });

  it('key 超 255 字符 → 抛错提示调用方自行 hash', async () => {
    await expect(claimDedupeKey('notify', 'x'.repeat(256), 60)).rejects.toThrow(/255/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('releaseDedupeKey 删除该 key（claim 后副作用失败时释放）', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await releaseDedupeKey('create_task', 'k3');
    expect(mockQuery.mock.calls[0][0]).toMatch(/DELETE FROM side_effect_dedupe/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['create_task', 'k3']);
  });

  it('releaseDedupeKey DB 错误全吞（不抛）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    await expect(releaseDedupeKey('notify', 'k4')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/dedupe.test.js --pool=forks`
Expected: FAIL（Cannot find module '../lib/dedupe.js'）

- [ ] **Step 4: 实现 dedupe.js**

```js
// packages/brain/src/lib/dedupe.js
/**
 * dedupe — 副作用 DB 级短期幂等（协议卫生包）
 *
 * 三个消费入口：actions.createTask（kind=create_task）/ executor 派发层（kind=spawn）
 * / notifier（kind=notify）。
 *
 * ⚠️ fail-open 拍板（decision 4ea9dcc5，勿改）：任何 DB 错误 → {claimed:true, degraded:true}。
 * 理由：通知宁可重复不可丢失（Bark 紧急告警丢了比重复严重）；spawn fail-closed
 * 等于 DB 抖动时全系统停派。降级时发 P2 dedupe_degraded 留痕。
 *
 * 时间源全部 DB 端 NOW()；过期行由下一次同 key claim 重占（ON CONFLICT DO UPDATE
 * WHERE expired），无独立清理循环（定时循环有 wave2 断链死亡前科）。
 */

import pool from '../db.js';
import { raise } from '../alerting.js';

const MAX_KEY_LEN = 255;

/**
 * 原子抢占去重 key。
 * @param {'create_task'|'spawn'|'notify'|string} kind
 * @param {string} key - ≤255 字符，超长调用方自行 hash（如 crypto sha256 hex）
 * @param {number} ttlSec
 * @returns {Promise<{claimed: boolean, degraded?: boolean}>}
 */
async function claimDedupeKey(kind, key, ttlSec) {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LEN) {
    throw new Error(`dedupe_key 必须是 1-${MAX_KEY_LEN} 字符字符串（超长请调用方自行 hash），got length=${key?.length}`);
  }
  try {
    const result = await pool.query(
      `INSERT INTO side_effect_dedupe (kind, dedupe_key, expires_at)
       VALUES ($1, $2, NOW() + make_interval(secs => $3))
       ON CONFLICT (kind, dedupe_key)
         DO UPDATE SET expires_at = NOW() + make_interval(secs => $3), created_at = NOW()
         WHERE side_effect_dedupe.expires_at < NOW()
       RETURNING id`,
      [kind, key, ttlSec]
    );
    return { claimed: result.rowCount === 1 };
  } catch (err) {
    console.error(`[dedupe] claim 降级（fail-open）: kind=${kind} key=${key}: ${err.message}`);
    raise('P2', 'dedupe_degraded', `dedupe 表不可用，${kind} 副作用 fail-open 放行（key=${key}）: ${err.message}`)
      .catch(() => {});
    return { claimed: true, degraded: true };
  }
}

/** claim 后副作用执行失败时释放，让 TTL 内的合法重试不被误挡。错误全吞。 */
async function releaseDedupeKey(kind, key) {
  try {
    await pool.query(
      'DELETE FROM side_effect_dedupe WHERE kind = $1 AND dedupe_key = $2',
      [kind, key]
    );
  } catch (err) {
    console.error(`[dedupe] release 失败（忽略，等 TTL 过期）: kind=${kind} key=${key}: ${err.message}`);
  }
}

export { claimDedupeKey, releaseDedupeKey };
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/dedupe.test.js --pool=forks`
Expected: PASS

- [ ] **Step 6: 写并发竞态 integration test（真 DB，仿 quarantine-classification.test.js 直连风格）**

```js
// packages/brain/src/__tests__/integration/dedupe.integration.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
let pool, claimDedupeKey;

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  ({ claimDedupeKey } = await import('../../lib/dedupe.js'));
  await pool.query(`DELETE FROM side_effect_dedupe WHERE kind = 'itest'`);
});

afterAll(async () => {
  await pool.query(`DELETE FROM side_effect_dedupe WHERE kind = 'itest'`);
});

describe('dedupe integration（真 DB）', () => {
  it('并发 10 个 claim 同 key，恰好 1 个成功', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => claimDedupeKey('itest', 'race-key', 60))
    );
    const winners = results.filter(r => r.claimed && !r.degraded);
    expect(winners.length).toBe(1);
  });

  it('过期行可被重占', async () => {
    const first = await claimDedupeKey('itest', 'expire-key', -1); // 立即过期
    expect(first.claimed).toBe(true);
    const second = await claimDedupeKey('itest', 'expire-key', 60);
    expect(second.claimed).toBe(true);
  });
});
```

Run: `cd packages/brain && node src/migrate.js && npx vitest run src/__tests__/integration/dedupe.integration.test.js --pool=forks`
Expected: PASS（本地有 cecelia DB；若 vitest.config 把 integration exclude 了，确认该文件被 brain-integration project 覆盖即可，不强行塞主 project）
注意：`make_interval(secs => -1)` 负值合法（Postgres 允许），立即过期语义成立。

- [ ] **Step 7: 两次 commit**

```bash
git add packages/brain/src/__tests__/dedupe.test.js packages/brain/src/__tests__/integration/dedupe.integration.test.js
git commit -m "test: side_effect_dedupe claim/release/fail-open/并发竞态 failing test"
git add packages/brain/migrations/326_side_effect_dedupe.sql packages/brain/src/lib/dedupe.js
git commit -m "feat(brain): side_effect_dedupe 短期去重表 + claimDedupeKey 原子抢占（fail-open）"
```

---

### Task 6: createTask 接入 dedupe_key

**Files:**
- Modify: `packages/brain/src/actions.js`（createTask，约 L95-160）
- Test: `packages/brain/src/__tests__/actions-dedupe-key.test.js`

**Interfaces:**
- Consumes: Task 5 `claimDedupeKey` / `releaseDedupeKey`。
- Produces: `createTask({..., dedupe_key?, dedupe_ttl_sec?})`；被去重返回 `{success:true, deduplicated:true, dedupe_key_hit:true}`。

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/actions-dedupe-key.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
let pool, createTask;

const TITLE = 'test-dedupe-key-task';

beforeAll(async () => {
  pool = (await import('../db.js')).default;
  ({ createTask } = await import('../actions.js'));
  await pool.query(`DELETE FROM tasks WHERE title LIKE $1`, [`${TITLE}%`]);
  await pool.query(`DELETE FROM side_effect_dedupe WHERE kind = 'create_task' AND dedupe_key LIKE 'test-dk-%'`);
});

afterAll(async () => {
  await pool.query(`DELETE FROM tasks WHERE title LIKE $1`, [`${TITLE}%`]);
  await pool.query(`DELETE FROM side_effect_dedupe WHERE kind = 'create_task' AND dedupe_key LIKE 'test-dk-%'`);
});

describe('createTask dedupe_key 幂等', () => {
  it('带 dedupe_key 二次调用 → 第二次 deduplicated:true 且不建新任务', async () => {
    const params = {
      title: `${TITLE}-1`, task_type: 'talk', trigger_source: 'auto',
      dedupe_key: 'test-dk-1', dedupe_ttl_sec: 300,
    };
    const r1 = await createTask(params);
    expect(r1.success).toBe(true);
    expect(r1.deduplicated).toBeFalsy();

    // 换 title 避开现有 title 24h 去重，单测 dedupe_key 这一层
    const r2 = await createTask({ ...params, title: `${TITLE}-2` });
    expect(r2.success).toBe(true);
    expect(r2.deduplicated).toBe(true);
    expect(r2.dedupe_key_hit).toBe(true);

    const count = await pool.query(`SELECT COUNT(*) AS c FROM tasks WHERE title LIKE $1`, [`${TITLE}%`]);
    expect(parseInt(count.rows[0].c, 10)).toBe(1);
  });

  it('不传 dedupe_key 行为完全不变（老路径回归）', async () => {
    const r = await createTask({ title: `${TITLE}-legacy`, task_type: 'talk', trigger_source: 'auto' });
    expect(r.success).toBe(true);
  });

  it('INSERT 抛错时释放 key（TTL 内重试不被误挡）', async () => {
    // goal_id 校验失败发生在 claim 之前 → key 不该被占
    await expect(createTask({
      title: `${TITLE}-fail`, task_type: 'dev', trigger_source: 'manual',
      dedupe_key: 'test-dk-fail', dedupe_ttl_sec: 300,
    })).rejects.toThrow(/goal_id/);
    const row = await pool.query(
      `SELECT 1 FROM side_effect_dedupe WHERE kind = 'create_task' AND dedupe_key = 'test-dk-fail' AND expires_at > NOW()`
    );
    expect(row.rowCount).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/actions-dedupe-key.test.js --pool=forks`
Expected: FAIL（r2.deduplicated 为 falsy——dedupe_key 参数被忽略）

- [ ] **Step 3: 改 createTask**

签名解构追加 `dedupe_key, dedupe_ttl_sec`；claim 位置在 goal_id 校验和现有 title 24h dedup 查询**之后**、`buildInsertStatement`/INSERT **之前**：

```js
async function createTask({ title, description, priority, project_id, goal_id, tags, task_type, context, prd_content, execution_profile, payload, trigger_source, domain: domainInput, owner_role: ownerRoleInput, delivery_type, journey_id, dedupe_key, dedupe_ttl_sec }) {
  // …… goal_id 校验（原有，不动）
  // …… title+goal_id+project_id 24h dedup 查询（原有，不动）

  // 协议卫生包：DB 级 dedupe_key 幂等（可选，跨 Brain 重启持久）
  let _dedupeClaimed = false;
  if (dedupe_key) {
    const { claimDedupeKey } = await import('./lib/dedupe.js');
    const claim = await claimDedupeKey('create_task', dedupe_key, dedupe_ttl_sec || 3600);
    if (!claim.claimed) {
      console.log(`[Action] Dedup (dedupe_key): task "${title}" skipped (key=${dedupe_key})`);
      return { success: true, deduplicated: true, dedupe_key_hit: true };
    }
    _dedupeClaimed = !claim.degraded;
  }

  try {
    // …… buildCommonParams / buildInsertStatement / pool.query INSERT / race 分支 / broadcast（原有整段包进 try）
    return { success: true, task };
  } catch (err) {
    if (_dedupeClaimed) {
      const { releaseDedupeKey } = await import('./lib/dedupe.js');
      await releaseDedupeKey('create_task', dedupe_key);
    }
    throw err;
  }
}
```

（用动态 import 跟随 callback-processor 同风格，避免 actions.js 顶层 import 触发 vitest mock 严格检查连锁。）

- [ ] **Step 4: 跑测试确认通过 + 存量 actions 回归**

Run: `cd packages/brain && npx vitest run src/__tests__/actions-dedupe-key.test.js src/__tests__/actions-dedup.test.js src/__tests__/actions.test.js --pool=forks`
Expected: PASS

- [ ] **Step 5: 两次 commit**

```bash
git add packages/brain/src/__tests__/actions-dedupe-key.test.js
git commit -m "test: createTask dedupe_key 幂等 failing test"
git add packages/brain/src/actions.js
git commit -m "feat(brain): createTask 可选 dedupe_key DB 级幂等（失败释放 key）"
```

---

### Task 7: executor 派发层接入 spawn dedupe

**Files:**
- Modify: `packages/brain/src/executor.js`（`=== DEDUP CHECK ===` 内存检查之后，约 L3380）
- Test: `packages/brain/src/__tests__/executor-spawn-dedupe.test.js`

**Interfaces:**
- Consumes: Task 5 `claimDedupeKey` / `releaseDedupeKey`。kind=`spawn`，key=`task.id`，TTL=120s（防 tick 重入双 spawn 的窗口）。

- [ ] **Step 1: 定位接线点**

在 executor.js 搜 `=== DEDUP CHECK ===`（activeProcesses 内存 pid 检查）。接线点：该内存检查（含 stale entry 清理）**之后**、`=== RESOURCE CHECK ===` **之前**。返回语义仿 already_running：

```js
    // 协议卫生包：DB 级 spawn 幂等（跨进程/跨重启防 tick 重入双 spawn；120s 短 TTL）
    // 内存 activeProcesses 检查覆盖同进程场景；本检查覆盖蓝绿窗口期双 Brain / 重启后状态丢失场景。
    // ⚠️ 不碰 harness-callback.js 的 containerId claim（那是 callback 重入幂等，语义不同）。
    const { claimDedupeKey, releaseDedupeKey } = await import('./lib/dedupe.js');
    const spawnClaim = await claimDedupeKey('spawn', String(task.id), 120);
    if (!spawnClaim.claimed) {
      console.log(`[executor] Task ${task.id} spawn dedupe hit (DB), skipping`);
      await trace.end({ status: STATUS.FAILED, error: new Error('Spawn deduplicated') });
      return { success: false, taskId: task.id, reason: 'spawn_deduplicated' };
    }
```

并在**同函数**后续的 spawn 失败路径（catch 块 / spawn 返回失败分支）加 `if (!spawnClaim.degraded) await releaseDedupeKey('spawn', String(task.id)).catch(() => {});`——spawn 没起来时 120s 内的合法重派不被误挡。spawn 成功则不释放（让 TTL 自然过期兜住重入窗口）。

- [ ] **Step 2: 写 failing test**

```js
// packages/brain/src/__tests__/executor-spawn-dedupe.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(__dirname, '..', 'executor.js'), 'utf8');

// executor.js 巨型模块依赖面太宽，行为级测试成本高（会拉起 langgraph/docker 链）；
// 本任务用源码结构断言锁接线点存在性 + dedupe.test.js 已覆盖 claim 行为本身。
describe('executor spawn dedupe 接线（结构断言）', () => {
  it('DEDUP CHECK 之后接了 DB 级 claimDedupeKey(spawn)', () => {
    const dedupCheckIdx = code.indexOf('=== DEDUP CHECK ===');
    const claimIdx = code.indexOf("claimDedupeKey('spawn'");
    expect(dedupCheckIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeGreaterThan(dedupCheckIdx);
  });

  it('被去重返回 spawn_deduplicated 语义', () => {
    expect(code).toMatch(/reason:\s*'spawn_deduplicated'/);
  });

  it('spawn 失败路径释放 key', () => {
    expect(code).toMatch(/releaseDedupeKey\('spawn'/);
  });

  it('不碰 harness-callback claim（该文件零改动）', () => {
    const cb = readFileSync(join(__dirname, '..', 'routes', 'harness-callback.js'), 'utf8');
    expect(cb).not.toMatch(/claimDedupeKey/);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/executor-spawn-dedupe.test.js --pool=forks`
Expected: FAIL（claimIdx = -1）

- [ ] **Step 4: 按 Step 1 实现，跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/executor-spawn-dedupe.test.js --pool=forks`
Expected: PASS
Run: `cd packages/brain && node --check src/executor.js`
Expected: 无输出（brain-deploy skip tests，SyntaxError 只有真启动才炸——冒烟死规矩）

- [ ] **Step 5: 两次 commit**

```bash
git add packages/brain/src/__tests__/executor-spawn-dedupe.test.js
git commit -m "test: executor spawn DB 级 dedupe 接线 failing test"
git add packages/brain/src/executor.js
git commit -m "feat(brain): executor 派发层 spawn dedupe（kind=spawn key=task.id TTL=120s，失败释放）"
```

---

### Task 8: notifier 接入可选 dedupeKey

**Files:**
- Modify: `packages/brain/src/notifier.js`（sendFeishu / sendBark，约 L100/L135）
- Test: `packages/brain/src/__tests__/notifier-dedupe.test.js`

**Interfaces:**
- Consumes: Task 5 `claimDedupeKey`。
- Produces: `sendFeishu(text, {dedupeKey?, dedupeTtlSec?})`、`sendBark(title, body, {dedupeKey?, dedupeTtlSec?})`——第 2/3 参可选对象，存量调用零变更。

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/notifier-dedupe.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClaim = vi.fn();
vi.mock('../lib/dedupe.js', () => ({
  claimDedupeKey: (...a) => mockClaim(...a),
  releaseDedupeKey: vi.fn(),
}));
vi.mock('../muted-guard.js', () => ({ isMuted: () => false }));

const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 200 }) });
global.fetch = mockFetch;
process.env.FEISHU_BOT_WEBHOOK = 'https://example.com/hook';

const { sendFeishu } = await import('../notifier.js');

describe('notifier dedupeKey（opt-in）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('不传 dedupeKey：不查 dedupe，直接发（老路径回归）', async () => {
    await sendFeishu('hello');
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('传 dedupeKey 且 claim 成功 → 发送', async () => {
    mockClaim.mockResolvedValueOnce({ claimed: true });
    const ok = await sendFeishu('hello', { dedupeKey: 'evt-1', dedupeTtlSec: 600 });
    expect(mockClaim).toHaveBeenCalledWith('notify', 'evt-1', 600);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it('传 dedupeKey 且已被占 → 跳过发送，返回 false', async () => {
    mockClaim.mockResolvedValueOnce({ claimed: false });
    const ok = await sendFeishu('hello', { dedupeKey: 'evt-2' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it('claim 抛错（never breaks main flow）→ 照发', async () => {
    mockClaim.mockRejectedValueOnce(new Error('boom'));
    const ok = await sendFeishu('hello', { dedupeKey: 'evt-3' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/notifier-dedupe.test.js --pool=forks`
Expected: FAIL（sendFeishu 忽略第 2 参，mockClaim 未被调）

- [ ] **Step 3: 改 notifier.js**

sendFeishu 开头（isMuted 检查之后）加：

```js
async function sendFeishu(text, opts = {}) {
  if (isMuted()) { /* 原有，不动 */ }

  // 协议卫生包：可选 DB 级幂等（与下方 60s 内存限流共存：限流是频控，这是跨重启幂等）
  // claim 异常全吞照发——notifier 铁律 never breaks main flow，通知宁可重复不可丢。
  if (opts.dedupeKey) {
    try {
      const { claimDedupeKey } = await import('./lib/dedupe.js');
      const claim = await claimDedupeKey('notify', opts.dedupeKey, opts.dedupeTtlSec || 600);
      if (!claim.claimed) {
        console.log(`[notifier] dedupe hit → skip (feishu): ${opts.dedupeKey}`);
        return false;
      }
    } catch (err) {
      console.error('[notifier] dedupe claim 异常，照发:', err.message);
    }
  }
  // …… 以下原有 Webhook/OpenAPI 逻辑不动
```

sendBark 同法加 `opts = {}` 第 3 参（BARK_TOKEN 检查之后、fetch 之前，同样 try/catch 全吞）。

⚠️ dedupe.js 内部 `raise('P2', 'dedupe_degraded', ...)` → alerting → sendFeishu 存在环：确认 dedupe_degraded 的 raise 是 P2（buffer 聚合，不即时调 sendFeishu），且 sendFeishu 的 claim 失败路径不再 raise（只 console.error），环不成立。在 notifier.js 该 catch 注释里写明这一点。

- [ ] **Step 4: 跑测试确认通过 + notifier 存量回归**

Run: `cd packages/brain && npx vitest run src/__tests__/notifier-dedupe.test.js src/__tests__/notifier.test.js src/__tests__/notifier-memleak.test.js src/__tests__/notifier-muted-gate.test.js --pool=forks`
Expected: PASS

- [ ] **Step 5: 两次 commit**

```bash
git add packages/brain/src/__tests__/notifier-dedupe.test.js
git commit -m "test: notifier dedupeKey opt-in failing test"
git add packages/brain/src/notifier.js
git commit -m "feat(brain): notifier 可选 dedupeKey DB 级幂等（异常全吞照发，防告警环）"
```

---

### Task 9: DevGate + 版本 bump + 收尾验证

**Files:**
- Modify: `packages/brain/package.json`（version minor bump）
- Modify: `packages/brain/src/selfcheck.js`（若 EXPECTED_SCHEMA_VERSION 跟 migration 编号联动则同步到 326）

- [ ] **Step 1: Brain 版本 bump**

```bash
cd packages/brain
# 读当前 version，minor +1（新功能）：如 1.243.2 → 1.244.0
node -e "const p=require('./package.json'); console.log(p.version)"
# 手动编辑 package.json version 字段；grep 检查是否有其它版本同步点：
grep -rn "$(node -e "console.log(require('./package.json').version)")" src/server.js src/selfcheck.js 2>/dev/null || true
bash ../../scripts/check-version-sync.sh
```

Expected: check-version-sync.sh 通过。

- [ ] **Step 2: selfcheck EXPECTED_SCHEMA_VERSION**

```bash
grep -n "EXPECTED_SCHEMA_VERSION" packages/brain/src/selfcheck.js
```

若其值为 migration 最新编号（325），改为 326；若是别的语义（schema hash 等），按其现有注释规则处理。

- [ ] **Step 3: DevGate 三连**

```bash
cd /Users/administrator/worktrees/cecelia/session-1ff8b3c4
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

Expected: 全部通过。失败则修复后重跑，禁止跳过。

- [ ] **Step 4: 全部新测试单文件逐个跑一遍（禁全量 vitest，OOM 前科）**

```bash
cd packages/brain
for f in retry-policy quarantine-timeout-server-error transient-class-sync alert-debounce dedupe actions-dedupe-key executor-spawn-dedupe notifier-dedupe; do
  npx vitest run "src/__tests__/${f}.test.js" --pool=forks || echo "FAIL: $f"
done
node --check src/server.js && node --check src/executor.js && node --check src/quarantine.js
```

Expected: 8 个文件全 PASS，node --check 无输出。

- [ ] **Step 5: commit**

```bash
git add packages/brain/package.json packages/brain/src/selfcheck.js
git commit -m "chore(brain): version bump + schema version 326（协议卫生包收尾）"
```

---

## Self-Review 记录

- **Spec coverage**：设计文档组件 1 → Task 1+2；下游同步节 → Task 3；组件 2 → Task 4；组件 3 → Task 5+6+7+8；兼容性/DevGate → Task 9。无遗漏。
- **Placeholder scan**：无 TBD；Task 2 Step 3c 的「以现有 network 分支为准照抄」是对既有代码结构的引用指令而非占位。
- **Type consistency**：`claimDedupeKey(kind, key, ttlSec) → {claimed, degraded?}` 在 Task 5/6/7/8 一致；`isTransientClass` 在 Task 1/3 一致；kind 三值 `create_task`/`spawn`/`notify` 全文一致。
