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

describe('computeMetrics — 6 项指标', () => {
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

  it('m2 归属完整率：tasks缺2 + issues缺1 → debt=3（attribution_harness 停计，接线前不入和）', async () => {
    const pool = makePool([
      { match: 'attribution_tasks', rows: [{ total: '10', debt: '2' }] },
      { match: 'attribution_issues', rows: [{ total: '5', debt: '1' }] },
    ]);
    const m = await computeMetrics(pool);
    expect(m.m2.debt).toBe(3);
    expect(m.m2.value).toBeCloseTo(12 / 15);
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

  it('m6 evaluator 门禁覆盖率：4 个 done run，1 个无 evaluator 事件 → value=3/4, debt=1', async () => {
    const pool = makePool([
      { match: 'FROM initiative_runs r', rows: [{ total: '4', debt: '1' }] },
    ]);
    const m = await computeMetrics(pool);
    expect(m.m6.debt).toBe(1);
    expect(m.m6.value).toBeCloseTo(3 / 4);
    expect(m.m6.enabled).toBe(true);
  });

  it('m6 近7天无 done run → value=1, debt=0（真空真值）', async () => {
    const pool = makePool([
      { match: 'FROM initiative_runs r', rows: [{ total: '0', debt: '0' }] },
    ]);
    const m = await computeMetrics(pool);
    expect(m.m6.value).toBe(1);
    expect(m.m6.debt).toBe(0);
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

  it('absolute 指标 debt=1、无 prev → 首跑即击穿（断电首日就报）', () => {
    const m = { m5: { key: 'm5', name: '判定点活性', value: 0, debt: 1, enabled: true, absolute: true } };
    const { state, breaches } = evaluateRatchet(m, null, '2026-07-10');
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({ key: 'm5', prevDebt: 0, debt: 1, streak: 1 });
    expect(state.streaks.m5).toBe(1);
  });

  it('absolute 指标 debt 持平 → 仍击穿且 streak 递增', () => {
    const m = { m5: { key: 'm5', name: '判定点活性', value: 0, debt: 1, enabled: true, absolute: true } };
    const prev = { baseline: { m5: 1 }, last: { m5: 1 }, streaks: { m5: 1 }, baseline_date: '2026-07-09' };
    const { state, breaches } = evaluateRatchet(m, prev, '2026-07-10');
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({ key: 'm5', prevDebt: 1, debt: 1, streak: 2 });
    expect(state.streaks.m5).toBe(2);
  });

  it('absolute 指标 debt=0 → 不击穿，streak 清零', () => {
    const m = { m5: { key: 'm5', name: '判定点活性', value: 3, debt: 0, enabled: true, absolute: true } };
    const prev = { baseline: { m5: 1 }, last: { m5: 1 }, streaks: { m5: 2 }, baseline_date: '2026-07-09' };
    const { state, breaches } = evaluateRatchet(m, prev, '2026-07-10');
    expect(breaches).toEqual([]);
    expect(state.streaks.m5).toBe(0);
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
      { match: 'title LIKE', rows: overrides.issueDup ?? [] },
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

  it('当日已有同指标 issue → 跳过 INSERT 与 Bark（每指标每日最多一条）', async () => {
    const prev = {
      baseline: { m1: 0, m2: 0, m4: 0 },
      last: { m1: 1, m2: 0, m4: 0 },
      streaks: { m1: 2, m2: 0, m4: 0 },
      baseline_date: '2026-07-07',
    };
    const pool = makePool(
      fullRoutes({
        m1debt: '2',
        ratchet: [{ value_json: JSON.stringify(prev) }],
        issueDup: [{ '?column?': 1 }],
      })
    );
    const r = await maybeRunLedgerHygiene(pool, IN_WINDOW);
    expect(r.breaches).toBe(1);
    const issueInsert = pool.calls.find((c) => c.sql.includes('INSERT INTO issues'));
    expect(issueInsert).toBeUndefined();
    expect(sendBark).not.toHaveBeenCalled();
    expect(pool.calls.find((c) => c.sql.includes('INSERT INTO design_docs'))).toBeTruthy();
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
