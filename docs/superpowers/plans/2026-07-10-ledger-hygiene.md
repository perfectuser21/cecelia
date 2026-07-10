# 账本保鲜守卫 ledger-hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每晚北京 05:10 计算 5 项账本卫生指标落 design_docs，欠账棘轮击穿自动开 issue，连续 3 天升 P1+Bark。

**Architecture:** 新建 `ledger-hygiene.js`（镜像 line-dreaming.js 的窗口自 gate + 20h 去重模式），注册进 scheduler-jobs.js JOBS 表；棘轮状态存 working_memory；一个小 migration 给 design_docs.type CHECK 加 `ledger_hygiene`。

**Tech Stack:** Node.js ESM、pg Pool、vitest（mock pool 单测）。

**Spec:** docs/superpowers/specs/2026-07-10-ledger-hygiene-design.md

---

### Task 1: Migration 331 — design_docs.type 加 ledger_hygiene

**Files:**
- Create: `packages/brain/migrations/331_design_docs_ledger_hygiene.sql`

- [ ] **Step 1: 写 migration**

```sql
-- Migration 331: design_docs.type CHECK 加 'ledger_hygiene'
-- 账本保鲜守卫（九要素 T1）每晚卫生分落库用。先例：328 加 line_ledger 同法。

ALTER TABLE design_docs
  DROP CONSTRAINT IF EXISTS design_docs_type_check;

ALTER TABLE design_docs
  ADD CONSTRAINT design_docs_type_check
    CHECK (type IN (
      'diary',
      'research',
      'architecture',
      'proposal',
      'analysis',
      'meeting',
      'strategy',
      'roadmap',
      'retrospective',
      'idea',
      'context',
      'battle_report',
      'line_ledger',
      'ledger_hygiene'
    ));
```

- [ ] **Step 2: 语法冒烟（无 DB，仅确认文件非空可读）**

Run: `node -e "const s=require('fs').readFileSync('packages/brain/migrations/331_design_docs_ledger_hygiene.sql','utf8'); if(!s.includes('ledger_hygiene')) process.exit(1); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add packages/brain/migrations/331_design_docs_ledger_hygiene.sql
git commit -m "feat(brain): migration 331 design_docs.type 加 ledger_hygiene"
```

---

### Task 2: ledger-hygiene.js 核心模块（TDD）

**Files:**
- Create: `packages/brain/src/__tests__/ledger-hygiene.test.js`
- Create: `packages/brain/src/ledger-hygiene.js`

- [ ] **Step 1: 写失败测试（完整文件）**

```js
// packages/brain/src/__tests__/ledger-hygiene.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../notifier.js', () => ({
  sendBark: vi.fn().mockResolvedValue(true),
}));

import { sendBark } from '../notifier.js';
import {
  isInLedgerHygieneWindow,
  computeMetrics,
  evaluateRatchet,
  renderHygieneMarkdown,
  maybeRunLedgerHygiene,
  RATCHET_KEY,
} from '../ledger-hygiene.js';

/**
 * mock pool：按 SQL 关键词路由返回值，记录全部调用。
 * routes: Array<{match: string, rows: Array}>
 */
function makePool(routes = []) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      const hit = routes.find((r) => sql.includes(r.match));
      return { rows: hit ? hit.rows : [] };
    }),
  };
}

describe('isInLedgerHygieneWindow — UTC 21:10-21:15（北京 05:10）', () => {
  it('窗口内 true', () => {
    expect(isInLedgerHygieneWindow(new Date(Date.UTC(2026, 6, 10, 21, 12)))).toBe(true);
  });
  it('窗口前（line-dreaming 时段 21:00）false', () => {
    expect(isInLedgerHygieneWindow(new Date(Date.UTC(2026, 6, 10, 21, 0)))).toBe(false);
  });
  it('窗口后 21:15 false', () => {
    expect(isInLedgerHygieneWindow(new Date(Date.UTC(2026, 6, 10, 21, 15)))).toBe(false);
  });
  it('其他小时 false', () => {
    expect(isInLedgerHygieneWindow(new Date(Date.UTC(2026, 6, 10, 10, 12)))).toBe(false);
  });
});

describe('computeMetrics — 5 项指标', () => {
  it('m1 FR沉淀率：3 个 merged run，1 个无 golden_path 行 → value=2/3, debt=1', async () => {
    const pool = makePool([
      { match: 'FROM tasks t', rows: [{ total: '3', debt: '1' }] },
    ]);
    const m = await computeMetrics(pool);
    expect(m.m1.debt).toBe(1);
    expect(m.m1.value).toBeCloseTo(2 / 3);
    expect(m.m1.enabled).toBe(true);
  });

  it('m1 近7天无 merged run → value=1, debt=0（真空真值）', async () => {
    const pool = makePool([
      { match: 'FROM tasks t', rows: [{ total: '0', debt: '0' }] },
    ]);
    const m = await computeMetrics(pool);
    expect(m.m1.value).toBe(1);
    expect(m.m1.debt).toBe(0);
  });

  it('m2 归属完整率：tasks缺2 + issues缺1 + harness缺1 → debt=4', async () => {
    const pool = makePool([
      { match: 'attribution_tasks', rows: [{ total: '10', debt: '2' }] },
      { match: 'attribution_issues', rows: [{ total: '5', debt: '1' }] },
      { match: 'attribution_harness', rows: [{ total: '3', debt: '1' }] },
    ]);
    const m = await computeMetrics(pool);
    expect(m.m2.debt).toBe(4);
    expect(m.m2.value).toBeCloseTo(14 / 18);
  });

  it('m3 回执核销：表全空 → enabled=false；有行 → enabled=true, debt=超时 pending 数', async () => {
    const empty = makePool([
      { match: 'FROM action_receipts LIMIT 1', rows: [] },
    ]);
    expect((await computeMetrics(empty)).m3.enabled).toBe(false);

    const withRows = makePool([
      { match: 'FROM action_receipts LIMIT 1', rows: [{ '?column?': 1 }] },
      { match: "receipt_status = 'pending'", rows: [{ debt: '2' }] },
    ]);
    const m = await computeMetrics(withRows);
    expect(m.m3.enabled).toBe(true);
    expect(m.m3.debt).toBe(2);
  });

  it('m4 知识保质期：review_after 过期 5 条 → debt=5', async () => {
    const pool = makePool([
      { match: 'review_after < NOW()', rows: [{ debt: '5' }] },
    ]);
    const m = await computeMetrics(pool);
    expect(m.m4.debt).toBe(5);
    expect(m.m4.enabled).toBe(true);
  });

  it('m5 判定点活性：从未有 judgment → enabled=false；有史且 30 天 0 条 → debt=1', async () => {
    const never = makePool([
      { match: "category = 'judgment' LIMIT 1", rows: [] },
    ]);
    expect((await computeMetrics(never)).m5.enabled).toBe(false);

    const stale = makePool([
      { match: "category = 'judgment' LIMIT 1", rows: [{ '?column?': 1 }] },
      { match: 'judgment_recent', rows: [{ cnt: '0' }] },
    ]);
    const m = await computeMetrics(stale);
    expect(m.m5.enabled).toBe(true);
    expect(m.m5.debt).toBe(1);
    expect(m.m5.value).toBe(0);
  });

  it('单指标 SQL 失败 → 该指标 enabled=false，其他指标不受影响', async () => {
    const pool = makePool([
      { match: 'review_after < NOW()', rows: [{ debt: '5' }] },
    ]);
    const orig = pool.query.getMockImplementation();
    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM tasks t')) throw new Error('boom');
      return orig(sql, params);
    });
    const m = await computeMetrics(pool);
    expect(m.m1.enabled).toBe(false);
    expect(m.m4.debt).toBe(5);
  });
});

describe('evaluateRatchet — 棘轮逻辑', () => {
  const metrics = (debts) => {
    const out = {};
    for (const [k, debt] of Object.entries(debts)) {
      out[k] = { key: k, name: k, value: 0.5, debt, enabled: true };
    }
    return out;
  };

  it('首跑无 prev → 建基线，零击穿', () => {
    const { state, breaches } = evaluateRatchet(metrics({ m1: 3, m4: 5 }), null, '2026-07-10');
    expect(breaches).toEqual([]);
    expect(state.baseline).toEqual({ m1: 3, m4: 5 });
    expect(state.last).toEqual({ m1: 3, m4: 5 });
    expect(state.streaks).toEqual({ m1: 0, m4: 0 });
  });

  it('debt 上升 → 击穿 + streak+1', () => {
    const prev = { baseline: { m1: 3 }, last: { m1: 3 }, streaks: { m1: 0 }, baseline_date: '2026-07-09' };
    const { state, breaches } = evaluateRatchet(metrics({ m1: 4 }), prev, '2026-07-10');
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({ key: 'm1', prevDebt: 3, debt: 4, streak: 1 });
    expect(state.streaks.m1).toBe(1);
  });

  it('debt 持平或下降 → 无击穿，streak 清零', () => {
    const prev = { baseline: { m1: 3 }, last: { m1: 4 }, streaks: { m1: 2 }, baseline_date: '2026-07-09' };
    const { state, breaches } = evaluateRatchet(metrics({ m1: 4 }), prev, '2026-07-10');
    expect(breaches).toEqual([]);
    expect(state.streaks.m1).toBe(0);
  });

  it('连续第 3 天击穿 → streak=3', () => {
    const prev = { baseline: { m1: 3 }, last: { m1: 5 }, streaks: { m1: 2 }, baseline_date: '2026-07-08' };
    const { breaches } = evaluateRatchet(metrics({ m1: 6 }), prev, '2026-07-10');
    expect(breaches[0].streak).toBe(3);
  });

  it('disabled 指标不参与棘轮', () => {
    const m = { m3: { key: 'm3', name: 'm3', value: null, debt: 9, enabled: false } };
    const prev = { baseline: {}, last: {}, streaks: {}, baseline_date: '2026-07-09' };
    const { state, breaches } = evaluateRatchet(m, prev, '2026-07-10');
    expect(breaches).toEqual([]);
    expect(state.last.m3).toBeUndefined();
  });
});

describe('renderHygieneMarkdown', () => {
  it('含 5 指标表格与击穿段', () => {
    const metrics = {
      m1: { key: 'm1', name: 'FR沉淀率', value: 0.5, debt: 2, enabled: true },
      m3: { key: 'm3', name: '回执核销', value: null, debt: 0, enabled: false },
    };
    const md = renderHygieneMarkdown('2026-07-10', metrics, [
      { key: 'm1', name: 'FR沉淀率', prevDebt: 1, debt: 2, streak: 1 },
    ]);
    expect(md).toContain('FR沉淀率');
    expect(md).toContain('未启用');
    expect(md).toContain('击穿');
  });
});

describe('maybeRunLedgerHygiene — 主入口', () => {
  const IN_WINDOW = new Date(Date.UTC(2026, 6, 10, 21, 12));

  function fullRoutes(overrides = {}) {
    return [
      { match: "type = 'ledger_hygiene'", rows: overrides.dedupe ?? [] },
      { match: 'FROM tasks t', rows: [{ total: '3', debt: overrides.m1debt ?? '1' }] },
      { match: 'attribution_tasks', rows: [{ total: '10', debt: '0' }] },
      { match: 'attribution_issues', rows: [{ total: '5', debt: '0' }] },
      { match: 'attribution_harness', rows: [{ total: '3', debt: '0' }] },
      { match: 'FROM action_receipts LIMIT 1', rows: [] },
      { match: 'review_after < NOW()', rows: [{ debt: '0' }] },
      { match: "category = 'judgment' LIMIT 1", rows: [] },
      { match: RATCHET_KEY, rows: overrides.ratchet ?? [] },
    ];
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('非窗口期不执行', async () => {
    const pool = makePool();
    const r = await maybeRunLedgerHygiene(pool, new Date(Date.UTC(2026, 6, 10, 10, 0)));
    expect(r.triggered).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('20h 内已有记录 → skip', async () => {
    const pool = makePool(fullRoutes({ dedupe: [{ id: 'x' }] }));
    const r = await maybeRunLedgerHygiene(pool, IN_WINDOW);
    expect(r.triggered).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it('首跑：写基线 + 落 design_docs + 不开 issue', async () => {
    const pool = makePool(fullRoutes());
    const r = await maybeRunLedgerHygiene(pool, IN_WINDOW);
    expect(r.skipped).toBe(false);
    expect(r.breaches).toBe(0);
    const inserts = pool.calls.filter((c) => c.sql.includes('INSERT INTO design_docs'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params).toContain('ledger_hygiene');
    const ratchetWrite = pool.calls.find((c) => c.sql.includes('INSERT INTO working_memory'));
    expect(ratchetWrite).toBeTruthy();
    const issueInsert = pool.calls.find((c) => c.sql.includes('INSERT INTO issues'));
    expect(issueInsert).toBeUndefined();
  });

  it('欠账上升 → 击穿开 P2 issue（proven-to-fire）', async () => {
    const prev = {
      baseline: { m1: 0, m2: 0, m4: 0 },
      last: { m1: 0, m2: 0, m4: 0 },
      streaks: { m1: 0, m2: 0, m4: 0 },
      baseline_date: '2026-07-09',
    };
    const pool = makePool(
      fullRoutes({ m1debt: '2', ratchet: [{ value_json: JSON.stringify(prev) }] })
    );
    const r = await maybeRunLedgerHygiene(pool, IN_WINDOW);
    expect(r.breaches).toBe(1);
    const issueInsert = pool.calls.find((c) => c.sql.includes('INSERT INTO issues'));
    expect(issueInsert).toBeTruthy();
    expect(issueInsert.params[0]).toContain('[ledger-hygiene]');
    expect(issueInsert.params[1]).toBe('P2');
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('连续 3 天击穿 → P1 + Bark', async () => {
    const prev = {
      baseline: { m1: 0, m2: 0, m4: 0 },
      last: { m1: 1, m2: 0, m4: 0 },
      streaks: { m1: 2, m2: 0, m4: 0 },
      baseline_date: '2026-07-07',
    };
    const pool = makePool(
      fullRoutes({ m1debt: '2', ratchet: [{ value_json: JSON.stringify(prev) }] })
    );
    await maybeRunLedgerHygiene(pool, IN_WINDOW);
    const issueInsert = pool.calls.find((c) => c.sql.includes('INSERT INTO issues'));
    expect(issueInsert.params[1]).toBe('P1');
    expect(sendBark).toHaveBeenCalledTimes(1);
  });

  it('issue 写入失败不阻断落库', async () => {
    const prev = {
      baseline: { m1: 0, m2: 0, m4: 0 },
      last: { m1: 0, m2: 0, m4: 0 },
      streaks: { m1: 0, m2: 0, m4: 0 },
      baseline_date: '2026-07-09',
    };
    const pool = makePool(
      fullRoutes({ m1debt: '2', ratchet: [{ value_json: JSON.stringify(prev) }] })
    );
    const orig = pool.query.getMockImplementation();
    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('INSERT INTO issues')) throw new Error('issues down');
      return orig(sql, params);
    });
    const r = await maybeRunLedgerHygiene(pool, IN_WINDOW);
    expect(r.breaches).toBe(1);
    expect(pool.calls.find((c) => c.sql.includes('INSERT INTO design_docs'))).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/ledger-hygiene.test.js 2>&1 | tail -20`
Expected: FAIL（Cannot find module '../ledger-hygiene.js'）

- [ ] **Step 3: 写实现（完整文件）**

```js
// packages/brain/src/ledger-hygiene.js
/**
 * ledger-hygiene.js — 账本保鲜守卫 tick job（九要素 T1）
 *
 * 每晚北京 05:10（UTC 21:10，line-dreaming 05:00 后、battle-report 06:00 前）
 * 计算 5 项账本卫生指标，落 design_docs(type='ledger_hygiene') 供晨报/军师消费。
 * 每项"欠账数"走棘轮（只许降不许升，基线=首跑快照）：击穿开 [ledger-hygiene] P2
 * issue，连续 3 天击穿升 P1 + Bark。棘轮状态存 working_memory（不解析 markdown 回读）。
 *
 * 指标定义见 docs/architecture/2026-07-10-nine-elements-integrity/architecture.md。
 */
import { sendBark } from './notifier.js';

/** 每晚触发窗口（UTC）= 北京时间 05:10-05:15 */
const LEDGER_HYGIENE_HOUR_UTC = 21;
const WINDOW_MINUTE_START = 10;
const WINDOW_MINUTE_END = 15;

export const RATCHET_KEY = 'ledger_hygiene_ratchet';

/** 判断当前是否在守卫窗口内（UTC 21:10-21:15）。 */
export function isInLedgerHygieneWindow(now = new Date()) {
  return (
    now.getUTCHours() === LEDGER_HYGIENE_HOUR_UTC &&
    now.getUTCMinutes() >= WINDOW_MINUTE_START &&
    now.getUTCMinutes() < WINDOW_MINUTE_END
  );
}

/** 单指标计算容错包装：失败返回 enabled=false 的占位，不阻断其他指标。 */
async function safeMetric(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[ledger-hygiene] 指标 ${fallback.key} 计算失败（标记未启用）:`, err.message);
    return { ...fallback, enabled: false, error: err.message };
  }
}

const toInt = (v) => parseInt(v ?? '0', 10) || 0;

/**
 * 计算 5 项卫生指标。每项 {key, name, value, debt, enabled}。
 * debt=欠账数（棘轮口径）；enabled=false 表示该指标暂不可用/未激活，不参与棘轮。
 */
export async function computeMetrics(pool) {
  const m1 = await safeMetric(async () => {
    // FR 沉淀率：近 7 天 merged 的 harness run 中 golden_path 有行的比例
    const { rows } = await pool.query(
      `SELECT count(*) AS total,
              count(*) FILTER (
                WHERE NOT EXISTS (SELECT 1 FROM golden_path gp WHERE gp.owner_task_id = t.id)
              ) AS debt
       FROM tasks t
       WHERE t.task_type = 'harness_initiative'
         AND t.status = 'completed'
         AND t.pr_merged_at IS NOT NULL
         AND t.completed_at >= NOW() - INTERVAL '7 days'`
    );
    const total = toInt(rows[0]?.total);
    const debt = toInt(rows[0]?.debt);
    return { key: 'm1', name: 'FR沉淀率', value: total === 0 ? 1 : (total - debt) / total, debt, enabled: true };
  }, { key: 'm1', name: 'FR沉淀率', value: null, debt: 0 });

  const m2 = await safeMetric(async () => {
    // 归属完整率：近 7 天新建 tasks/issues 的 journey 归属 + harness 任务 ability 归属
    const [t, i, h] = await Promise.all([
      pool.query(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE COALESCE(payload->>'journey_id', '') = '') AS debt
         FROM tasks /* attribution_tasks */
         WHERE created_at >= NOW() - INTERVAL '7 days'`
      ),
      pool.query(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE journey_id IS NULL) AS debt
         FROM issues /* attribution_issues */
         WHERE created_at >= NOW() - INTERVAL '7 days'`
      ),
      pool.query(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE ability_id IS NULL) AS debt
         FROM tasks /* attribution_harness */
         WHERE task_type = 'harness_initiative'
           AND created_at >= NOW() - INTERVAL '7 days'`
      ),
    ]);
    const total = toInt(t.rows[0]?.total) + toInt(i.rows[0]?.total) + toInt(h.rows[0]?.total);
    const debt = toInt(t.rows[0]?.debt) + toInt(i.rows[0]?.debt) + toInt(h.rows[0]?.debt);
    return { key: 'm2', name: '归属完整率', value: total === 0 ? 1 : (total - debt) / total, debt, enabled: true };
  }, { key: 'm2', name: '归属完整率', value: null, debt: 0 });

  const m3 = await safeMetric(async () => {
    // 回执核销率：pending 超 24h 未核销数。表全空 = T4 未上线，未激活。
    const probe = await pool.query(`SELECT 1 FROM action_receipts LIMIT 1`);
    if (probe.rows.length === 0) {
      return { key: 'm3', name: '回执核销', value: null, debt: 0, enabled: false };
    }
    const { rows } = await pool.query(
      `SELECT count(*) AS debt
       FROM action_receipts
       WHERE receipt_status = 'pending'
         AND sent_at < NOW() - INTERVAL '24 hours'`
    );
    return { key: 'm3', name: '回执核销', value: null, debt: toInt(rows[0]?.debt), enabled: true };
  }, { key: 'm3', name: '回执核销', value: null, debt: 0 });

  const m4 = await safeMetric(async () => {
    // 知识保质期：review_after 到点未复审的决策数（06f78c9a 月度扫描欠账）
    const { rows } = await pool.query(
      `SELECT count(*) AS debt
       FROM decisions
       WHERE review_after IS NOT NULL
         AND review_after < NOW()`
    );
    return { key: 'm4', name: '知识保质期', value: null, debt: toInt(rows[0]?.debt), enabled: true };
  }, { key: 'm4', name: '知识保质期', value: null, debt: 0 });

  const m5 = await safeMetric(async () => {
    // 判定点活性：近 30 天新增 judgment 条数。从未有过 = T5 未上线，未激活；
    // 已激活且 30 天 0 条 = 学习回路断电，计 debt=1。
    const ever = await pool.query(
      `SELECT 1 FROM decisions WHERE category = 'judgment' LIMIT 1`
    );
    if (ever.rows.length === 0) {
      return { key: 'm5', name: '判定点活性', value: null, debt: 0, enabled: false };
    }
    const { rows } = await pool.query(
      `SELECT count(*) AS cnt
       FROM decisions /* judgment_recent */
       WHERE category = 'judgment'
         AND created_at >= NOW() - INTERVAL '30 days'`
    );
    const cnt = toInt(rows[0]?.cnt);
    return { key: 'm5', name: '判定点活性', value: cnt, debt: cnt === 0 ? 1 : 0, enabled: true };
  }, { key: 'm5', name: '判定点活性', value: null, debt: 0 });

  return { m1, m2, m3, m4, m5 };
}

/**
 * 棘轮比较（纯函数）：enabled 指标 debt 较上次上升即击穿。
 * @returns {{state: object, breaches: Array<{key, name, prevDebt, debt, streak}>}}
 */
export function evaluateRatchet(metrics, prev, today) {
  const state = {
    baseline: { ...(prev?.baseline ?? {}) },
    last: {},
    streaks: {},
    baseline_date: prev?.baseline_date ?? today,
  };
  const breaches = [];

  for (const m of Object.values(metrics)) {
    if (!m.enabled) continue;
    if (state.baseline[m.key] === undefined) state.baseline[m.key] = m.debt;
    const prevDebt = prev?.last?.[m.key];
    const prevStreak = prev?.streaks?.[m.key] ?? 0;
    if (prevDebt !== undefined && m.debt > prevDebt) {
      const streak = prevStreak + 1;
      state.streaks[m.key] = streak;
      breaches.push({ key: m.key, name: m.name, prevDebt, debt: m.debt, streak });
    } else {
      state.streaks[m.key] = 0;
    }
    state.last[m.key] = m.debt;
  }

  return { state, breaches };
}

/** 渲染卫生分 markdown（5 指标表格 + 击穿段）。 */
export function renderHygieneMarkdown(today, metrics, breaches) {
  const lines = [`# 账本卫生分 ${today}`, ''];
  lines.push('| 指标 | 值 | 欠账 | 状态 |');
  lines.push('|---|---|---|---|');
  for (const m of Object.values(metrics)) {
    const value =
      typeof m.value === 'number' && m.value <= 1 && m.key !== 'm5'
        ? `${Math.round(m.value * 100)}%`
        : (m.value ?? '—');
    lines.push(`| ${m.name} | ${value} | ${m.debt} | ${m.enabled ? '启用' : '未启用'} |`);
  }
  lines.push('');
  lines.push('## 棘轮击穿');
  if (breaches.length === 0) {
    lines.push('无');
  } else {
    for (const b of breaches) {
      lines.push(`- **${b.name}** 欠账 ${b.prevDebt} → ${b.debt}（连续第 ${b.streak} 天击穿）`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** 读棘轮状态（无记录返回 null，解析失败视为无）。 */
async function loadRatchet(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = '${RATCHET_KEY}' LIMIT 1`
    );
    if (rows.length === 0) return null;
    const raw = rows[0].value_json;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    console.warn('[ledger-hygiene] 棘轮状态读取失败（按首跑处理）:', err.message);
    return null;
  }
}

/** 写棘轮状态（upsert）。 */
async function saveRatchet(pool, state) {
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [RATCHET_KEY, JSON.stringify(state)]
  );
}

/** 击穿告警：开 issue（streak≥3 升 P1 + Bark）。失败只 warn 不阻断。 */
async function raiseBreachAlerts(pool, breaches, today) {
  for (const b of breaches) {
    const escalated = b.streak >= 3;
    const priority = escalated ? 'P1' : 'P2';
    const title = `[ledger-hygiene] ${b.name} 欠账上升 ${b.prevDebt}→${b.debt}（${today}）`;
    try {
      await pool.query(
        `INSERT INTO issues (title, priority, status, sub_area, body, journey_id)
         VALUES ($1, $2, 'In progress', 'brain', $3, NULL)`,
        [
          title,
          priority,
          `账本保鲜守卫棘轮击穿：指标「${b.name}」欠账 ${b.prevDebt} → ${b.debt}，连续第 ${b.streak} 天。` +
            `指标定义见 docs/architecture/2026-07-10-nine-elements-integrity/architecture.md；` +
            `当日分数卡见 design_docs(type='ledger_hygiene')。`,
        ]
      );
    } catch (err) {
      console.warn('[ledger-hygiene] issue 写入失败:', err.message);
    }
    if (escalated) {
      await sendBark(
        `📉 账本保鲜连续 ${b.streak} 天击穿`,
        `${b.name} 欠账 ${b.prevDebt}→${b.debt}，已升 P1，请处理。`
      ).catch((err) => console.warn('[ledger-hygiene] Bark 发送失败:', err.message));
    }
  }
}

/** 落库：20h 内已有当日记录则 UPDATE，否则 INSERT。 */
async function upsertHygieneDoc(pool, today, markdown) {
  const { rows } = await pool.query(
    `SELECT id FROM design_docs
     WHERE type = 'ledger_hygiene'
       AND created_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`
  );
  if (rows.length > 0) {
    await pool.query(`UPDATE design_docs SET content = $2, updated_at = NOW() WHERE id = $1`, [
      rows[0].id,
      markdown,
    ]);
    return;
  }
  await pool.query(
    `INSERT INTO design_docs (type, title, content, author)
     VALUES ($1, $2, $3, 'cecelia')`,
    ['ledger_hygiene', `账本卫生分 ${today}`, markdown]
  );
}

/**
 * 守卫主入口：窗口 gate → 20h 去重 → 算指标 → 棘轮 → 告警 → 落库 → 存棘轮状态。
 * @returns {Promise<{triggered: boolean, skipped?: boolean, breaches?: number}>}
 */
export async function maybeRunLedgerHygiene(pool, now = new Date()) {
  if (!isInLedgerHygieneWindow(now)) {
    return { triggered: false };
  }

  const { rows } = await pool.query(
    `SELECT id FROM design_docs
     WHERE type = 'ledger_hygiene'
       AND created_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`
  );
  if (rows.length > 0) {
    return { triggered: true, skipped: true };
  }

  const today = now.toISOString().slice(0, 10);
  const metrics = await computeMetrics(pool);
  const prev = await loadRatchet(pool);
  const { state, breaches } = evaluateRatchet(metrics, prev, today);

  await raiseBreachAlerts(pool, breaches, today);
  await upsertHygieneDoc(pool, today, renderHygieneMarkdown(today, metrics, breaches));
  await saveRatchet(pool, state);

  return { triggered: true, skipped: false, breaches: breaches.length };
}
```

注意：`loadRatchet` 的 SELECT 里 RATCHET_KEY 用模板内插（测试按 `RATCHET_KEY` 关键词路由）；
`upsertHygieneDoc` 与去重查询同用 `type = 'ledger_hygiene'` 关键词，测试 dedupe 路由同时命中两处——
主入口先查去重（空=继续），upsert 内再查（空=INSERT），语义一致无冲突。

- [ ] **Step 4: 跑测试确认全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/ledger-hygiene.test.js 2>&1 | tail -15`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/ledger-hygiene.js packages/brain/src/__tests__/ledger-hygiene.test.js
git commit -m "feat(brain): ledger-hygiene 账本保鲜守卫——5指标+棘轮+击穿开issue（九要素T1）"
```

---

### Task 3: 注册进 scheduler-jobs.js（TDD）

**Files:**
- Modify: `packages/brain/src/__tests__/scheduler-jobs.test.js`
- Modify: `packages/brain/src/scheduler-jobs.js`

- [ ] **Step 1: 改测试（加 mock + 断言）**

在 `scheduler-jobs.test.js` 顶部已有的 vi.mock 块附近，仿照 line-dreaming 的 mock 加：

```js
vi.mock('../ledger-hygiene.js', () => ({
  maybeRunLedgerHygiene: vi.fn().mockResolvedValue({ triggered: false }),
}));
```

import 区加：

```js
import { maybeRunLedgerHygiene } from '../ledger-hygiene.js';
```

在断言各 handler 被调用的测试里（现有 `expect(maybeRunLineDreaming).toHaveBeenCalledWith(pool)` 附近）加：

```js
expect(maybeRunLedgerHygiene).toHaveBeenCalledWith(pool);
```

若测试文件里有 JOBS 数量断言（如 `expect(JOBS).toHaveLength(8)`），同步 +1。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js 2>&1 | tail -10`
Expected: FAIL（maybeRunLedgerHygiene 未被调用）

- [ ] **Step 3: 改 scheduler-jobs.js**

import 区（`maybeGenerateBattleReport` 之后）加：

```js
import { maybeRunLedgerHygiene } from './ledger-hygiene.js';
```

JOBS 数组 `line-dreaming` 行之后加：

```js
  { name: 'ledger-hygiene', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeRunLedgerHygiene, description: '账本保鲜守卫（自带北京05:10窗口+20h去重，5指标+棘轮击穿开issue）' },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js src/__tests__/ledger-hygiene.test.js 2>&1 | tail -10`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/scheduler-jobs.js packages/brain/src/__tests__/scheduler-jobs.test.js
git commit -m "feat(brain): scheduler-jobs 注册 ledger-hygiene 守卫 job"
```

---

### Task 4: smoke 脚本 + 版本 bump

**Files:**
- Create: `packages/brain/scripts/smoke-ledger-hygiene.mjs`
- Modify: `packages/brain/package.json`（version 1.245.0 → 1.246.0）

- [ ] **Step 1: 写 smoke 脚本**

```js
#!/usr/bin/env node
// packages/brain/scripts/smoke-ledger-hygiene.mjs
// 真连 DB 跑一遍 5 指标 SQL 输出分数（只读不写库、不走窗口 gate）。
// Usage: DATABASE_URL=postgres://... node packages/brain/scripts/smoke-ledger-hygiene.mjs
import pg from 'pg';
import { computeMetrics, renderHygieneMarkdown } from '../src/ledger-hygiene.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/cecelia',
});

try {
  const metrics = await computeMetrics(pool);
  const today = new Date().toISOString().slice(0, 10);
  console.log(renderHygieneMarkdown(today, metrics, []));
  const disabled = Object.values(metrics).filter((m) => !m.enabled).map((m) => m.name);
  if (disabled.length > 0) console.log(`未启用指标（等上游 Task 上线自激活）：${disabled.join('、')}`);
} finally {
  await pool.end();
}
```

注：DB 端口以本机实际为准——先 `grep -r "5433\|DATABASE_URL" packages/brain/src/db-config.js` 确认默认连接串写法，与之保持一致。

- [ ] **Step 2: 语法冒烟**

Run: `node --check packages/brain/scripts/smoke-ledger-hygiene.mjs`
Expected: 无输出（语法 OK）

- [ ] **Step 3: 版本 bump**

`packages/brain/package.json` 的 `"version": "1.245.0"` 改为 `"version": "1.246.0"`。
若主仓 main 已推进版本，取 `git show origin/main:packages/brain/package.json | grep version` 的次版本 +1。
再检查 `packages/brain/src/selfcheck.js` 等四处版本同步：`bash scripts/check-version-sync.sh`。

- [ ] **Step 4: DevGate 全量门禁**

Run:
```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全部通过（失败则按报错修复后重跑）

- [ ] **Step 5: 全模块相关单测**

Run: `cd packages/brain && npx vitest run src/__tests__/ledger-hygiene.test.js src/__tests__/scheduler-jobs.test.js src/__tests__/line-dreaming.test.js 2>&1 | tail -10`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/brain/scripts/smoke-ledger-hygiene.mjs packages/brain/package.json
git commit -m "feat(brain): ledger-hygiene smoke 脚本 + version 1.246.0"
```

---

## DoD（PR body 用）

- [x] [BEHAVIOR] 窗口内首跑产出卫生分文档且不告警 — Test: tests/ `packages/brain/src/__tests__/ledger-hygiene.test.js`
- [x] [BEHAVIOR] 欠账上升棘轮击穿开 [ledger-hygiene] P2 issue，连续 3 天升 P1+Bark — Test: tests/ `packages/brain/src/__tests__/ledger-hygiene.test.js`
- [x] [BEHAVIOR] scheduler-jobs 注册表含 ledger-hygiene 且 handler 被调用 — Test: tests/ `packages/brain/src/__tests__/scheduler-jobs.test.js`
- [x] migration 331 加 ledger_hygiene 类型 — Test: manual: `node -e "const s=require('fs').readFileSync('packages/brain/migrations/331_design_docs_ledger_hygiene.sql','utf8'); if(!s.includes('ledger_hygiene')) process.exit(1); console.log('ok')"`
- [x] smoke 脚本语法有效 — Test: manual: `node --check packages/brain/scripts/smoke-ledger-hygiene.mjs`
- [x] CI 全绿
