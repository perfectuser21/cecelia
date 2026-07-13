# T4 回执 Collector 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三入口（notifier / feishu-alert / deploy webhook）对外动作写 action_receipts(pending) 并按结果核销，tick job 超时标 timeout，作战日报加"未确认动作"段。

**Architecture:** 新建 `packages/brain/src/receipt-collector.js`（只 import db.js，全路径 fail-open）承载写入 helper + 核销 tick + 未确认查询；三入口经动态 import（notifier/feishu-alert，照 dedupe 先例保测试隔离）或静态 import（ops.js，其测试已 mock db.js）接线；tick job 注册进 scheduler-jobs.js（in-memory 10min 自 gate 照 capture-triage 三件套）；battle-report 加第⑥段。

**Tech Stack:** Node.js ESM + pg + vitest（mock pool，不连真库）。

**Spec:** docs/superpowers/specs/2026-07-10-t4-receipt-collector-design.md

**铁律：**
- TDD：每个 Task 先 commit failing test（commit-1），再 commit 实现（commit-2）。NO PRODUCTION CODE WITHOUT FAILING TEST FIRST。
- receipt-collector.js 严禁 import notifier.js / alerting.js（防循环 import）。
- 所有写回执路径 fail-open：DB 错误只 console.warn，绝不打断通知/部署主流程。

---

### Task 1: receipt-collector.js 核心模块

**Files:**
- Create: `packages/brain/src/receipt-collector.js`
- Test: `packages/brain/src/__tests__/receipt-collector.test.js`

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/receipt-collector.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock 模块级 pool（record/resolve 用；tick/查询走参数注入的 pool）
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import pool from '../db.js';
import {
  recordActionReceipt,
  resolveActionReceipt,
  runReceiptCollector,
  getUnconfirmedReceipts,
  __resetReceiptCollectorForTest,
} from '../receipt-collector.js';

function makePool(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) };
}

describe('recordActionReceipt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('INSERT pending 并返回 id', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 'r-1' }] });
    const id = await recordActionReceipt({ kind: 'feishu', target: 'webhook' });
    expect(id).toBe('r-1');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO action_receipts/);
    expect(sql).toMatch(/'pending'/);
    expect(params[1]).toBe('feishu');
    expect(params[2]).toBe('webhook');
  });

  it('kind 缺失 → 返回 null 且不查库', async () => {
    const id = await recordActionReceipt({ target: 'webhook' });
    expect(id).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('DB 错误 fail-open → 返回 null 不抛', async () => {
    pool.query.mockRejectedValue(new Error('db down'));
    await expect(recordActionReceipt({ kind: 'bark' })).resolves.toBeNull();
  });
});

describe('resolveActionReceipt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('UPDATE 到 confirmed（仅 pending 行）', async () => {
    pool.query.mockResolvedValue({ rowCount: 1 });
    const ok = await resolveActionReceipt('r-1', 'confirmed', { http_status: 200 });
    expect(ok).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE action_receipts/);
    expect(sql).toMatch(/receipt_status = 'pending'/);
    expect(params).toEqual(['r-1', 'confirmed', JSON.stringify({ http_status: 200 })]);
  });

  it('id 为 null 或状态非法 → false 且不查库', async () => {
    expect(await resolveActionReceipt(null, 'confirmed')).toBe(false);
    expect(await resolveActionReceipt('r-1', 'timeout')).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('DB 错误 fail-open → false 不抛', async () => {
    pool.query.mockRejectedValue(new Error('db down'));
    await expect(resolveActionReceipt('r-1', 'failed')).resolves.toBe(false);
  });
});

describe('runReceiptCollector（tick 自 gate + 超时核销）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetReceiptCollectorForTest();
  });

  it('超 30min 的 pending 标 timeout', async () => {
    const p = makePool([{ id: 'r-1', kind: 'deploy' }]);
    const result = await runReceiptCollector(p);
    expect(result).toEqual({ timedOut: 1 });
    const [sql, params] = p.query.mock.calls[0];
    expect(sql).toMatch(/SET receipt_status = 'timeout'/);
    expect(sql).toMatch(/receipt_status = 'pending'/);
    expect(params).toEqual([30]);
  });

  it('间隔内第二次调用 → skipped 不查库', async () => {
    const p = makePool([]);
    await runReceiptCollector(p);
    const result = await runReceiptCollector(p);
    expect(result).toEqual({ skipped: true, timedOut: 0 });
    expect(p.query).toHaveBeenCalledTimes(1);
  });
});

describe('getUnconfirmedReceipts', () => {
  it('查 24h 内 pending/timeout/failed，LIMIT 50', async () => {
    const rows = [{ kind: 'feishu', target: 'webhook', receipt_status: 'timeout', sent_at: new Date() }];
    const p = makePool(rows);
    const result = await getUnconfirmedReceipts(p);
    expect(result).toEqual(rows);
    const [sql] = p.query.mock.calls[0];
    expect(sql).toMatch(/IN \('pending', 'timeout', 'failed'\)/);
    expect(sql).toMatch(/24 hours/);
    expect(sql).toMatch(/LIMIT 50/);
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/receipt-collector.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: commit-1 failing test**

```bash
git add packages/brain/src/__tests__/receipt-collector.test.js
git commit -m "test(brain/T4): receipt-collector 核心模块 failing tests"
```

- [ ] **Step 4: 写实现**

创建 `packages/brain/src/receipt-collector.js`：

```js
/**
 * receipt-collector.js — 对外动作回执台账（九要素 T4）
 *
 * 三入口（notifier sendFeishu/sendBark、feishu-alert sendToFeishu、ops.js deploy webhook）
 * 真正发起对外调用时写 action_receipts(pending)，按真实结果核销 confirmed/failed；
 * 无人核销的 pending 由 runReceiptCollector（scheduler-jobs 60s 轮询 + 本模块 10min 自 gate）
 * 超 30min 标 timeout。未确认段由 getUnconfirmedReceipts 喂 battle-report 第⑥段。
 * 表结构见 migrations/315_action_receipts_and_decision_review.sql。
 *
 * ⚠️ 只 import ./db.js，严禁 import notifier.js / alerting.js（alerting→notifier 潜在环）。
 * record/resolve 全路径 fail-open：DB 错误只 console.warn，never breaks main flow。
 */
import pool from './db.js';

const VALID_RESOLVE_STATUS = new Set(['confirmed', 'failed']);
/** pending 超过该分钟数未核销 → timeout（feishu/bark 秒级、deploy 最长 ~15min，30min 全覆盖） */
const TIMEOUT_MINUTES = 30;
const INTERVAL_MS = parseInt(
  process.env.CECELIA_RECEIPT_COLLECTOR_INTERVAL_MS || String(10 * 60 * 1000),
  10
);

let lastRunAt = 0;
export function __resetReceiptCollectorForTest() {
  lastRunAt = 0;
}

/**
 * 写一条 pending 回执（对外动作发起时调用）。
 * @param {{kind: string, target?: string|null, actionId?: string|null, evidence?: object}} args
 * @returns {Promise<string|null>} receipt id；kind 缺失或 DB 错误返回 null
 */
export async function recordActionReceipt({ kind, target = null, actionId = null, evidence = {} } = {}) {
  if (!kind) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO action_receipts (action_id, kind, target, receipt_status, evidence)
       VALUES ($1, $2, $3, 'pending', $4)
       RETURNING id`,
      [actionId, kind, target, JSON.stringify(evidence || {})]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[receipt-collector] record 失败（fail-open）: ${err.message}`);
    return null;
  }
}

/**
 * 按真实结果核销回执（仅 pending 行可核销，幂等）。
 * @param {string|null} id - recordActionReceipt 返回值（null 直接跳过）
 * @param {'confirmed'|'failed'} status
 * @param {object} [evidence] - 合并进 evidence JSONB
 * @returns {Promise<boolean>}
 */
export async function resolveActionReceipt(id, status, evidence = {}) {
  if (!id || !VALID_RESOLVE_STATUS.has(status)) return false;
  try {
    const { rowCount } = await pool.query(
      `UPDATE action_receipts
       SET receipt_status = $2, evidence = evidence || $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND receipt_status = 'pending'`,
      [id, status, JSON.stringify(evidence || {})]
    );
    return rowCount > 0;
  } catch (err) {
    console.warn(`[receipt-collector] resolve 失败（fail-open）: ${err.message}`);
    return false;
  }
}

/**
 * 核销 tick（scheduler-jobs handler）：pending 超 30min → timeout。
 * 自 gate：10min 间隔（照 capture-triage 先例，env CECELIA_RECEIPT_COLLECTOR_INTERVAL_MS 可覆盖）。
 * @param {import('pg').Pool} dbPool
 * @returns {Promise<{skipped?: true, timedOut: number}>}
 */
export async function runReceiptCollector(dbPool) {
  const now = Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true, timedOut: 0 };
  lastRunAt = now;

  const { rows } = await dbPool.query(
    `UPDATE action_receipts
     SET receipt_status = 'timeout', updated_at = NOW()
     WHERE receipt_status = 'pending'
       AND sent_at < NOW() - make_interval(mins => $1)
     RETURNING id, kind`,
    [TIMEOUT_MINUTES]
  );
  if (rows.length > 0) {
    console.warn(
      `[receipt-collector] ${rows.length} 条回执超时未核销 → timeout: ${rows.map((r) => r.kind).join(',')}`
    );
  }
  return { timedOut: rows.length };
}

/**
 * 24h 内未确认动作（pending/timeout/failed），供 battle-report 第⑥段。
 * @param {import('pg').Pool} dbPool
 * @returns {Promise<Array<{kind: string, target: string|null, receipt_status: string, sent_at: Date}>>}
 */
export async function getUnconfirmedReceipts(dbPool) {
  const { rows } = await dbPool.query(
    `SELECT kind, target, receipt_status, sent_at
     FROM action_receipts
     WHERE receipt_status IN ('pending', 'timeout', 'failed')
       AND sent_at >= NOW() - interval '24 hours'
     ORDER BY sent_at DESC
     LIMIT 50`
  );
  return rows;
}
```

- [ ] **Step 5: 跑测试确认 PASS**

Run: `cd packages/brain && npx vitest run src/__tests__/receipt-collector.test.js`
Expected: PASS 全绿

- [ ] **Step 6: commit-2 实现**

```bash
git add packages/brain/src/receipt-collector.js
git commit -m "feat(brain/T4): receipt-collector 核心模块——record/resolve/超时核销tick/未确认查询"
```

---

### Task 2: notifier.js 三渠道接线

**Files:**
- Modify: `packages/brain/src/notifier.js`（sendFeishu webhook 渠道 / sendFeishuOpenAPI / sendBark）
- Test: `packages/brain/src/__tests__/notifier-receipt.test.js`（新建）

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/notifier-receipt.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const recordActionReceipt = vi.fn().mockResolvedValue('r-1');
const resolveActionReceipt = vi.fn().mockResolvedValue(true);
vi.mock('../receipt-collector.js', () => ({ recordActionReceipt, resolveActionReceipt }));
vi.mock('../muted-guard.js', () => ({ isMuted: vi.fn().mockReturnValue(false) }));

import { isMuted } from '../muted-guard.js';

async function loadNotifier(env = {}) {
  vi.resetModules();
  const orig = {};
  for (const [k, v] of Object.entries(env)) {
    orig[k] = process.env[k];
    process.env[k] = v;
  }
  const mod = await import('../notifier.js');
  return { mod, restore: () => {
    for (const [k, v] of Object.entries(orig)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  } };
}

describe('notifier 回执接线（T4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMuted.mockReturnValue(false);
  });

  it('sendFeishu webhook 成功 → record(feishu/webhook) + resolve confirmed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const { mod, restore } = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://feishu.example/hook' });
    const ok = await mod.sendFeishu('hello');
    restore();
    expect(ok).toBe(true);
    expect(recordActionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'feishu', target: 'webhook' })
    );
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-1', 'confirmed', expect.objectContaining({ http_status: 200 }));
  });

  it('sendFeishu webhook 非 2xx → resolve failed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const { mod, restore } = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://feishu.example/hook' });
    const ok = await mod.sendFeishu('hello');
    restore();
    expect(ok).toBe(false);
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-1', 'failed', expect.objectContaining({ http_status: 500 }));
  });

  it('sendFeishu webhook fetch 抛错 → resolve failed（error 证据）', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom'));
    const { mod, restore } = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://feishu.example/hook' });
    const ok = await mod.sendFeishu('hello');
    restore();
    expect(ok).toBe(false);
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-1', 'failed', expect.objectContaining({ error: 'boom' }));
  });

  it('muted → 不写回执', async () => {
    isMuted.mockReturnValue(true);
    const { mod, restore } = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://feishu.example/hook' });
    await mod.sendFeishu('hello');
    restore();
    expect(recordActionReceipt).not.toHaveBeenCalled();
  });

  it('sendBark 成功 → record(bark) + resolve confirmed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ code: 200 }) });
    const { mod, restore } = await loadNotifier({ BARK_TOKEN: 'tok' });
    const ok = await mod.sendBark('t', 'b');
    restore();
    expect(ok).toBe(true);
    expect(recordActionReceipt).toHaveBeenCalledWith(expect.objectContaining({ kind: 'bark' }));
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-1', 'confirmed', expect.anything());
  });

  it('sendBark code≠200 → resolve failed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ code: 400, message: 'bad' }) });
    const { mod, restore } = await loadNotifier({ BARK_TOKEN: 'tok' });
    const ok = await mod.sendBark('t', 'b');
    restore();
    expect(ok).toBe(false);
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-1', 'failed', expect.anything());
  });

  it('BARK_TOKEN 未配置 → 不写回执', async () => {
    const { mod, restore } = await loadNotifier({});
    delete process.env.BARK_TOKEN;
    vi.resetModules();
    const mod2 = await import('../notifier.js');
    await mod2.sendBark('t', 'b');
    restore();
    expect(recordActionReceipt).not.toHaveBeenCalled();
  });

  it('receipt-collector import 抛错 → 通知照发（fail-open）', async () => {
    recordActionReceipt.mockRejectedValueOnce(new Error('db down'));
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const { mod, restore } = await loadNotifier({ FEISHU_BOT_WEBHOOK: 'https://feishu.example/hook' });
    const ok = await mod.sendFeishu('hello');
    restore();
    expect(ok).toBe(true);
  });
});
```

注意：`vi.mock('../receipt-collector.js', ...)` 对动态 `await import()` 同样生效（vitest mock registry 按模块路径拦截）。

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/notifier-receipt.test.js`
Expected: FAIL（recordActionReceipt 未被调用）

- [ ] **Step 3: commit-1 failing test**

```bash
git add packages/brain/src/__tests__/notifier-receipt.test.js
git commit -m "test(brain/T4): notifier 三渠道回执接线 failing tests"
```

- [ ] **Step 4: 改 notifier.js**

在 `_pruneExpired` 函数之后加两个模块级 helper（动态 import 照 dedupe 先例，notifier.js:114 同款）：

```js
// ── 回执台账（九要素 T4）────────────────────────────────────────────────
// 动态 import 照 dedupe 先例：notifier 保持 DB-free import 图，测试无需 mock db。
// 全路径 fail-open：回执写不进去绝不打断通知主流程。
async function recordReceipt(kind, target, evidence = {}) {
  try {
    const { recordActionReceipt } = await import('./receipt-collector.js');
    return await recordActionReceipt({ kind, target, evidence });
  } catch (err) {
    console.warn('[notifier] 回执写入失败（fail-open）:', err.message);
    return null;
  }
}

async function resolveReceipt(id, status, evidence = {}) {
  if (!id) return;
  try {
    const { resolveActionReceipt } = await import('./receipt-collector.js');
    await resolveActionReceipt(id, status, evidence);
  } catch (err) {
    console.warn('[notifier] 回执核销失败（fail-open）:', err.message);
  }
}
```

**sendFeishuOpenAPI**（凭据检查通过后、发 token 请求前 record；三个失败出口 + 成功出口各自 resolve）：

```js
  try {
    const receiptId = await recordReceipt('feishu', 'open_api');
    // 1. 获取 tenant_access_token
    const authResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      // …原样保留…
    });
    const auth = await authResp.json();
    if (auth.code !== 0) {
      console.error('[notifier] 获取飞书 token 失败:', auth.msg);
      await resolveReceipt(receiptId, 'failed', { stage: 'token', msg: auth.msg });
      return false;
    }

    // 2. 发私信（原样保留）
    const sendResult = await sendResp.json();
    if (sendResult.code !== 0) {
      console.error('[notifier] 飞书私信发送失败:', sendResult.msg);
      await resolveReceipt(receiptId, 'failed', { stage: 'send', msg: sendResult.msg });
      return false;
    }
    console.log('[notifier] 飞书私信发送成功（Open API）');
    await resolveReceipt(receiptId, 'confirmed', { code: 0 });
    return true;
  } catch (err) {
    console.error('[notifier] Open API 发送异常:', err.message);
    return false;
  }
```

注意 catch 块拿不到 receiptId（在 try 内声明）——把 `let receiptId = null;` 提到 try 外、try 内赋值，catch 里 `await resolveReceipt(receiptId, 'failed', { error: err.message });`。

**sendFeishu webhook 渠道**（渠道 1 分支内）：

```js
  // 渠道 1：Webhook（群机器人）
  if (FEISHU_WEBHOOK_URL) {
    const receiptId = await recordReceipt('feishu', 'webhook');
    try {
      const resp = await fetch(FEISHU_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } }),
        signal: AbortSignal.timeout(8000)
      });
      if (!resp.ok) {
        console.error(`[notifier] Feishu webhook returned ${resp.status}`);
        await resolveReceipt(receiptId, 'failed', { http_status: resp.status });
        return false;
      }
      await resolveReceipt(receiptId, 'confirmed', { http_status: resp.status });
      return true;
    } catch (err) {
      console.error('[notifier] Webhook 发送失败:', err.message);
      await resolveReceipt(receiptId, 'failed', { error: err.message });
      return false;
    }
  }
```

**sendBark**（dedupe 检查后、fetch 前 record）：

```js
  let receiptId = null;
  try {
    receiptId = await recordReceipt('bark', 'bark');
    const url = `https://api.day.app/${BARK_TOKEN}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const result = await resp.json();
    if (result.code !== 200) {
      console.error('[notifier] Bark 推送失败:', result.message);
      await resolveReceipt(receiptId, 'failed', { code: result.code, message: result.message });
      return false;
    }
    await resolveReceipt(receiptId, 'confirmed', { code: result.code });
    return true;
  } catch (err) {
    console.error('[notifier] Bark 推送异常:', err.message);
    await resolveReceipt(receiptId, 'failed', { error: err.message });
    return false;
  }
```

- [ ] **Step 5: 跑新测试 + notifier 全家测试确认 PASS**

Run: `cd packages/brain && npx vitest run src/__tests__/notifier-receipt.test.js src/__tests__/notifier.test.js src/__tests__/notifier-dedupe.test.js src/__tests__/notifier-memleak.test.js`
Expected: 全 PASS（现有测试零改动——动态 import + fail-open 保证不 mock receipt-collector 的旧测试在 call 期 catch 掉连接错误）

⚠️ 若现有 notifier 测试因真连 localhost:5432 变慢/挂：给对应测试文件补一行 `vi.mock('../receipt-collector.js', () => ({ recordActionReceipt: vi.fn().mockResolvedValue(null), resolveActionReceipt: vi.fn().mockResolvedValue(false) }));`，这是预期内的最小改动。

- [ ] **Step 6: commit-2 实现**

```bash
git add packages/brain/src/notifier.js packages/brain/src/__tests__/
git commit -m "feat(brain/T4): notifier 三渠道（feishu webhook/open_api + bark）接回执台账"
```

---

### Task 3: feishu-alert.js 接线

**Files:**
- Modify: `packages/brain/src/feishu-alert.js`（sendToFeishu）
- Test: `packages/brain/src/__tests__/feishu-alert-receipt.test.js`（新建）

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/feishu-alert-receipt.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const recordActionReceipt = vi.fn().mockResolvedValue('r-9');
const resolveActionReceipt = vi.fn().mockResolvedValue(true);
vi.mock('../receipt-collector.js', () => ({ recordActionReceipt, resolveActionReceipt }));

describe('feishu-alert 回执接线（T4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function loadAndEscalate(webhookUrl) {
    if (webhookUrl === undefined) delete process.env.FEISHU_SKILL_EVAL_WEBHOOK;
    else process.env.FEISHU_SKILL_EVAL_WEBHOOK = webhookUrl;
    const { alertSkillEvalFailure } = await import('../feishu-alert.js');
    // 连报 3 次同 mode 触发 escalate → 立即走 sendToFeishu
    alertSkillEvalFailure('crash', 't-1');
    alertSkillEvalFailure('crash', 't-2');
    alertSkillEvalFailure('crash', 't-3');
    // escalate 的 send 是 fire-and-forget，等微任务清空
    await new Promise((r) => setTimeout(r, 20));
  }

  it('webhook 已配置 + 发送成功 → record(feishu/skill_eval_webhook) + confirmed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await loadAndEscalate('https://feishu.example/skill-eval');
    expect(recordActionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'feishu', target: 'skill_eval_webhook' })
    );
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-9', 'confirmed', expect.anything());
  });

  it('webhook 返回非 2xx → resolve failed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    await loadAndEscalate('https://feishu.example/skill-eval');
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-9', 'failed', expect.objectContaining({ http_status: 502 }));
  });

  it('webhook 未配置（本地日志兜底）→ 不写回执', async () => {
    await loadAndEscalate(undefined);
    expect(recordActionReceipt).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-alert-receipt.test.js`
Expected: FAIL

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/feishu-alert-receipt.test.js
git commit -m "test(brain/T4): feishu-alert 回执接线 failing tests"
```

- [ ] **Step 4: 改 sendToFeishu**

```js
async function sendToFeishu(payload) {
  if (!FEISHU_WEBHOOK_URL) {
    // 未配置 webhook → 只写本地日志（兜底）；没有对外动作，不写回执
    console.warn('[feishu-alert] FEISHU_SKILL_EVAL_WEBHOOK not set, logging locally:', JSON.stringify(payload));
    return;
  }

  // 回执台账（九要素 T4）：动态 import + fail-open，照 notifier 先例
  let receiptId = null;
  try {
    const { recordActionReceipt } = await import('./receipt-collector.js');
    receiptId = await recordActionReceipt({ kind: 'feishu', target: 'skill_eval_webhook' });
  } catch (err) {
    console.warn('[feishu-alert] 回执写入失败（fail-open）:', err.message);
  }
  const resolveReceipt = async (status, evidence) => {
    if (!receiptId) return;
    try {
      const { resolveActionReceipt } = await import('./receipt-collector.js');
      await resolveActionReceipt(receiptId, status, evidence);
    } catch (err) {
      console.warn('[feishu-alert] 回执核销失败（fail-open）:', err.message);
    }
  };

  try {
    const resp = await fetch(FEISHU_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      console.error(`[feishu-alert] webhook responded ${resp.status}`);
      await resolveReceipt('failed', { http_status: resp.status });
      return;
    }
    await resolveReceipt('confirmed', { http_status: resp.status });
  } catch (err) {
    // 飞书 webhook 挂 → 本地日志兜底
    console.error('[feishu-alert] send failed (falling back to local log):', err.message);
    console.log('[feishu-alert] payload:', JSON.stringify(payload));
    await resolveReceipt('failed', { error: err.message });
  }
}
```

- [ ] **Step 5: 跑测试确认 PASS（含现有 feishu-alert 测试）**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-alert-receipt.test.js && npx vitest run src/__tests__ -t feishu-alert 2>/dev/null || npx vitest run src/__tests__/feishu-alert.test.js 2>/dev/null || true`
Expected: 新测试 PASS；如存在旧 feishu-alert 测试也须 PASS（不 mock receipt-collector 的旧测试靠 fail-open 落地）

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/feishu-alert.js
git commit -m "feat(brain/T4): feishu-alert skill_eval webhook 接回执台账"
```

---

### Task 4: ops.js deploy webhook 接线

**Files:**
- Modify: `packages/brain/src/routes/ops.js`（POST /deploy production + staging 两分支）
- Test: `packages/brain/src/__tests__/deploy-receipt.test.js`（新建，照 deploy-webhook-log.test.js 的 mock 全家桶）

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/deploy-receipt.test.js`（vi.mock 全家桶从 `deploy-webhook-log.test.js` 顶部原样复制——db/actions/llm-caller/orchestrator-chat/tick/task-weight/task-cleanup/dispatch-stats/thalamus/decision-executor/suggestion-triage/decomposition-checker/pr-callback-handler/shared/child_process，那是 ops.js 的 import 面）：

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

let capturedSpawnArgs = null;
let spawnCloseHandler = null;

const recordActionReceipt = vi.fn().mockResolvedValue('r-dep');
const resolveActionReceipt = vi.fn().mockResolvedValue(true);
vi.mock('../receipt-collector.js', () => ({ recordActionReceipt, resolveActionReceipt }));

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// …（其余 vi.mock 全家桶与 deploy-webhook-log.test.js 完全一致，此处执行者原样复制）…
vi.mock('child_process', () => ({
  spawn: (...args) => {
    capturedSpawnArgs = args;
    return {
      unref: vi.fn(),
      on: (event, handler) => { if (event === 'close') spawnCloseHandler = handler; },
    };
  },
  execSync: vi.fn().mockReturnValue(Buffer.from('ok')),
}));

describe('deploy webhook 回执接线（T4）', () => {
  let app;
  beforeEach(async () => {
    vi.clearAllMocks();
    spawnCloseHandler = null;
    process.env.DEPLOY_TOKEN = 'tok';
    vi.resetModules();
    const { default: opsRouter } = await import('../routes/ops.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', opsRouter);
  });
  afterEach(() => { delete process.env.DEPLOY_TOKEN; });

  it('production deploy → 写 pending(kind=deploy/target=production)，close(0) 核销 confirmed', async () => {
    const res = await request(app)
      .post('/api/brain/deploy')
      .set('Authorization', 'Bearer tok')
      .send({ changed_paths: ['packages/brain/src/x.js'] });
    expect(res.status).toBe(202);
    // spawn 是 202 响应后的异步流程，等 event loop 清空
    await new Promise((r) => setTimeout(r, 50));
    expect(recordActionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'deploy', target: 'production' })
    );
    expect(spawnCloseHandler).toBeTypeOf('function');
    spawnCloseHandler(0, null);
    await new Promise((r) => setTimeout(r, 20));
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-dep', 'confirmed', expect.objectContaining({ exit_code: 0 }));
  });

  it('production deploy close(1) → 核销 failed', async () => {
    await request(app).post('/api/brain/deploy').set('Authorization', 'Bearer tok').send({});
    await new Promise((r) => setTimeout(r, 50));
    spawnCloseHandler(1, null);
    await new Promise((r) => setTimeout(r, 20));
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-dep', 'failed', expect.objectContaining({ exit_code: 1 }));
  });

  it('鉴权失败 → 不写回执', async () => {
    const res = await request(app).post('/api/brain/deploy').set('Authorization', 'Bearer wrong').send({});
    expect(res.status).toBe(401);
    await new Promise((r) => setTimeout(r, 20));
    expect(recordActionReceipt).not.toHaveBeenCalled();
  });

  it('staging deploy 成功 → record(deploy/staging) + confirmed', async () => {
    await request(app).post('/api/brain/deploy').set('Authorization', 'Bearer tok').send({ mode: 'staging' });
    await new Promise((r) => setTimeout(r, 50));
    expect(recordActionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'deploy', target: 'staging' })
    );
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-dep', 'confirmed', expect.anything());
  });
});
```

注意：production 分支两个用例会踩 deployState 互斥（`running`）——第二个用例前需让第一个用例的 close handler 跑完把状态归位，或每用例 `vi.resetModules()` 重新 import ops.js（beforeEach 已做，deployState 是模块级变量会重置；但 `/tmp/cecelia-deploy-status.json` 文件恢复逻辑可能读到上个用例的 running 状态——测试里把 `DEPLOY_STATUS_FILE` 所在文件先删掉：`import { unlinkSync } from 'fs'; try { unlinkSync('/tmp/cecelia-deploy-status.json'); } catch {}` 放 beforeEach）。

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/deploy-receipt.test.js`
Expected: FAIL（recordActionReceipt 未被调用）

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/deploy-receipt.test.js
git commit -m "test(brain/T4): deploy webhook 回执接线 failing tests"
```

- [ ] **Step 4: 改 ops.js**

顶部 import 区加：

```js
import { recordActionReceipt, resolveActionReceipt } from '../receipt-collector.js';
```

（ops.js 静态 import db.js 且所有 deploy 测试已 mock db.js，无测试隔离问题。）

**staging 分支**：在 `console.log(\`[staging-deploy] 开始 staging 部署: ${cmd}\`)` 之前加：

```js
      const receiptId = await recordActionReceipt({
        kind: 'deploy',
        target: 'staging',
        evidence: { changed_paths: changed_paths || [] },
      });
```

成功路径（`stagingDeployState.status = 'success'` 之后）与 skip 路径（`skippedStatus` 赋值之后）各加：

```js
        await resolveActionReceipt(receiptId, 'confirmed', {
          elapsed_ms: elapsed,
          ...(stagingDeployState.skip_reason ? { skip_reason: stagingDeployState.skip_reason } : {}),
        });
```

catch 路径（`stagingDeployState.error = err.message` 之后）加：

```js
      await resolveActionReceipt(receiptId, 'failed', { elapsed_ms: elapsed, error: err.message });
```

注意 receiptId 声明位置须在 try 外（`let receiptId = null;` 放 `const startTime = Date.now();` 旁），否则 catch 拿不到。

**production 分支**：在 `console.log(\`[deploy-webhook] 开始部署（detached）...\`)` 之前（logFile 已计算完）加：

```js
  const receiptId = await recordActionReceipt({
    kind: 'deploy',
    target: 'production',
    evidence: { changed_paths: changed_paths || [], log_path: logFile },
  });
```

`child.on('close', ...)` 回调里，code === 0 分支末尾（writeDeployStatusFile 前）加：

```js
      resolveActionReceipt(receiptId, 'confirmed', { exit_code: code, elapsed_ms: elapsed })
        .catch((e) => console.warn('[deploy-webhook] 回执核销失败:', e.message));
```

else 分支末尾加：

```js
      resolveActionReceipt(receiptId, 'failed', { exit_code: code, signal, elapsed_ms: elapsed })
        .catch((e) => console.warn('[deploy-webhook] 回执核销失败:', e.message));
```

（close 回调是同步函数，用 .catch 而非 await；Brain 在 close 前重启 → 无人核销 → collector 30min 后标 timeout，这正是 timeout 态的语义。）

- [ ] **Step 5: 跑新测试 + 全部 deploy 测试确认 PASS**

Run: `cd packages/brain && npx vitest run src/__tests__/deploy-receipt.test.js src/__tests__/deploy-webhook-log.test.js src/__tests__/deploy-concurrency.test.js src/__tests__/deploy-status.test.js`
Expected: 全 PASS（旧 deploy 测试的 mocked pool.query 返回 undefined → receipt fail-open 不影响断言；若个别测试断言 query 精确调用次数需微调，属预期内改动）

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/routes/ops.js packages/brain/src/__tests__/
git commit -m "feat(brain/T4): deploy webhook production/staging 接回执台账"
```

---

### Task 5: scheduler-jobs 注册核销 tick

**Files:**
- Modify: `packages/brain/src/scheduler-jobs.js`
- Modify: `packages/brain/src/__tests__/scheduler-jobs.test.js`

- [ ] **Step 1: 改测试（failing）**

`scheduler-jobs.test.js` 顶部 mock 区加：

```js
vi.mock('../receipt-collector.js', () => ({
  runReceiptCollector: vi.fn().mockResolvedValue({ skipped: true, timedOut: 0 }),
}));
```

import 区加：

```js
import { runReceiptCollector } from '../receipt-collector.js';
```

「JOBS 注册了 10 个 job」改为：

```js
  it('JOBS 注册了 11 个 job', () => {
    expect(JOBS.map((j) => j.name)).toEqual([
      'arch-review', 'ci-patrol', 'strategy-trigger', 'conversation-digest', 'capture-digestion', 'daily-backup', 'line-dreaming', 'ledger-hygiene', 'battle-report', 'capture-triage', 'receipt-collector',
    ]);
  });
```

「runSchedulerJobsOnce 调用全部 job」测试里加：

```js
    expect(runReceiptCollector).toHaveBeenCalledWith(pool);
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js`
Expected: FAIL（10≠11）

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/scheduler-jobs.test.js
git commit -m "test(brain/T4): scheduler-jobs 注册 receipt-collector failing test"
```

- [ ] **Step 4: 改 scheduler-jobs.js**

import 区加：

```js
import { runReceiptCollector } from './receipt-collector.js';
```

JOBS 数组末尾加：

```js
  { name: 'receipt-collector', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runReceiptCollector, description: '回执核销（自带10min间隔gate，pending超30min标timeout，T4）' },
```

- [ ] **Step 5: 跑测试确认 PASS**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js`
Expected: PASS

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/scheduler-jobs.js
git commit -m "feat(brain/T4): scheduler-jobs 注册 receipt-collector 核销tick（10→11 jobs）"
```

---

### Task 6: battle-report 第⑥段「未确认动作（24h）」

**Files:**
- Modify: `packages/brain/src/battle-report.js`
- Modify: `packages/brain/src/__tests__/battle-report.test.js`

- [ ] **Step 1: 写 failing test**

`battle-report.test.js` 顶部 mock 区加（与 `vi.mock('../notifier.js')` 并排）：

```js
vi.mock('../receipt-collector.js', () => ({
  getUnconfirmedReceipts: vi.fn().mockResolvedValue([]),
}));
```

import 区加：

```js
import { getUnconfirmedReceipts } from '../receipt-collector.js';
```

新增 describe（照军师决策段测试的写法）：

```js
describe('未确认动作段（T4）', () => {
  it('buildBattleReportData 调 getUnconfirmedReceipts 并透传结果', async () => {
    const receipts = [
      { kind: 'deploy', target: 'production', receipt_status: 'timeout', sent_at: new Date('2026-07-10T12:00:00Z') },
    ];
    getUnconfirmedReceipts.mockResolvedValueOnce(receipts);
    const pool = makePool();
    const data = await buildBattleReportData(pool);
    expect(getUnconfirmedReceipts).toHaveBeenCalledWith(pool);
    expect(data.unconfirmedActions).toEqual(receipts);
  });

  it('查询抛错 → 降级空数组不炸', async () => {
    getUnconfirmedReceipts.mockRejectedValueOnce(new Error('boom'));
    const pool = makePool();
    const data = await buildBattleReportData(pool);
    expect(data.unconfirmedActions).toEqual([]);
  });

  it('渲染：有未确认动作 → 列出 kind/target/status', () => {
    const md = renderBattleReportMarkdown({
      mergedPrs: [], journeyRuns: [], userDecisions: [], strategistDecisions: [],
      sentinel: { jobs: [], expected: null, healthy: false },
      unconfirmedActions: [
        { kind: 'feishu', target: 'webhook', receipt_status: 'timeout', sent_at: new Date('2026-07-10T12:00:00Z') },
      ],
    });
    expect(md).toContain('## 未确认动作（24h）');
    expect(md).toMatch(/feishu → webhook：timeout/);
  });

  it('渲染：无未确认动作 → 暂无；字段缺省（旧数据形状）不炸', () => {
    const base = {
      mergedPrs: [], journeyRuns: [], userDecisions: [], strategistDecisions: [],
      sentinel: { jobs: [], expected: null, healthy: false },
    };
    const md = renderBattleReportMarkdown({ ...base, unconfirmedActions: [] });
    expect(md).toContain('## 未确认动作（24h）');
    expect(() => renderBattleReportMarkdown(base)).not.toThrow();
  });
});
```

（`makePool`/`buildBattleReportData`/`renderBattleReportMarkdown` 沿用该测试文件已有的 helper 与 import。）

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/battle-report.test.js`
Expected: 新 describe FAIL，旧用例仍 PASS

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/battle-report.test.js
git commit -m "test(brain/T4): battle-report 未确认动作段 failing tests"
```

- [ ] **Step 4: 改 battle-report.js**

import 区加：

```js
import { getUnconfirmedReceipts } from './receipt-collector.js';
```

文件头注释①-⑤列表后加一行 `*   ⑥ 未确认动作（action_receipts 24h 内 pending/timeout/failed，T4 回执台账）`，并把「五段」字样改「六段」（文件头 + buildBattleReportData JSDoc + renderBattleReportMarkdown JSDoc 共 3 处）。

`buildBattleReportData` 的 ⑤ 军师决策块之后、return 之前加：

```js
  // ⑥ 未确认动作（action_receipts，T4；照军师决策段 try/catch 降级——查询失败不拖垮整份日报）
  let unconfirmedActions = [];
  try {
    unconfirmedActions = await getUnconfirmedReceipts(pool);
  } catch (err) {
    console.warn(`[battle-report] 未确认动作查询失败（降级空）: ${err.message}`);
  }
```

return 改为：

```js
  return { mergedPrs, journeyRuns, userDecisions, strategistDecisions, sentinel: { jobs, expected, healthy }, unconfirmedActions };
```

`renderBattleReportMarkdown` 里军师决策段之后、哨兵摘要段之前加：

```js
  lines.push('');
  lines.push('## 未确认动作（24h）');
  const ua = data.unconfirmedActions || [];
  if (ua.length === 0) {
    lines.push('暂无');
  } else {
    for (const r of ua) {
      lines.push(`- ${r.kind ?? '未知'} → ${r.target ?? '-'}：${r.receipt_status ?? '?'}（${formatShanghaiShort(r.sent_at)}）`);
    }
  }
```

- [ ] **Step 5: 跑测试确认 PASS**

Run: `cd packages/brain && npx vitest run src/__tests__/battle-report.test.js`
Expected: 全 PASS

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/battle-report.js
git commit -m "feat(brain/T4): battle-report 加第⑥段未确认动作（24h）"
```

---

### Task 7: smoke 脚本 + sprint 文档 + 版本 bump + learning

**Files:**
- Create: `packages/brain/scripts/smoke/t4-receipt-collector-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`
- Create: `sprints/<MMDDHHNN>-nine-elements-t4-receipt-collector/prep-prd.md` + `DOD.md`
- Create: `docs/learnings/cp-<MMDDHHNN>-nine-elements-t4.md`
- Modify: `packages/brain/package.json` + 两处 package-lock + `.brain-versions` + `DEFINITION.md`

- [ ] **Step 1: smoke 脚本**

`SPRINT_TS=$(TZ=Asia/Shanghai date +%m%d%H%M)` 生成时间戳（下同）。创建 `packages/brain/scripts/smoke/t4-receipt-collector-smoke.sh`（chmod +x）：

```bash
#!/usr/bin/env bash
# Smoke: 九要素 T4 — 回执 collector
# 验证（纯读源码，CI 兼容不连库）：
#   1. receipt-collector.js 四导出 + 超时核销 SQL + 防环（不 import notifier/alerting）
#   2. 三入口接线：notifier / feishu-alert / ops.js deploy 都出现回执调用
#   3. scheduler-jobs 注册 receipt-collector job
#   4. battle-report 含未确认动作段
set -euo pipefail

echo "[t4-receipt-collector-smoke] 1. receipt-collector.js 结构"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/receipt-collector.js', 'utf8');
const checks = [
  ['export async function recordActionReceipt', 'record 导出'],
  ['export async function resolveActionReceipt', 'resolve 导出'],
  ['export async function runReceiptCollector', 'tick 导出'],
  ['export async function getUnconfirmedReceipts', '未确认查询导出'],
  [\"SET receipt_status = 'timeout'\", '超时核销 SQL'],
  ['make_interval(mins =>', '超时阈值参数化'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { console.error('FAIL:'); missing.forEach(([,d]) => console.error('  - ' + d)); process.exit(1); }
if (/from '\.\/notifier\.js'|from '\.\/alerting\.js'/.test(src)) {
  console.error('FAIL: receipt-collector 不得 import notifier/alerting（防循环）'); process.exit(1);
}
console.log('receipt-collector.js 结构正确 ✓');
"

echo "[t4-receipt-collector-smoke] 2. 三入口接线"
node -e "
const fs = require('fs');
const entries = [
  ['packages/brain/src/notifier.js', ['recordActionReceipt', 'resolveActionReceipt']],
  ['packages/brain/src/feishu-alert.js', ['recordActionReceipt', 'skill_eval_webhook']],
  ['packages/brain/src/routes/ops.js', ['recordActionReceipt', \"target: 'production'\", \"target: 'staging'\"]],
];
for (const [file, needles] of entries) {
  const src = fs.readFileSync(file, 'utf8');
  const missing = needles.filter((n) => !src.includes(n));
  if (missing.length) { console.error('FAIL: ' + file + ' 缺少: ' + missing.join(', ')); process.exit(1); }
}
console.log('三入口接线正确 ✓');
"

echo "[t4-receipt-collector-smoke] 3. scheduler-jobs 注册"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
if (!src.includes(\"name: 'receipt-collector'\") || !src.includes('runReceiptCollector')) {
  console.error('FAIL: scheduler-jobs 未注册 receipt-collector'); process.exit(1);
}
console.log('scheduler-jobs 注册正确 ✓');
"

echo "[t4-receipt-collector-smoke] 4. battle-report 未确认动作段"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/battle-report.js', 'utf8');
if (!src.includes('未确认动作（24h）') || !src.includes('getUnconfirmedReceipts')) {
  console.error('FAIL: battle-report 缺未确认动作段'); process.exit(1);
}
console.log('battle-report 未确认动作段正确 ✓');
"

echo "[t4-receipt-collector-smoke] ALL PASS ✓"
```

`packages/quality/smoke-allowlist.txt` 按字母序插入一行 `t4-receipt-collector-smoke.sh`。

Run: `bash packages/brain/scripts/smoke/t4-receipt-collector-smoke.sh`
Expected: ALL PASS ✓

- [ ] **Step 2: sprint 文档（prep-prd.md + DOD.md）**

`sprints/${SPRINT_TS}-nine-elements-t4-receipt-collector/prep-prd.md`：

```markdown
# PrepPRD：九要素 T4 — 回执 collector

任务：213e2122-1085-4c20-8001-e1bc3bf58de7（plan nine-elements-integrity seq=4）
设计：docs/architecture/2026-07-10-nine-elements-integrity/architecture.md + PR #3731
Spec：docs/superpowers/specs/2026-07-10-t4-receipt-collector-design.md

## 本次要做的
对外动作"发出即成功"是谎言。三入口（notifier 飞书/Bark、feishu-alert skill_eval 告警、
deploy webhook 生产/staging 部署）发送后写 action_receipts(pending)，按真实结果核销
confirmed/failed；无人核销的由 tick job 超 30min 标 timeout；作战日报新增
"未确认动作（24h）"段，主理人每天能看到哪些动作发出去了但效果没确认。

## 完成后用户能
1. 在作战日报里看到 24h 内所有未确认的对外动作（kind/target/状态/时间）
2. ledger-hygiene 指标3（回执核销率）自动激活，欠账进棘轮
3. psql 查 action_receipts 能审计每次飞书/Bark/部署的真实结果

## 不包含
- 回执独立告警（走 T1 棘轮）
- pr_merge 等其他动作接入（留后续）
- 主动探测确认（首版核销只靠入口回调 + 超时）
```

`sprints/${SPRINT_TS}-nine-elements-t4-receipt-collector/DOD.md`（push 前全部勾 [x]）：

```markdown
# DoD：九要素T4 回执collector

- [ ] [BEHAVIOR] receipt-collector：record 写 pending、resolve 核销 confirmed/failed（仅 pending 行）、tick 超 30min 标 timeout（10min 自 gate）、getUnconfirmedReceipts 查 24h 未确认；全路径 fail-open
  - Test: tests/ packages/brain/src/__tests__/receipt-collector.test.js
- [ ] [BEHAVIOR] notifier 三渠道（feishu webhook / open_api / bark）真实发送时写回执并按结果核销；muted/未配置跳过不写
  - Test: tests/ packages/brain/src/__tests__/notifier-receipt.test.js
- [ ] [BEHAVIOR] feishu-alert skill_eval webhook 发送写回执并核销；未配置本地兜底不写
  - Test: tests/ packages/brain/src/__tests__/feishu-alert-receipt.test.js
- [ ] [BEHAVIOR] deploy webhook production/staging 触发写 pending，close/execSync 结果核销；鉴权失败不写
  - Test: tests/ packages/brain/src/__tests__/deploy-receipt.test.js
- [ ] [BEHAVIOR] scheduler-jobs 注册 receipt-collector（11 jobs）；battle-report 渲染"未确认动作（24h）"段且查询失败降级
  - Test: tests/ packages/brain/src/__tests__/scheduler-jobs.test.js
- [ ] 版本 bump 1.250.0 四处同步（check-version-sync.sh 通过）
- [ ] smoke: manual: bash packages/brain/scripts/smoke/t4-receipt-collector-smoke.sh
- [ ] CI 全绿
```

- [ ] **Step 3: learning 文件**

`docs/learnings/cp-${SPRINT_TS}-nine-elements-t4.md`：

```markdown
# T4 回执 collector：对外动作三入口接 action_receipts 台账

### 根本原因
migration 315 建了 action_receipts 表但零写入方——"发出即成功"没有任何一处被挑战，
表空转 3 个月。写入方靠 skill 自觉必然重蹈 golden_path 挂死图覆辙，必须代码级接在
动作发起点（notifier/feishu-alert/deploy webhook）。

### 下次预防
- [ ] 建表的 PR 必须同时接至少一个写入方，否则表就是僵尸（九要素 T1 保鲜守卫已把
      "该写的没写"做成棘轮指标，本表的核销率是指标3）
- [ ] 对外动作模块（notifier 等）保持 DB-free import 图：新增 DB 副作用一律动态
      import + fail-open，测试零 mock 负担
```

- [ ] **Step 4: 版本 bump 四处同步**

```bash
cd packages/brain && npm version minor --no-git-tag-version && cd ../..
# 根 package-lock.json 里 packages/brain 的 version 引用（npm 会自动改；若没有：）
node -e "
const fs=require('fs');
const f='package-lock.json';
const j=JSON.parse(fs.readFileSync(f,'utf8'));
if (j.packages && j.packages['packages/brain']) { j.packages['packages/brain'].version='1.250.0'; fs.writeFileSync(f, JSON.stringify(j,null,2)+'\n'); }
"
echo "1.250.0" >> .brain-versions
# DEFINITION.md 的 "Brain 版本:" 行改成 1.250.0
bash scripts/check-version-sync.sh
```

Expected: check-version-sync.sh 通过。
⚠️ 若 main 已被并行 PR 占用 1.250.0，抬到 1.251.0 并同步改 DOD.md 里的版本号（T3 有先例）。

- [ ] **Step 5: DevGate + 全量相关测试**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
cd packages/brain && npx vitest run src/__tests__/receipt-collector.test.js src/__tests__/notifier-receipt.test.js src/__tests__/feishu-alert-receipt.test.js src/__tests__/deploy-receipt.test.js src/__tests__/scheduler-jobs.test.js src/__tests__/battle-report.test.js src/__tests__/notifier.test.js src/__tests__/notifier-dedupe.test.js src/__tests__/ledger-hygiene.test.js
```

Expected: 全部通过。（⚠️ 不跑 brain 全量 vitest——环境级 OOM 前科，见 memory；相关文件集已覆盖改动面。）

- [ ] **Step 6: commit**

```bash
git add packages/brain/scripts/smoke/ packages/quality/smoke-allowlist.txt sprints/ docs/learnings/ packages/brain/package.json packages/brain/package-lock.json package-lock.json .brain-versions DEFINITION.md
git commit -m "chore(brain/T4): smoke脚本+sprint文档+learning+版本1.250.0四处同步"
```

（commit message 不用 `feat:` 开头避免误触 CI 闸——教训见 fix-escalation-silent-cancel-postmortem。）

---

## Self-Review 结论

- Spec 覆盖：模块①→Task 1；三入口②→Task 2/3/4；注册③→Task 5；日报④→Task 6；版本/smoke/文档→Task 7。无缺口。
- ledger-hygiene 不改（spec 明确），smoke 不验它。
- 类型一致性：`recordActionReceipt({kind,target,actionId,evidence}) → id|null`、`resolveActionReceipt(id,status,evidence) → boolean`、`runReceiptCollector(pool) → {skipped?,timedOut}`、`getUnconfirmedReceipts(pool) → rows`，各 Task 用法一致；battle-report 数据键 `unconfirmedActions` 前后一致。
```
