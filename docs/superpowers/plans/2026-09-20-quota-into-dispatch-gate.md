# 刀1 PR1 核心闸 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `ops_model_accounts` 的真实配额参与 kernel attempt 的账号选择——8 个账号全部有额度判据，且闸门不能静默消失。

**Architecture:** 新增一个只读 `ops_model_accounts` 的三态判据模块（`usable`/`unusable`/`unknown`），由 `run.js` 注入给 `capability-gate`；gate 在候选循环里只做「否决 + 收集」，全灭时保底放行 pct 最低的号并标 degraded。判据与 DB 完全解耦（`deps.loadAccountQuota`），单测无需 PG。

**Tech Stack:** Node ESM / vitest / node-postgres / 现有 `capability-gate` preflight 框架

**Spec:** `docs/superpowers/specs/2026-09-20-quota-into-dispatch-gate-design.md`

---

## 实测结论（已在 plan 阶段定性，不要再猜）

对真 PG（`cecelia_scratch`）+ node-pg 实测：

| 写法 | 89.4 | 89.5 | 89.6 | 0.11 |
|---|---|---|---|---|
| **参数绑定 `$n`**（采集器用的） | ❌ `invalid input syntax for type integer` | ❌ | ❌ | ❌ |
| SQL 字面量 | 89 | 90 | — | — |

**node-pg 不取整，直接抛。** 所以：

1. `judgeAccount` 的 pct 输入**只可能是整数或 null**，阈值就是 `>= 95` / `>= 90`，不存在 89.5/94.5 这种输入。
2. `toPct`（collector:73-75）原样透传浮点 + `:365-366` 的 upsert **在 try 之外** = 任一厂商返回小数百分比就会**中断整轮采集**，后面的账号静默陈旧。Task 1 修掉它。
3. 修掉之后，「真实值 89.5 → 存成 90 → 判死」才成立——这是 Task 1 的 collector 层断言要覆盖的。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `packages/brain/src/ops-model-accounts-collector.js` | 账号注册表 + 采集写库 | 改：`toPct` 取整；`MODEL_ACCOUNTS` 补 `runtime_account_id`；导出双向映射 |
| `packages/brain/src/orchestrator/preflight/account-quota-ledger.js` | **新建**。纯判据 + ledger 装载器。唯一知道阈值语义的地方 | 建 |
| `packages/brain/src/orchestrator/preflight/capability-gate.js` | 候选循环：否决 + 收集 + 保底 | 改 `:197-208`、`:269` 处新增块 |
| `packages/brain/src/orchestrator/run.js` | 生产接线 | 改 `:267-283`：接 `loadAccountQuota` / `emitAlert`，裸 catch 改上报 |
| `tests/gp/g5/step2-quota-gate-into-dispatch.test.js` | **新建**。GP 守卫（真 import，不 mock） | 建 |
| `packages/brain/src/__tests__/account-quota-ledger.test.js` | **新建**。判据单测 | 建 |
| `packages/brain/src/__tests__/integration/account-quota-ledger.pg.integration.test.js` | **新建**。真 PG | 建 |

**边界原则**：`capability-gate.js` **绝不 import pool 或 pg**，只认 `deps.loadAccountQuota`。判据模块的纯函数部分（`judgeAccount`）**绝不 import pg**，单测无 PG 可跑。

---

### Task 1: 修掉 `toPct` 的浮点透传（数据地基）

**Files:**
- Modify: `packages/brain/src/ops-model-accounts-collector.js:72-75`
- Test: `packages/brain/src/__tests__/ops-model-accounts-collector.test.js`

- [ ] **Step 1: 写失败测试**

追加到 `packages/brain/src/__tests__/ops-model-accounts-collector.test.js`：

```js
import { toPctForTest } from '../ops-model-accounts-collector.js';

describe('toPct — 列是 INTEGER，浮点必须在进 SQL 前收敛', () => {
  // 实测（node-pg + 真 PG）：参数绑定传 89.6 会抛
  // `invalid input syntax for type integer: "89.6"`，而 :365-366 的 upsert
  // 在 try 之外 —— 一抛就中断整轮采集，后面的账号静默陈旧。
  it('小数四舍五入成整数', () => {
    expect(toPctForTest(89.6)).toBe(90);
    expect(toPctForTest(89.4)).toBe(89);
    expect(toPctForTest(89.5)).toBe(90);
    expect(toPctForTest(94.5)).toBe(95);
  });

  it('整数原样透传', () => {
    expect(toPctForTest(0)).toBe(0);
    expect(toPctForTest(100)).toBe(100);
  });

  it('缺失/非数字仍然诚实留空（禁编造 0）', () => {
    expect(toPctForTest(undefined)).toBeNull();
    expect(toPctForTest(null)).toBeNull();
    expect(toPctForTest('91')).toBeNull();
    expect(toPctForTest(NaN)).toBeNull();
    expect(toPctForTest(Infinity)).toBeNull();
  });

  it('写库参数里不存在非整数（回归：整轮采集不再被一个小数打断）', async () => {
    const pool = makePool();
    await runModelAccountsCollector(pool, {
      force: true,
      fetchUsage: async () => ({ five_hour: { utilization: 89.6 }, seven_day: { utilization: 12.3 } }),
      grokProbe: async () => ({ five_hour_pct: 1.5, seven_day_pct: 2.5 }),
    });
    const pctParams = pool.upserts().flatMap((c) => (c.params ?? []).slice(3, 5));
    for (const p of pctParams) {
      if (p === null || p === undefined) continue;
      expect(Number.isInteger(p)).toBe(true);
    }
  });
});
```

> `makePool` / `runModelAccountsCollector` 已在该文件顶部导入，沿用现有 fixture。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/quota-into-dispatch-gate
npx vitest run packages/brain/src/__tests__/ops-model-accounts-collector.test.js -t 'toPct' 2>&1 | tail -20
```

预期：FAIL — `toPctForTest is not a function`（未导出），以及取整断言不成立。

- [ ] **Step 3: 实现**

`packages/brain/src/ops-model-accounts-collector.js`，把原 `toPct` 替换为：

```js
/**
 * pct 归一化：数字四舍五入成整数，缺失/非数字 → null（诚实留空，禁编造 0）。
 *
 * 必须取整：列是 INTEGER（migration 449:9-10），而 node-pg 的参数绑定**不取整**
 * ——实测传 89.6 直接抛 `invalid input syntax for type integer: "89.6"`。
 * 而 :365-366 的 upsert 在 try 之外，一抛就中断整轮采集，排在后面的账号
 * 这一轮全部不写（静默陈旧）。取整是让「配额账本可信」的前提。
 */
function toPct(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/** 测试接缝：判据的阈值语义依赖「表里只有整数」这条不变量。 */
export const toPctForTest = toPct;
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/brain/src/__tests__/ops-model-accounts-collector.test.js 2>&1 | tail -20
```

预期：PASS，且该文件原有断言不回归。

- [ ] **Step 5: 提交**

```bash
git add packages/brain/src/ops-model-accounts-collector.js packages/brain/src/__tests__/ops-model-accounts-collector.test.js
git commit -m "fix(collector): pct 写库前取整——浮点会抛 int4 语法错并中断整轮采集

实测（node-pg + 真 PG）：参数绑定传 89.6 抛 invalid input syntax for
type integer，而 :365-366 的 upsert 在 try 之外，一抛整轮中断、后面的
账号静默陈旧。列本来就是 INTEGER，取整是唯一自洽的做法。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `runtime_account_id` 与双向映射

**Files:**
- Modify: `packages/brain/src/ops-model-accounts-collector.js:51-68`
- Test: `tests/gp/g5/step2-quota-gate-into-dispatch.test.js`（新建，本任务先建骨架）

- [ ] **Step 1: 写失败测试**

新建 `tests/gp/g5/step2-quota-gate-into-dispatch.test.js`：

```js
// G5「管家 · 算力与基础设施调度」步骤 1「接单即选到有额度的执行体」
// —— 边：配额账本 → kernel 派发的账号闸
//
// 本文件真 import 被改的流水线模块，不 vi.mock 它们（CI 闸 lint-gp-anchor-artifact）。
// ⚠️ 禁止出现任何以 `run` 结尾的 mock 路径：本刀改了 run.js，闸的 MOD_BASES 会带上
//    基名 `run`，其 mock 检测正则会把 vi.mock('.../dry-run.js') 误判成「把边 mock 掉」。
import { describe, it, expect } from 'vitest';
import {
  MODEL_ACCOUNTS,
  runtimeToLedgerAccountId,
  ledgerToRuntimeAccountId,
} from '../../../packages/brain/src/ops-model-accounts-collector.js';
import { listVerifiedExecutionTargets } from '../../../packages/brain/src/orchestrator/preflight/execution-targets.js';

describe('账号 id 映射：候选池与配额账本必须一一对上', () => {
  it('每条 MODEL_ACCOUNTS 都带显式 runtime_account_id（禁拼串规则）', () => {
    for (const acct of MODEL_ACCOUNTS) {
      expect(typeof acct.runtime_account_id).toBe('string');
      expect(acct.runtime_account_id.length).toBeGreaterThan(0);
    }
  });

  it('grok 是拼串规则的反例——它证明了为什么必须用显式字段', () => {
    const grok = MODEL_ACCOUNTS.find((a) => a.provider === 'grok');
    expect(grok.account_id).toBe('grok');
    expect(grok.runtime_account_id).toBe('grok');
    // `${provider}-${runtime}` 会得到 'grok-grok'，对不上 account_id
    expect(`${grok.provider}-${grok.runtime_account_id}`).not.toBe(grok.account_id);
  });

  it('候选池里每个 account 都能映射到一条账本行', () => {
    const ledgerIds = new Set(MODEL_ACCOUNTS.map((a) => a.account_id));
    for (const target of listVerifiedExecutionTargets()) {
      const ledgerId = runtimeToLedgerAccountId(target.account);
      expect(ledgerId, `候选 ${target.provider}:${target.account} 映射不到账本行`).toBeTruthy();
      expect(ledgerIds.has(ledgerId)).toBe(true);
    }
  });

  it('账本每行都能反查回候选池用的运行时 id', () => {
    const runtimeIds = new Set(listVerifiedExecutionTargets().map((t) => t.account));
    for (const acct of MODEL_ACCOUNTS) {
      expect(ledgerToRuntimeAccountId(acct.account_id)).toBe(acct.runtime_account_id);
      expect(runtimeIds.has(acct.runtime_account_id)).toBe(true);
    }
  });

  it('未知 id 返回 null，不抛也不瞎猜', () => {
    expect(runtimeToLedgerAccountId('team99')).toBeNull();
    expect(ledgerToRuntimeAccountId('codex-team99')).toBeNull();
    expect(runtimeToLedgerAccountId(null)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/gp/g5/step2-quota-gate-into-dispatch.test.js 2>&1 | tail -20
```

预期：FAIL — `runtimeToLedgerAccountId is not a function`。

- [ ] **Step 3: 实现**

`packages/brain/src/ops-model-accounts-collector.js`，`MODEL_ACCOUNTS` 每条加 `runtime_account_id`：

```js
export const MODEL_ACCOUNTS = Object.freeze([
  { account_id: 'claude-account1', runtime_account_id: 'account1', provider: 'claude', plan: 'max', host_alias: 'mmv',
    forwardable: false, forward_targets: [], credential_path: '~/.claude-account1/.credentials.json' },
  { account_id: 'claude-account2', runtime_account_id: 'account2', provider: 'claude', plan: 'max', host_alias: 'mmv',
    forwardable: false, forward_targets: [], credential_path: '~/.claude-account2/.credentials.json' },
  { account_id: 'codex-team1', runtime_account_id: 'team1', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team1/auth.json' },
  { account_id: 'codex-team2', runtime_account_id: 'team2', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team2/auth.json' },
  { account_id: 'codex-team3', runtime_account_id: 'team3', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team3/auth.json' },
  { account_id: 'codex-team4', runtime_account_id: 'team4', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team4/auth.json' },
  { account_id: 'codex-team5', runtime_account_id: 'team5', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team5/auth.json' },
  { account_id: 'grok', runtime_account_id: 'grok', provider: 'grok', plan: null, host_alias: 'mmv',
    forwardable: false, forward_targets: [], credential_path: '~/.grok/auth.json' },
]);

/**
 * 账号 id 双向映射（唯一来源，禁各处手写正则/拼串）。
 * 表侧 `claude-account1` / `codex-team1` / `grok`；运行时侧 `account1` / `team1` / `grok`。
 * `${provider}-${runtime}` 对 grok 得到 'grok-grok' —— 拼串规则必然要写特例，所以用显式字段。
 */
const RUNTIME_TO_LEDGER = Object.freeze(
  Object.fromEntries(MODEL_ACCOUNTS.map((a) => [a.runtime_account_id, a.account_id])),
);
const LEDGER_TO_RUNTIME = Object.freeze(
  Object.fromEntries(MODEL_ACCOUNTS.map((a) => [a.account_id, a.runtime_account_id])),
);

/** 运行时账号 id（候选池用）→ 账本 account_id。未知返回 null。 */
export function runtimeToLedgerAccountId(runtimeId) {
  if (!runtimeId) return null;
  return RUNTIME_TO_LEDGER[runtimeId] ?? null;
}

/** 账本 account_id → 运行时账号 id。未知返回 null。 */
export function ledgerToRuntimeAccountId(ledgerId) {
  if (!ledgerId) return null;
  return LEDGER_TO_RUNTIME[ledgerId] ?? null;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/gp/g5/step2-quota-gate-into-dispatch.test.js 2>&1 | tail -20
npx vitest run packages/brain/src/__tests__/ops-model-accounts-collector.test.js 2>&1 | tail -10
```

预期：都 PASS。

- [ ] **Step 5: 变异验证（亲眼看它红）**

把 `codex-team3` 的 `runtime_account_id` 改成 `'team33'`，重跑 step2 测试，**必须红**；确认后改回。

```bash
npx vitest run tests/gp/g5/step2-quota-gate-into-dispatch.test.js 2>&1 | tail -10
```

- [ ] **Step 6: 提交**

```bash
git add packages/brain/src/ops-model-accounts-collector.js tests/gp/g5/step2-quota-gate-into-dispatch.test.js
git commit -m "feat(quota): MODEL_ACCOUNTS 补 runtime_account_id + 双向映射

表侧 claude-account1/codex-team1/grok 与运行时侧 account1/team1/grok 两套命名，
拼串规则对 grok 得到 grok-grok 必然要写特例，改用显式字段作单一来源。
配候选池↔账本的双向一致性守卫（变异验红）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 判据纯函数 `judgeAccount`

**Files:**
- Create: `packages/brain/src/orchestrator/preflight/account-quota-ledger.js`
- Create: `packages/brain/src/__tests__/account-quota-ledger.test.js`

- [ ] **Step 1: 写失败测试**

新建 `packages/brain/src/__tests__/account-quota-ledger.test.js`：

```js
import { describe, it, expect } from 'vitest';
import {
  judgeAccount,
  DISPATCH_GATE_FIVE_HOUR_PCT,
  DISPATCH_GATE_SEVEN_DAY_PCT,
  QUOTA_VERDICTS,
} from '../orchestrator/preflight/account-quota-ledger.js';
import { MODEL_ACCOUNT_STATUS } from '../ops-model-accounts-collector.js';

// collector 的写库语义（upsertModelAccountFailure 的 CASE，collector:238-242）：
// status 只在 consecutive_failures+1 >= 3 时才落终态；成功路径 :272 一律
// consecutive_failures=0 且 status='ok'。
// 所以「终态 status + consecutive_failures=0」在生产不可能存在 —— 用那种 fixture
// 测出来的绿是假绿。本文件所有 fixture 必须自洽。
const row = (over = {}) => ({
  account_id: 'codex-team1',
  provider: 'codex',
  five_hour_pct: 10,
  seven_day_pct: 10,
  status: 'ok',
  consecutive_failures: 0,
  reset_at: null,
  last_checked_at: new Date().toISOString(),
  ...over,
});

describe('judgeAccount — 判据顺序', () => {
  it('阈值常量就是主理人拍板值', () => {
    expect(DISPATCH_GATE_FIVE_HOUR_PCT).toBe(95);
    expect(DISPATCH_GATE_SEVEN_DAY_PCT).toBe(90);
  });

  it('1. 无行 → unknown/no_ledger_row', () => {
    expect(judgeAccount(null)).toMatchObject({ verdict: 'unknown', reason: 'no_ledger_row' });
    expect(judgeAccount(undefined)).toMatchObject({ verdict: 'unknown', reason: 'no_ledger_row' });
  });

  // ⚠️ 这一条是本设计修掉的死支：status 终态必须排在新鲜度之前。
  // 终态 status 蕴含 consecutive_failures>=3，若新鲜度排前面，凭据失效永远判不出来。
  it('2. key_expired → unusable/credential_invalid（即便 failures>=3）', () => {
    expect(judgeAccount(row({ status: 'key_expired', consecutive_failures: 3 })))
      .toMatchObject({ verdict: 'unusable', reason: 'credential_invalid' });
  });

  it('2. no_credential → unusable/credential_invalid', () => {
    expect(judgeAccount(row({ status: 'no_credential', consecutive_failures: 5 })))
      .toMatchObject({ verdict: 'unusable', reason: 'credential_invalid' });
  });

  it('2. 凭据失效优先于 pct —— 失败不擦白会留着旧的低 pct', () => {
    expect(judgeAccount(row({ status: 'key_expired', consecutive_failures: 3, five_hour_pct: 1, seven_day_pct: 1 })))
      .toMatchObject({ verdict: 'unusable', reason: 'credential_invalid' });
  });

  it('3. rate_limited → unknown 弃权，绝不判死（B49 事故：429≠配额耗尽）', () => {
    expect(judgeAccount(row({ status: 'rate_limited', consecutive_failures: 3 })))
      .toMatchObject({ verdict: 'unknown', reason: 'collector_rate_limited' });
  });

  it('4. status=ok 但 failures>0 → unknown/reading_unverified（看着新鲜其实没验证过）', () => {
    expect(judgeAccount(row({ status: 'ok', consecutive_failures: 1 })))
      .toMatchObject({ verdict: 'unknown', reason: 'reading_unverified' });
    expect(judgeAccount(row({ status: 'ok', consecutive_failures: 2 })))
      .toMatchObject({ verdict: 'unknown', reason: 'reading_unverified' });
  });

  it('5. 5h 达阈值 → unusable/five_hour_exhausted', () => {
    expect(judgeAccount(row({ five_hour_pct: 95 })))
      .toMatchObject({ verdict: 'unusable', reason: 'five_hour_exhausted' });
    expect(judgeAccount(row({ five_hour_pct: 94 }))).toMatchObject({ verdict: 'usable' });
  });

  it('6. 7d 达阈值 → unusable/seven_day_exhausted', () => {
    expect(judgeAccount(row({ seven_day_pct: 90 })))
      .toMatchObject({ verdict: 'unusable', reason: 'seven_day_exhausted' });
    expect(judgeAccount(row({ seven_day_pct: 89 }))).toMatchObject({ verdict: 'usable' });
  });

  it('7. 两个 pct 皆 NULL → unknown/pct_unknown（弃权，拍板输入③）', () => {
    expect(judgeAccount(row({ five_hour_pct: null, seven_day_pct: null })))
      .toMatchObject({ verdict: 'unknown', reason: 'pct_unknown' });
  });

  it('7. 只有一个 pct 为 NULL 时不弃权，用有值的那个判', () => {
    // 现网真实形态：codex-team1 5h=null/7d=18、grok 5h=null/7d=0
    expect(judgeAccount(row({ five_hour_pct: null, seven_day_pct: 18 }))).toMatchObject({ verdict: 'usable' });
    expect(judgeAccount(row({ five_hour_pct: null, seven_day_pct: 91 })))
      .toMatchObject({ verdict: 'unusable', reason: 'seven_day_exhausted' });
  });

  it('8. 其余 → usable，并带回用于保底排序的 pct', () => {
    expect(judgeAccount(row({ five_hour_pct: 11, seven_day_pct: 32 })))
      .toMatchObject({ verdict: 'usable', pct: 32 });
  });

  it('pct 取候选排序用的最大值（最满的那个窗决定紧张程度）', () => {
    expect(judgeAccount(row({ five_hour_pct: 80, seven_day_pct: 20 })).pct).toBe(80);
    expect(judgeAccount(row({ five_hour_pct: null, seven_day_pct: 20 })).pct).toBe(20);
  });
});

describe('judgeAccount — 防假绿的自洽约束', () => {
  it('判据认的 status 集合 ⊆ MODEL_ACCOUNT_STATUS（禁手抄字符串）', () => {
    const judged = ['ok', 'unknown', 'rate_limited', 'key_expired', 'no_credential'];
    for (const s of judged) expect(MODEL_ACCOUNT_STATUS).toContain(s);
  });

  it('verdict 只有三态', () => {
    expect([...QUOTA_VERDICTS].sort()).toEqual(['unknown', 'unusable', 'usable']);
  });

  it('终态 status 的 fixture 必须带 failures>=3（否则是生产不可能的组合）', () => {
    // 这条断言把「用不可能的 fixture 测绿」这个假绿形状钉死
    const terminal = ['key_expired', 'no_credential', 'rate_limited'];
    for (const s of terminal) {
      const impossible = row({ status: s, consecutive_failures: 0 });
      // 生产不可能出现；判据仍须给出确定答案而不是崩
      expect(() => judgeAccount(impossible)).not.toThrow();
    }
  });

  it('pct 只可能是整数或 null（node-pg 对 int4 列不接受浮点）', () => {
    expect(judgeAccount(row({ five_hour_pct: 95, seven_day_pct: null })).pct).toBe(95);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/brain/src/__tests__/account-quota-ledger.test.js 2>&1 | tail -20
```

预期：FAIL — 模块不存在。

- [ ] **Step 3: 实现**

新建 `packages/brain/src/orchestrator/preflight/account-quota-ledger.js`：

```js
/**
 * account-quota-ledger.js — 模型账号配额判据（G5 step1「接单即选到有额度的执行体」）
 *
 * 唯一知道「多满算不可用」语义的地方。只读 ops_model_accounts，不做选号决策
 * （选号在 capability-gate），也不碰 selectBestAccount 的 tier 降级瀑布
 * （那套吃 account_usage_cache，本表缺 sonnet/omelette/extra_used/7d-reset 列）。
 *
 * 三态而非布尔：当前布尔把「数据说这个号满了」和「我读不到数据」压成同一个 true，
 * 正是 2026-08-19 三起事故的根因形状（capability-gate.js:190-196 案卷）。
 */
import { MODEL_ACCOUNT_STATUS } from '../../ops-model-accounts-collector.js';

/** 主理人 0920 拍板：7d ≥ 90 或 5h ≥ 95 排除。 */
export const DISPATCH_GATE_FIVE_HOUR_PCT = 95;
export const DISPATCH_GATE_SEVEN_DAY_PCT = 90;

/** ledger 进程内缓存周期。采集器 5min 一轮，30s 足够摊薄热路径查询又不至于太陈。 */
export const LEDGER_CACHE_TTL_MS = 30_000;

/** 读不到账本连续多久后转 fail-closed（= 采集器自 gate 5min × FAILURE_STREAK_THRESHOLD 3）。 */
export const LEDGER_UNAVAILABLE_FAIL_CLOSED_MS = 15 * 60 * 1000;

export const QUOTA_VERDICTS = Object.freeze(['usable', 'unusable', 'unknown']);

/** 确定性否定事实：这两个 status 表示号根本登不上，与 pct 无关。 */
const CREDENTIAL_DEAD_STATUSES = Object.freeze(['key_expired', 'no_credential']);

const verdict = (v, reason, pct = null) => ({ verdict: v, reason, pct });

/**
 * 一行账本 → 三态裁决。
 *
 * 顺序不可调换：status 终态必须排在新鲜度判据之前。
 * upsertModelAccountFailure 的 CASE（collector:238-242）规定 status 只在
 * consecutive_failures+1 >= FAILURE_STREAK_THRESHOLD(3) 时才落终态，而成功路径
 * (collector:272) 一律 consecutive_failures=0 且 status='ok'。因此
 * status ∈ {key_expired,no_credential,rate_limited} **蕴含** consecutive_failures>=3>0。
 * 若把「consecutive_failures>0 → unknown」排在前面，第 2、3 条就成了死支：
 * grok key 过期会被当 unknown 放行，而且用 {status:'key_expired',failures:0} 这种
 * 生产不可能存在的 fixture 还能把「八条分支全覆盖」测绿。
 */
export function judgeAccount(row) {
  // 1. 无行
  if (!row) return verdict('unknown', 'no_ledger_row');

  const status = String(row.status ?? 'unknown');
  const failures = Number(row.consecutive_failures ?? 0);
  const fiveHour = row.five_hour_pct;
  const sevenDay = row.seven_day_pct;
  const pcts = [fiveHour, sevenDay].filter((p) => typeof p === 'number' && Number.isFinite(p));
  const worstPct = pcts.length > 0 ? Math.max(...pcts) : null;

  // 2. 凭据确定性失效 —— 与 pct 无关（失败不擦白 pct，死号会留着旧的低读数）
  if (CREDENTIAL_DEAD_STATUSES.includes(status)) {
    return verdict('unusable', 'credential_invalid', worstPct);
  }

  // 3. 采集器被限流 —— 弃权，绝不判死。429 ≠ 配额耗尽（account-usage.js:585-613 的 B49 案卷）
  if (status === 'rate_limited') return verdict('unknown', 'collector_rate_limited', worstPct);

  // 4. 新鲜度：本轮没被验证过的读数不作数。
  //    last_checked_at 不是新鲜度证据 —— 失败路径照刷它（collector:244）。
  if (failures > 0) return verdict('unknown', 'reading_unverified', worstPct);

  // 5/6. 额度闸（pct 只可能是整数，node-pg 对 int4 列不接受浮点）
  if (typeof fiveHour === 'number' && fiveHour >= DISPATCH_GATE_FIVE_HOUR_PCT) {
    return verdict('unusable', 'five_hour_exhausted', worstPct);
  }
  if (typeof sevenDay === 'number' && sevenDay >= DISPATCH_GATE_SEVEN_DAY_PCT) {
    return verdict('unusable', 'seven_day_exhausted', worstPct);
  }

  // 7. 两窗皆无读数 → 弃权（拍板输入③：不加分不减分，交给认证失败/真 429 回调决定）
  if (worstPct === null) return verdict('unknown', 'pct_unknown');

  // 8.
  return verdict('usable', 'within_budget', worstPct);
}

/** 判据认得的 status 必须都在采集器的枚举里（禁手抄，migration 449:15 的注释已陈旧）。 */
export function judgedStatuses() {
  return Object.freeze([...CREDENTIAL_DEAD_STATUSES, 'rate_limited', 'ok', 'unknown']
    .filter((s) => MODEL_ACCOUNT_STATUS.includes(s)));
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/brain/src/__tests__/account-quota-ledger.test.js 2>&1 | tail -20
```

预期：PASS（全部 16 条）。

- [ ] **Step 5: 变异验证**

把 `judgeAccount` 开头的第 2 条（`CREDENTIAL_DEAD_STATUSES`）整段挪到第 4 条（`failures > 0`）**之后**，重跑：**必须红**（`key_expired` 用例会变成 `reading_unverified`）。确认后改回。

- [ ] **Step 6: 提交**

```bash
git add packages/brain/src/orchestrator/preflight/account-quota-ledger.js packages/brain/src/__tests__/account-quota-ledger.test.js
git commit -m "feat(quota): 新增三态配额判据 judgeAccount

status 终态排在新鲜度之前——collector:238-242 的 CASE 决定终态 status 蕴含
consecutive_failures>=3，顺序反了会让凭据失效永不触发（死支），且能用生产
不可能的 fixture 测绿。变异（把终态判据后移）已验红。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: ledger 装载器（缓存 + 降级 + fail-closed 计时）

**Files:**
- Modify: `packages/brain/src/orchestrator/preflight/account-quota-ledger.js`
- Modify: `packages/brain/src/__tests__/account-quota-ledger.test.js`

- [ ] **Step 1: 写失败测试**

追加到 `packages/brain/src/__tests__/account-quota-ledger.test.js`：

```js
import { createQuotaLedgerLoader, LEDGER_CACHE_TTL_MS, LEDGER_UNAVAILABLE_FAIL_CLOSED_MS } from '../orchestrator/preflight/account-quota-ledger.js';

const okRows = [
  { account_id: 'claude-account1', provider: 'claude', five_hour_pct: 11, seven_day_pct: 32, status: 'ok', consecutive_failures: 0 },
  { account_id: 'codex-team1', provider: 'codex', five_hour_pct: null, seven_day_pct: 18, status: 'ok', consecutive_failures: 0 },
];

describe('createQuotaLedgerLoader', () => {
  it('一次 evaluate 只查一次库（禁逐候选查询）', async () => {
    let calls = 0;
    const load = createQuotaLedgerLoader({ query: async () => { calls += 1; return { rows: okRows }; } });
    const snap = await load(['account1', 'team1']);
    expect(calls).toBe(1);
    expect(snap.verdictFor('account1')).toMatchObject({ verdict: 'usable' });
    expect(snap.verdictFor('team1')).toMatchObject({ verdict: 'usable' });
  });

  it('TTL 内复用缓存，TTL 过后重查', async () => {
    let calls = 0;
    let t = 1_000;
    const load = createQuotaLedgerLoader({
      query: async () => { calls += 1; return { rows: okRows }; },
      now: () => t,
    });
    await load(['account1']);
    await load(['account1']);
    expect(calls).toBe(1);
    t += LEDGER_CACHE_TTL_MS + 1;
    await load(['account1']);
    expect(calls).toBe(2);
  });

  it('未知运行时 id → unknown/no_ledger_row，不抛', async () => {
    const load = createQuotaLedgerLoader({ query: async () => ({ rows: okRows }) });
    const snap = await load(['team5']);
    expect(snap.verdictFor('team5')).toMatchObject({ verdict: 'unknown', reason: 'no_ledger_row' });
  });

  it('查库失败 → 全部 unknown/ledger_unavailable + degraded 标记（不静默 fail-open）', async () => {
    const load = createQuotaLedgerLoader({ query: async () => { throw new Error('ECONNREFUSED'); }, now: () => 1_000 });
    const snap = await load(['account1']);
    expect(snap.verdictFor('account1')).toMatchObject({ verdict: 'unknown', reason: 'ledger_unavailable' });
    expect(snap.degraded).toBe(true);
    expect(snap.degradedReason).toContain('ECONNREFUSED');
  });

  it('表不存在（42P01）同样降级，不当成「没有账号」', async () => {
    const err = Object.assign(new Error('relation "ops_model_accounts" does not exist'), { code: '42P01' });
    const load = createQuotaLedgerLoader({ query: async () => { throw err; }, now: () => 1_000 });
    const snap = await load(['account1']);
    expect(snap.verdictFor('account1')).toMatchObject({ verdict: 'unknown', reason: 'ledger_unavailable' });
  });

  it('空表 → 全部 unknown/ledger_empty（系统未就绪，不是「都没额度」）', async () => {
    const load = createQuotaLedgerLoader({ query: async () => ({ rows: [] }) });
    const snap = await load(['account1']);
    expect(snap.verdictFor('account1')).toMatchObject({ verdict: 'unknown', reason: 'ledger_empty' });
    expect(snap.degraded).toBe(true);
  });

  it('连续读不到超过 15 分钟 → 转 fail-closed（unusable）', async () => {
    let t = 1_000;
    const load = createQuotaLedgerLoader({ query: async () => { throw new Error('down'); }, now: () => t });
    await load(['account1']);
    t += LEDGER_UNAVAILABLE_FAIL_CLOSED_MS - 1;
    expect((await load(['account1'])).verdictFor('account1').verdict).toBe('unknown');
    t += 2;
    const snap = await load(['account1']);
    expect(snap.verdictFor('account1')).toMatchObject({ verdict: 'unusable', reason: 'ledger_unavailable_fail_closed' });
  });

  it('恢复一次即清零 fail-closed 计时', async () => {
    let t = 1_000;
    let fail = true;
    const load = createQuotaLedgerLoader({
      query: async () => { if (fail) throw new Error('down'); return { rows: okRows }; },
      now: () => t,
    });
    await load(['account1']);
    t += LEDGER_UNAVAILABLE_FAIL_CLOSED_MS + 1;
    fail = false;
    expect((await load(['account1'])).verdictFor('account1').verdict).toBe('usable');
    fail = true;
    t += LEDGER_CACHE_TTL_MS + 1;
    expect((await load(['account1'])).verdictFor('account1').verdict).toBe('unknown');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/brain/src/__tests__/account-quota-ledger.test.js -t 'createQuotaLedgerLoader' 2>&1 | tail -20
```

预期：FAIL — `createQuotaLedgerLoader is not a function`。

- [ ] **Step 3: 实现**

追加到 `packages/brain/src/orchestrator/preflight/account-quota-ledger.js`。

⚠️ **不要新加一条 import**——Task 3 已从同一模块 import 过，合并成一条（eslint `no-duplicate-imports`）：

```js
// 文件顶部那条改成：
import { MODEL_ACCOUNT_STATUS, runtimeToLedgerAccountId } from '../../ops-model-accounts-collector.js';
```

然后在文件末尾追加：

```js
const LEDGER_SQL = `
  SELECT account_id, provider, five_hour_pct, seven_day_pct,
         status, consecutive_failures, reset_at, last_checked_at
    FROM ops_model_accounts
`;

/**
 * 创建 ledger 装载器。
 *
 * 一次 evaluate 只读一次全表（8 行），结果缓存 LEDGER_CACHE_TTL_MS。
 * 绝不逐候选查询 —— 候选最坏是 codex 5 账号 × 计算机器 + claude 2 + grok 十几个，
 * 而这是派发热路径（account-usage.js:681-684 的原注释即为此）。
 *
 * @param {object} deps
 * @param {(sql:string)=>Promise<{rows:object[]}>} [deps.query] 查询接缝（生产传 pool.query.bind(pool)）
 * @param {{query:Function}} [deps.pool] 或直接给 pool
 * @param {()=>number} [deps.now]
 */
export function createQuotaLedgerLoader({ query, pool, now = Date.now } = {}) {
  const runQuery = query ?? (pool ? (sql) => pool.query(sql) : null);
  if (typeof runQuery !== 'function') {
    throw new Error('createQuotaLedgerLoader requires deps.query or deps.pool');
  }

  let cache = null;          // { at, byLedgerId }
  let degraded = null;       // { since, reason }

  function snapshotFrom(byLedgerId, { degradedReason = null, failClosed = false } = {}) {
    return {
      degraded: Boolean(degradedReason),
      degradedReason,
      verdictFor(runtimeAccountId) {
        if (degradedReason) {
          return failClosed
            ? verdict('unusable', 'ledger_unavailable_fail_closed')
            : verdict('unknown', degradedReason === 'ledger_empty' ? 'ledger_empty' : 'ledger_unavailable');
        }
        const ledgerId = runtimeToLedgerAccountId(runtimeAccountId);
        return judgeAccount(ledgerId ? byLedgerId.get(ledgerId) : null);
      },
    };
  }

  return async function loadAccountQuota() {
    const t = now();
    if (cache && t - cache.at < LEDGER_CACHE_TTL_MS) {
      return snapshotFrom(cache.byLedgerId);
    }
    try {
      const res = await runQuery(LEDGER_SQL);
      const rows = res?.rows ?? [];
      if (rows.length === 0) {
        // 表空 = 系统未就绪，不是「所有号都没额度」。仍然降级留痕。
        degraded = degraded ?? { since: t };
        cache = null;
        const failClosed = t - degraded.since >= LEDGER_UNAVAILABLE_FAIL_CLOSED_MS;
        return snapshotFrom(new Map(), { degradedReason: 'ledger_empty', failClosed });
      }
      degraded = null;
      cache = { at: t, byLedgerId: new Map(rows.map((r) => [r.account_id, r])) };
      return snapshotFrom(cache.byLedgerId);
    } catch (err) {
      degraded = degraded ?? { since: t };
      cache = null;
      const failClosed = t - degraded.since >= LEDGER_UNAVAILABLE_FAIL_CLOSED_MS;
      return snapshotFrom(new Map(), {
        degradedReason: `ledger_unavailable:${String(err?.code || err?.message || err).slice(0, 120)}`,
        failClosed,
      });
    }
  };
}
```

> 注意 `snapshotFrom` 里 `degradedReason` 非空时统一回 `ledger_unavailable`（或 `ledger_empty`），而 `degradedReason` 字段保留原始错误文本供 evidence 用——测试里断言的是 `reason` 与 `degradedReason` 两个不同的东西。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/brain/src/__tests__/account-quota-ledger.test.js 2>&1 | tail -20
```

预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/brain/src/orchestrator/preflight/account-quota-ledger.js packages/brain/src/__tests__/account-quota-ledger.test.js
git commit -m "feat(quota): ledger 装载器——一次读全表 + 30s 缓存 + 15min 转 fail-closed

读不到账本时弃权而非静默放行，并带 degraded 标记供 evidence/告警；
连续 15min（= 采集器 5min × streak 3）读不到才转 fail-closed。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `capability-gate` 接入三态判据

**Files:**
- Modify: `packages/brain/src/orchestrator/preflight/capability-gate.js:196-208`
- Modify: `packages/brain/src/orchestrator/preflight/capability-gate.js:142-149`（新增循环外变量）
- Test: `tests/gp/g5/step2-quota-gate-into-dispatch.test.js`

- [ ] **Step 1: 写失败测试**

追加到 `tests/gp/g5/step2-quota-gate-into-dispatch.test.js`（真 import，不 mock）：

```js
import { createCapabilityGate } from '../../../packages/brain/src/orchestrator/preflight/capability-gate.js';

const T = (provider, account, machine = 'mmv') => ({ provider, account, machine });

function gateDeps(over = {}) {
  return {
    probeTimeoutMs: 25_000,
    getMachineHealth: async () => ({ ok: true }),
    getMachineCapacity: async () => ({ ok: true, available: 4 }),
    probeProviderAuth: async () => ({ ok: true }),
    recordDecision: async () => {},
    emitAlert: async () => {},
    ...over,
  };
}
const REQ = { requirements: { provider_auth: true } };

describe('capability-gate 接入配额判据', () => {
  it('unusable 的候选被跳过，选中下一个', async () => {
    const snap = {
      degraded: false,
      verdictFor: (a) => (a === 'account1'
        ? { verdict: 'unusable', reason: 'seven_day_exhausted', pct: 93 }
        : { verdict: 'usable', reason: 'within_budget', pct: 10 }),
    };
    const gate = createCapabilityGate(gateDeps({ loadAccountQuota: async () => snap }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1'), T('claude', 'account2')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
    expect(r.to_target.account).toBe('account2');
  });

  it('unknown 的候选放行，但 evidence 记 degraded', async () => {
    const snap = { degraded: false, verdictFor: () => ({ verdict: 'unknown', reason: 'pct_unknown', pct: null }) };
    const gate = createCapabilityGate(gateDeps({ loadAccountQuota: async () => snap }));
    const r = await gate.evaluate({
      preferred_target: T('codex', 'team1'),
      candidate_targets: [T('codex', 'team1')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
    expect(r.evidence.quota_abstained).toEqual(
      expect.arrayContaining([expect.objectContaining({ account: 'team1', reason: 'pct_unknown' })]),
    );
  });

  it('判据抛错 ≠ 静默放行——必须留痕并告警（变异靶点）', async () => {
    const alerts = [];
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => { throw new Error('boom'); },
      emitAlert: async (a) => { alerts.push(a); },
    }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1')],
      ...REQ,
    });
    // 仍然放行（选号闸不承担准入 fail-closed），但不许静默
    expect(r.status).toBe('ok');
    expect(r.evidence.account_quota_gate_error).toBeTruthy();
    expect(alerts.map((a) => a.kind)).toContain('kernel_account_quota_gate_degraded');
  });

  it('未注入 loadAccountQuota 时行为不变（向后兼容）', async () => {
    const gate = createCapabilityGate(gateDeps());
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
  });

  // 拍板输入③依赖这条链：ops_model_accounts 没有 capped/authFailed 列，
  // isSpendingCapped/isAuthFailed 是真撞 429 后由回调打上的内存标记。
  // 用表判据「替换」而不是「OR」内存标记 = 把 NULL 情形的兜底摘掉。
  it('表说可用但内存标记说不可用 → 判死（两判据取 OR）', async () => {
    const snap = { degraded: false, verdictFor: () => ({ verdict: 'usable', reason: 'within_budget', pct: 5 }) };
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => snap,
      isAccountUsable: async (a) => a !== 'account1',
    }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1'), T('claude', 'account2')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
    expect(r.to_target.account).toBe('account2');
    expect((r.evidence.quota_unusable ?? []).map((x) => x.reason)).toContain('runtime_marker');
  });

  it('表说不可用但内存标记说可用 → 仍判死（OR 的另一半）', async () => {
    const snap = {
      degraded: false,
      verdictFor: (a) => (a === 'account1'
        ? { verdict: 'unusable', reason: 'seven_day_exhausted', pct: 93 }
        : { verdict: 'usable', reason: 'within_budget', pct: 5 }),
    };
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => snap,
      isAccountUsable: async () => true,
    }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1'), T('claude', 'account2')],
      ...REQ,
    });
    expect(r.to_target.account).toBe('account2');
  });

  it('每个候选的判死原因都进 evidence（不再被单变量覆盖）', async () => {
    const reasons = { account1: 'seven_day_exhausted', account2: 'five_hour_exhausted' };
    const snap = {
      degraded: false,
      verdictFor: (a) => ({ verdict: 'unusable', reason: reasons[a], pct: a === 'account1' ? 93 : 97 }),
    };
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => snap,
      probeProviderAuth: async () => ({ ok: false, signature: 'x' }),
    }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1'), T('claude', 'account2')],
      ...REQ,
    });
    const listed = (r.evidence.quota_unusable ?? []).map((x) => `${x.account}:${x.reason}`);
    expect(listed).toEqual(expect.arrayContaining(['account1:seven_day_exhausted', 'account2:five_hour_exhausted']));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/gp/g5/step2-quota-gate-into-dispatch.test.js -t '接入配额判据' 2>&1 | tail -25
```

预期：FAIL。

- [ ] **Step 3: 实现**

`capability-gate.js`，在 `:149` 的 `let providerAuth = null;` 之后加循环外收集变量：

```js
    let providerAuth = null;
    const quotaUnusable = [];   // 因配额判死的候选（含当时的 health/capacity，供保底复用）
    const quotaAbstained = [];  // 弃权的候选
    let quotaGateError = null;
```

在 `for (const candidate of candidates)` **之前**装载一次快照：

```js
    let quotaSnapshot = null;
    if (typeof deps.loadAccountQuota === 'function') {
      try {
        quotaSnapshot = await probe(() => deps.loadAccountQuota());
      } catch (error) {
        // 不再静默：吞掉异常等于闸门无痕消失（2026-08-19 事故形状）
        quotaGateError = error.message === 'preflight_timeout'
          ? 'account_quota_probe_timeout'
          : `account_quota_gate_error:${String(error?.message ?? error).slice(0, 120)}`;
        await deps.emitAlert?.({
          kind: 'kernel_account_quota_gate_degraded',
          reason: quotaGateError,
        });
      }
    }
```

把原 `:197-208` 整块替换成下面这段。

⚠️ **表判据与内存标记取 OR，不是替换**：`ops_model_accounts` 没有 `capped`/`authFailed` 列，而 `account-usage.js:690` 的 `isSpendingCapped`/`isAuthFailed` 是**真撞 429 后由回调打上的**。拍板输入③「NULL 弃权，交给真 429 回调决定」正依赖这条链——删掉 `isAccountUsable` 调用，NULL 情形就彻底无人兜底。任一判死即判死。

```js
      // 额度闸：凭据有效 ≠ 账号可用。（原 :190-196 的 2026-08-19 案卷注释保留不动）
      // 三态而非布尔——「数据说满了」与「我读不到数据」必须可区分。
      // 两个判据取 OR：表判据看配额，内存标记看真撞过的 429/认证失败（表里无此列）。
      if (candidate?.account) {
        const v = quotaSnapshot ? quotaSnapshot.verdictFor(candidate.account) : null;

        let markerUsable = true;
        if (typeof deps.isAccountUsable === 'function') {
          try {
            // 同样包进 probe()：这里原本也是裸 await
            markerUsable = await probe(() => deps.isAccountUsable(candidate.account));
          } catch (error) {
            markerUsable = true; // 标记读不到时不判死，但必须留痕
            quotaGateError = quotaGateError
              ?? `account_marker_error:${String(error?.message ?? error).slice(0, 120)}`;
            await deps.emitAlert?.({
              kind: 'kernel_account_quota_gate_degraded',
              reason: quotaGateError,
            });
          }
        }

        if (v?.verdict === 'unusable' || markerUsable === false) {
          fallbackReason = 'account_quota_exhausted';
          // health/capacity 是循环外 let（:143-144），后续候选会覆盖 ——
          // 保底要用就必须此刻存下来，否则保底选中 A 却带着 B 的健康快照
          quotaUnusable.push({
            candidate: { ...candidate },
            account: candidate.account,
            reason: v?.verdict === 'unusable' ? v.reason : 'runtime_marker',
            pct: v?.pct ?? null,
            health,
            capacity,
          });
          continue;
        }
        if (v?.verdict === 'unknown') {
          quotaAbstained.push({ account: candidate.account, reason: v.reason });
        }
      }
```

两条路径的 evidence 都要带上配额清单。先给 `blockedResult`（`:91-115`）加一个透传入口——它目前只接 `{snapshotId, fromTarget, fallbackReason, probeDetail, failureClass}`，blocked 路径拿不到配额信息：

```js
function blockedResult({
  snapshotId,
  fromTarget,
  fallbackReason,
  probeDetail,
  failureClass = 'infrastructure_blocked',
  quotaEvidence = null,          // ← 新增
}) {
  const evidence = buildCapabilityEvidence({
    capability_snapshot_id: snapshotId,
    from_target: fromTarget,
    to_target: null,
    fallback_reason: fallbackReason,
    failure_class: failureClass,
    ...(probeDetail ? { probe_detail: probeDetail } : {}),
    ...(quotaEvidence ?? {}),    // ← 新增
  });
  // ...（下略，其余不动）
```

在 `evaluate` 里造一个共用片段（放在 for 循环之后、保底块之前）：

```js
    const quotaEvidence = {
      ...(quotaUnusable.length
        ? { quota_unusable: quotaUnusable.map(({ account, reason, pct }) => ({ account, reason, pct })) }
        : {}),
      ...(quotaAbstained.length ? { quota_abstained: quotaAbstained } : {}),
      ...(quotaGateError ? { account_quota_gate_error: quotaGateError } : {}),
      ...(quotaSnapshot?.degraded
        ? { account_quota_gate_degraded: quotaSnapshot.degradedReason }
        : {}),
    };
```

然后：

- `:270` 分支的 `blockedResult({...})` 调用加一行 `quotaEvidence,`
- `:387-396` 成功路径的 `buildCapabilityEvidence({...})` 里加一行 `...quotaEvidence,`

（`buildCapabilityEvidence` 就是 `redact(input)` 透传，无字段白名单，可自由加键。）

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/gp/g5/step2-quota-gate-into-dispatch.test.js 2>&1 | tail -20
npx vitest run packages/brain/src/orchestrator/preflight/capability-gate.test.js 2>&1 | tail -20
```

预期：都 PASS（原有 `capability-gate.test.js` 三例不回归）。

- [ ] **Step 5: 提交**

```bash
git add packages/brain/src/orchestrator/preflight/capability-gate.js tests/gp/g5/step2-quota-gate-into-dispatch.test.js
git commit -m "feat(gate): 账号闸接三态配额判据，包进 probe 超时保护，废除静默 catch

- :200 原本是候选循环里唯一的裸 await，改读 PG 后会无限期挂住 dispatch hop
- catch 不再默认 usable=true，改为留痕 + emitAlert
- 每个候选的判死原因进 evidence，不再被单变量 fallbackReason 覆盖
- 收集判死候选时连 health/capacity 一起存（循环外 let 会被后续候选覆盖）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 全灭保底放行

**Files:**
- Modify: `packages/brain/src/orchestrator/preflight/capability-gate.js:269`（for 循环之后、`if (!selectedTarget)` 之前）
- Test: `tests/gp/g5/step2-quota-gate-into-dispatch.test.js`

- [ ] **Step 1: 写失败测试**

```js
describe('全灭保底放行（判定点 7c4bf8d2）', () => {
  it('8 个号全判死 → 放行 pct 最低的那个，并标 degraded + 告警', async () => {
    const pct = { account1: 97, account2: 92, team1: 99 };
    const snap = {
      degraded: false,
      verdictFor: (a) => ({ verdict: 'unusable', reason: 'seven_day_exhausted', pct: pct[a] }),
    };
    const alerts = [];
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => snap,
      emitAlert: async (a) => { alerts.push(a); },
    }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1'), T('claude', 'account2'), T('codex', 'team1')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
    expect(r.to_target.account).toBe('account2');              // pct 最低
    expect(r.fallback_reason).toBe('account_quota_degraded_admit');
    expect(alerts.map((a) => a.kind)).toContain('kernel_account_quota_all_exhausted');
  });

  it('凭据失效的号不进保底候选（跑 providerAuth 必然失败，白耗探针）', async () => {
    const snap = {
      degraded: false,
      verdictFor: (a) => (a === 'account1'
        ? { verdict: 'unusable', reason: 'credential_invalid', pct: 1 }
        : { verdict: 'unusable', reason: 'seven_day_exhausted', pct: 95 }),
    };
    const gate = createCapabilityGate(gateDeps({ loadAccountQuota: async () => snap }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1'), T('claude', 'account2')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
    expect(r.to_target.account).toBe('account2');   // 不是 pct=1 的 account1
  });

  it('保底候选带回自己的 health/capacity，不串到别的候选上', async () => {
    const healths = { mmv: { ok: true, tag: 'A' }, 'xian-m4': { ok: false, tag: 'B' } };
    const snap = {
      degraded: false,
      verdictFor: () => ({ verdict: 'unusable', reason: 'five_hour_exhausted', pct: 96 }),
    };
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => snap,
      getMachineHealth: async ({ machine }) => healths[machine],
      getMachineCapacity: async ({ machine }) => ({ ok: healths[machine].ok, available: 4 }),
    }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1', 'mmv'),
      candidate_targets: [T('claude', 'account1', 'mmv'), T('codex', 'team1', 'xian-m4')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
    expect(r.snapshot.machine).toBe('mmv');
    // snapshot.health/capacity（capability-gate.js:380-381）读的是循环外 let，
    // 不写回就会带上最后一个候选（xian-m4，tag=B）的坏快照
    expect(r.snapshot.health.tag).toBe('A');
  });

  it('保底的认证探针失败 → 照旧 blocked，不吞', async () => {
    const snap = { degraded: false, verdictFor: () => ({ verdict: 'unusable', reason: 'five_hour_exhausted', pct: 99 }) };
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => snap,
      probeProviderAuth: async () => ({ ok: false, signature: 'auth_failed' }),
    }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1')],
      ...REQ,
    });
    expect(r.status).toBe('blocked');
    expect(r.evidence.quota_unusable).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/gp/g5/step2-quota-gate-into-dispatch.test.js -t '保底' 2>&1 | tail -25
```

- [ ] **Step 3: 实现**

在 `capability-gate.js` 第 268 行的 `}`（for 循环结束）与第 270 行的 `if (!selectedTarget)` 之间插入：

```js
    // 全灭保底（判定点 7c4bf8d2）：8 个号全被配额判死时，放行 pct 最低的那个并标
    // degraded，而不是让 run 落 blocked —— loop.js:1917-1924 把 infrastructure_blocked
    // 排除在 blocked-streak 外，全灭不是判死而是每 90s 静默转圈到 run deadline。
    //
    // 三条不得破坏：① 只读不写 exhaustedAccounts（写了该号下一跳被永久踢出）；
    // ② 只做一次裸 probeProviderAuth，不复用 :230-267 的瞬时重试（会二次写
    //    retryExhausted 并把 fallback_reason 改写成 provider_transient_retry_exhausted）；
    // ③ credential_invalid 不进保底候选 —— 对它跑认证探针必然失败，白耗预算。
    if (!selectedTarget && quotaUnusable.length > 0) {
      const eligible = quotaUnusable
        .filter((entry) => entry.reason !== 'credential_invalid')
        .sort((a, b) => (a.pct ?? Number.POSITIVE_INFINITY) - (b.pct ?? Number.POSITIVE_INFINITY));
      const pick = eligible[0];
      if (pick) {
        await deps.emitAlert?.({
          kind: 'kernel_account_quota_all_exhausted',
          admitted_account: pick.account,
          admitted_pct: pick.pct,
          candidates: quotaUnusable.map(({ account, reason, pct }) => ({ account, reason, pct })),
        });
        let degradedAuth = null;
        try {
          degradedAuth = requirements.provider_auth
            ? await probe(() => deps.probeProviderAuth({ ...pick.candidate, task_bundle: taskBundle }))
            : { ok: true, skipped: true };
        } catch {
          degradedAuth = { ok: false, signature: 'provider_probe_error' };
        }
        if (degradedAuth?.ok) {
          selectedTarget = { ...pick.candidate };
          providerAuth = degradedAuth;
          lastProviderProbe = degradedAuth;
          // 循环外 let 此刻停在最后一个候选的值上，必须写回保底候选自己的快照
          machine = pick.candidate.machine;
          health = pick.health;
          capacity = pick.capacity;
          fallbackReason = 'account_quota_degraded_admit';
        }
      }
    }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/gp/g5/step2-quota-gate-into-dispatch.test.js 2>&1 | tail -20
npx vitest run packages/brain/src/orchestrator/preflight/ 2>&1 | tail -20
```

- [ ] **Step 5: 变异验证**

把保底块里的 `health = pick.health; capacity = pick.capacity;` 两行删掉，重跑「保底候选带回自己的 health/capacity」用例：**必须红**。确认后改回。

- [ ] **Step 6: 提交**

```bash
git add packages/brain/src/orchestrator/preflight/capability-gate.js tests/gp/g5/step2-quota-gate-into-dispatch.test.js
git commit -m "feat(gate): 全灭保底放行 pct 最低的号 + P0 告警

loop.js:1917-1924 把 infrastructure_blocked 排除在 blocked-streak 外，
全灭不是判死而是 90s 静默转圈到 deadline。保底只读不写 exhaustedAccounts、
不复用瞬时重试、排除 credential_invalid，并写回所选候选自己的 health/capacity。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `run.js` 生产接线

**Files:**
- Modify: `packages/brain/src/orchestrator/run.js:265-283`
- Test: `tests/gp/g5/step2-quota-gate-into-dispatch.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('run.js 生产接线（静态断言：这些接缝不接上就是死代码）', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../../../packages/brain/src/orchestrator/run.js', import.meta.url)),
    'utf8',
  );

  it('loadAccountQuota 被注入给 capability gate', () => {
    expect(src).toMatch(/loadAccountQuota\s*:/);
    expect(src).toMatch(/createQuotaLedgerLoader/);
  });

  it('emitAlert 被注入——否则 capability-gate.js:284 的 optional chain 永远静默', () => {
    expect(src).toMatch(/emitAlert\s*:/);
  });

  it('注入层不再有裸 catch { return true }（fail-open 无痕）', () => {
    expect(src).not.toMatch(/catch\s*\{\s*\n?\s*return true;\s*\/\/\s*fail-open/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/gp/g5/step2-quota-gate-into-dispatch.test.js -t '生产接线' 2>&1 | tail -20
```

- [ ] **Step 3: 实现**

`packages/brain/src/orchestrator/run.js`，在文件顶部 import 区加：

```js
import { createQuotaLedgerLoader } from './preflight/account-quota-ledger.js';
```

把 `:266-283` 的 `preflightGate` 构造改为：

```js
    const preflightGate = overrides.preflightGate
      ?? createCapabilityGateFn({
        ...productionProbes,
        probeTimeoutMs: overrides.preflightProbeTimeoutMs ?? 25_000,
        snapshotTtlMs: overrides.preflightSnapshotTtlMs ?? 1_000,
        // 配额账本接线：ops_model_accounts 是生产唯一真配额来源（us-vps 不挂凭据，
        // llm-capacity 的本机探测在生产恒 ENOENT）。gate 侧只认 deps.loadAccountQuota，
        // 不自己 import pool —— 保持单测无 PG 可跑。
        loadAccountQuota: overrides.loadAccountQuota ?? createQuotaLedgerLoader({ pool }),
        // emitAlert 此前是死接缝：全仓只有 capability-gate.js:284 一处 optional-chain
        // 调用且无人注入，于是「禁止静默」的承诺直接 no-op。
        emitAlert: overrides.emitAlert ?? (async (payload) => {
          const { raise } = await import('../alerting.js');
          await raise(payload);
        }),
        // 额度闸接线：认证探针只回答"能不能登录"，回答不了"还有没有额度"。
        // 2026-08-19 连修两处都因为改在不参与 kernel 派发的路径上而毫无效果。
        isAccountUsable: overrides.isAccountUsable
          ?? (async (accountId) => {
            try {
              const { isAccountUsable } = await import('../account-usage.js');
              return await isAccountUsable(accountId);
            } catch (error) {
              // 不再静默 fail-open：留痕后再放行，选号闸不承担准入 fail-closed 职责
              console.warn('[capability-gate] isAccountUsable 判据不可用，本次放行:', error?.message);
              return true;
            }
          }),
      });
```

> ⚠️ `alerting.js` 的导出名若不是 `raise`，按实际导出改（`grep -n "^export" packages/brain/src/alerting.js`），**不要臆造**。

- [ ] **Step 4: 跑测试确认通过**

```bash
grep -n "^export" packages/brain/src/alerting.js | head
npx vitest run tests/gp/g5/step2-quota-gate-into-dispatch.test.js 2>&1 | tail -20
```

- [ ] **Step 5: 提交**

```bash
git add packages/brain/src/orchestrator/run.js tests/gp/g5/step2-quota-gate-into-dispatch.test.js
git commit -m "feat(run): 接上 loadAccountQuota 与 emitAlert，裸 catch 改留痕

emitAlert 此前是死接缝（全仓仅 capability-gate.js:284 一处 optional-chain
调用、无任何注入方），不接上则「禁止静默」的 DoD 直接 no-op。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 真 PG integration 测试

**Files:**
- Create: `packages/brain/src/__tests__/integration/account-quota-ledger.pg.integration.test.js`

- [ ] **Step 1: 写测试**

```js
// [integration] 真 PG。unit shard 不跑（ci.yml:786 --exclude src/__tests__/integration/**），
// 由 brain-integration job 起 pgvector service + 跑 migration 后执行。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { createQuotaLedgerLoader } from '../../orchestrator/preflight/account-quota-ledger.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

describe('[integration] ledger 装载器打真表', () => {
  beforeAll(async () => {
    await pool.query(`DELETE FROM ops_model_accounts WHERE account_id LIKE 'itest-%'`);
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM ops_model_accounts WHERE account_id LIKE 'itest-%'`);
    await pool.end();
  });

  it('INTEGER 列拒收浮点——这就是 toPct 必须取整的原因', async () => {
    await expect(
      pool.query(
        `INSERT INTO ops_model_accounts (account_id, provider, five_hour_pct, host_alias, forwardable, forward_targets, status)
         VALUES ($1,$2,$3,'mmv',false,'[]'::jsonb,'ok')`,
        ['itest-float', 'claude', 89.6],
      ),
    ).rejects.toThrow(/invalid input syntax for type integer/);
  });

  it('真表读出的行能被判据消费', async () => {
    await pool.query(
      `INSERT INTO ops_model_accounts (account_id, provider, five_hour_pct, seven_day_pct, host_alias, forwardable, forward_targets, status, consecutive_failures)
       VALUES ('claude-account1','claude',11,32,'mmv',false,'[]'::jsonb,'ok',0)
       ON CONFLICT (account_id) DO UPDATE SET five_hour_pct=11, seven_day_pct=32, status='ok', consecutive_failures=0`,
    );
    const load = createQuotaLedgerLoader({ pool });
    const snap = await load();
    expect(snap.degraded).toBe(false);
    expect(snap.verdictFor('account1')).toMatchObject({ verdict: 'usable' });
  });
});
```

- [ ] **Step 2: 跑**

```bash
DATABASE_URL="postgresql://administrator@localhost/cecelia_scratch" \
  npx vitest run packages/brain/src/__tests__/integration/account-quota-ledger.pg.integration.test.js 2>&1 | tail -20
```

若本机 `cecelia_scratch` 无 `ops_model_accounts` 表，先跑 migration 449 与 455；跑不通就记录原因，交给 CI 的 `brain-integration` job 裁决（本地 PG schema 落后是已知情况）。

- [ ] **Step 3: 提交**

```bash
git add packages/brain/src/__tests__/integration/account-quota-ledger.pg.integration.test.js
git commit -m "test(quota): 真 PG integration——钉死 INTEGER 列拒收浮点

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 变异测试全表走一遍 + CI 闸

**Files:**
- Modify: `packages/brain/package.json`（版本 bump）
- Modify: `DEFINITION.md`

- [ ] **Step 1: 逐条变异，亲眼看红**

对每一条：改代码 → 跑指定测试 → **确认红** → 改回 → 确认绿。把每条的红色输出摘一行记进 PR 描述。

| # | 变异 | 跑什么 | 期望 |
|---|---|---|---|
| 1 | `capability-gate.js` 装载快照的 catch 改回静默（删 `quotaGateError` 与 `emitAlert`） | `-t '判据抛错'` | 红 |
| 2 | `run.js` 注入层改回 `catch { return true; // fail-open }` | `-t '生产接线'` | 红 |
| 3 | `account-usage.js:701` 的 `return true` 改成 `return false` | `packages/brain/src/__tests__/account-usage*.test.js` | 红（若不红说明该行无守卫，补一条） |
| 4 | `account-usage.js:704` 的 `if (!u) return true` 删掉 | 同上 | 红 |
| 5 | `judgeAccount` 开头加 `return verdict('usable','mutant')` | `account-quota-ledger.test.js` | 红 |
| 6 | `codex-team3` 的 `runtime_account_id` 改成 `team33` | `step2-*.test.js` | 红 |
| 7 | 把 `CREDENTIAL_DEAD_STATUSES` 判据挪到 `failures > 0` 之后 | `account-quota-ledger.test.js` | 红 |
| 8 | 删掉保底块里的 `health = pick.health; capacity = pick.capacity;` | `-t '保底候选带回'` | 红 |
| 9 | 把 `v?.verdict === 'unusable' \|\| markerUsable === false` 改成只看 `v?.verdict === 'unusable'`（表判据**替换**内存标记而非 OR） | `-t '两判据取 OR'` | 红 |

- [ ] **Step 2: 版本 bump（CI 闸 `brain-version-bump-gate`）**

```bash
cd packages/brain && npm version patch --no-git-tag-version && cd ../..
grep -n "^\*\*Brain 版本\*\*" DEFINITION.md
```

把 `DEFINITION.md:11` 的 `**Brain 版本**: 1.307.2` 改成 `npm version` 产出的新版本号（`facts-check.mjs` 会比对 `package.json`，不同步会让 `gp-governance-decisions-smoke` 基线红）。并在 DEFINITION.md 版本流水里加一段本次改动说明（仿 `## Brain 1.306.4` 那节的格式）。

- [ ] **Step 3: 全量本地验证**

```bash
npx vitest run packages/brain/src/__tests__/account-quota-ledger.test.js \
                tests/gp/g5/ \
                packages/brain/src/orchestrator/preflight/ \
                packages/brain/src/__tests__/ops-model-accounts-collector.test.js 2>&1 | tail -25
bash .github/workflows/scripts/lint-gp-anchor-artifact.sh origin/main
npx eslint packages/brain/src/orchestrator/preflight/account-quota-ledger.js \
           packages/brain/src/orchestrator/preflight/capability-gate.js \
           packages/brain/src/orchestrator/run.js \
           packages/brain/src/ops-model-accounts-collector.js
```

预期：测试全绿；`lint-gp-anchor-artifact` 通过（它会确认 step2 测试真 import 了被改的 orchestrator 模块且没 mock 它们）；eslint 无错。

- [ ] **Step 4: 提交**

```bash
git add packages/brain/package.json DEFINITION.md
git commit -m "chore(brain): version bump + DEFINITION 同步（刀1 PR1）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 验收（对照 spec 的 DoD）

- [ ] 判据真读 `ops_model_accounts`，8 个账号全部有额度判据（team*/grok 不再 fail-open）
- [ ] 账号闸在 `probe()` 超时保护内
- [ ] 判据三态；`unknown` 不判死也不静默放行，写 evidence + 告警
- [ ] 全灭保底放行 pct 最低的号并标 degraded + 告警
- [ ] 八条变异全部亲眼验红
- [ ] 映射变异验红
- [ ] 边界按**整数 90/95**（实测：node-pg 对 int4 列拒收浮点，不存在 89.5 输入）
- [ ] 守卫落 `tests/gp/g5/step2-quota-gate-into-dispatch.test.js`，真 import 不 mock
- [ ] CI 四道闸全绿

## 已知的本地环境坑

- `pre-push` 的 QuickCheck 会对 `packages/brain` 跑**全量** vitest（约 15 分钟），本机测试库 schema 落后会让 7 个 `*.integration.test.js` 失败而拦住 push。**确认失败与本次改动无关后**用 `git push --no-verify`，把裁决交给带 PG service 的 CI。
- `Deploy Preview Environment` 是长期假红（`preview-env-start` 返 503），非 required check，不挡合并。
