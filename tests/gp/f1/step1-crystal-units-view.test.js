// F1「工厂 · 开发闭环」步骤 1 —— 边：判官对外的全景视图
//
// Regression: 已固化的段第二天没跑，就从报告里凭空消失
//
// 现场（2026-09-07 05:31 实测）：crystal_verdict 里 search_account 判 promote 归属 09-06，
// search_account_v4 判 promote 归属 09-07。GET /crystal/report 默认只取最近一日，
// 于是 09-07 的报告里只有 v4，昨天刚晋升的 search_account 不见了。
//
// 根因：判官每轮的判决单位 = 漏斗八格 ∪「当日有证据的段」。一个已晋升的段第二天
// 没跑就不在 judgedUnits 里，当日报告自然没有它。聚合层已改 7 天滚动窗口，
// 但报告层仍按 report_date 单日切——两层语义不一致。
//
// 后果：「现在有多少段已固化、覆盖率多少」这张表立不起来——报告只回答
// 「某一天判了谁」，不回答「现在所有段各是什么状态」。
//
// 本测试锁死：**当日无证据的已判决段，必须仍出现在 units 视图里**，且状态保持
// 到被推翻为止；同时判决带时效标记——长期不跑的 promote 不该被当成此刻仍然可信，
// 这与「碎了自动退回」是同一条精神的另一面。
import { describe, it, expect } from 'vitest';
import { buildUnitsView } from '../../../packages/brain/src/crystal-judge.js';
import { CRYSTAL_THRESHOLDS } from '../../../packages/brain/src/crystal/verdict-engine.js';

/** 假 pool：对 crystal_verdict 的查询返回给定行 */
function poolWith(rows) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      if (/FROM crystal_verdict/i.test(sql)) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    },
  };
}

const NOW = new Date('2026-09-07T12:00:00Z');

// 昨天判的 promote（今天没跑）＋今天判的 promote
const rows = [
  {
    grid_key: 'search_account', funnel_cell: 'source',
    report_date: '2026-09-06', verdict: 'promote',
    basis: { rule: 'promote_all_conditions_met' },
    n_runs: 20, success_rate: '1', token_cost: '10158', latency_ms: '25632', broken_count: 0, data_gap: false,
  },
  {
    grid_key: 'search_account_v4', funnel_cell: 'source',
    report_date: '2026-09-07', verdict: 'promote',
    basis: { rule: 'promote_all_conditions_met' },
    n_runs: 20, success_rate: '0.95', token_cost: '10158', latency_ms: '32052', broken_count: 1, data_gap: false,
  },
  {
    grid_key: 'og1', funnel_cell: null,
    report_date: '2026-09-07', verdict: 'keep_llm',
    basis: { rule: 'data_gap' },
    n_runs: 0, success_rate: null, token_cost: '0', latency_ms: null, broken_count: 0, data_gap: true,
  },
];

describe('F1 step1 · 判官全景视图按段取最新判决', () => {
  it('当日没跑的已判决段仍然出现（本缺口的守卫）', async () => {
    const v = await buildUnitsView(poolWith(rows), NOW);
    const keys = v.units.map((u) => u.unit_key);
    expect(keys).toContain('search_account');       // 判决在 09-06，今天没跑
    expect(keys).toContain('search_account_v4');
    expect(v.units).toHaveLength(3);
  });

  it('查询按段取最新一条，不是按某一天筛', async () => {
    const p = poolWith(rows);
    await buildUnitsView(p, NOW);
    const q = p.seen.find((s) => /FROM crystal_verdict/i.test(s.sql));
    expect(q).toBeDefined();
    expect(q.sql).toMatch(/DISTINCT ON/i);
    // 出现按单日等值筛选即退回旧行为
    expect(q.sql).not.toMatch(/report_date\s*=\s*\$/);
  });

  it('带判决时效：verdict_age_days 由判决日与当前日算出', async () => {
    const v = await buildUnitsView(poolWith(rows), NOW);
    const a = v.units.find((u) => u.unit_key === 'search_account');
    const b = v.units.find((u) => u.unit_key === 'search_account_v4');
    expect(a.verdict_age_days).toBe(1);
    expect(b.verdict_age_days).toBe(0);
  });

  it('超过 demoteWindowDays 无新判决标 stale（阈值取配置，不写死）', async () => {
    const old = [{ ...rows[0], report_date: '2026-08-01' }];
    const v = await buildUnitsView(poolWith(old), NOW);
    expect(v.units[0].stale).toBe(true);
    expect(v.units[0].verdict_age_days).toBeGreaterThan(CRYSTAL_THRESHOLDS.demoteWindowDays);

    const fresh = await buildUnitsView(poolWith([rows[0]]), NOW);
    expect(fresh.units[0].stale).toBe(false);
  });

  it('summary 汇总各判决计数与 stale 数，直接支撑覆盖率视图', async () => {
    const v = await buildUnitsView(poolWith(rows), NOW);
    expect(v.summary.promote).toBe(2);
    expect(v.summary.keep_llm).toBe(1);
    expect(v.summary.demote).toBe(0);
    expect(v.summary.total).toBe(3);
    expect(v.summary.stale).toBe(0);
  });

  it('六项指标原样带出，数值列转成数字不留字符串', async () => {
    const v = await buildUnitsView(poolWith(rows), NOW);
    const a = v.units.find((u) => u.unit_key === 'search_account');
    expect(a.metrics.n_runs).toBe(20);
    expect(a.metrics.success_rate).toBe(1);
    expect(a.metrics.token_cost).toBe(10158);
    expect(a.funnel_cell).toBe('source');
  });
});
