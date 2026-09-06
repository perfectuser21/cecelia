// F1「工厂 · 开发闭环」步骤 1 —— 边：结晶判官的聚合窗口与判决时机
//
// Regression: 判官按单日聚合，minRuns=20 实质永远达不到
//
// 主理人 2026-09-06 指出并经核实的三个连锁缺陷：
//
// ① 聚合窗口错：aggregateUnitMetrics 的 WHERE 是 `unit_key=$1 AND report_date=$2`，只捞当天。
//    CRYSTAL_THRESHOLDS.minRuns=20 因此变成「单日内必须跑够 20 次」。今天跑 10 次、明天跑 10 次，
//    判官每天看到的都是 n_runs=10 —— 永远达不到 20，promote 这条路径实质是死的。
// ② 判决时机错：只在北京 05:00 窗口跑一次，且当日已有报告即跳过。当天跑够也要等次日。
// ③ demoteWindowDays=7 配了没用：它只出现在 basis 报告字段，未参与任何计算；
//    降级实际用的仍是单日 broken_count。晋升看单日、降级也看单日，7 天观察窗是摆设。
//
// 本测试锁死：**次数按滚动窗口累计，不按自然日切断**；以及单段判决可被独立触发，
// 不必等每日窗口。第一条断言是本缺陷的唯一守卫——退回 `report_date = $2` 它立刻红。
import { describe, it, expect } from 'vitest';
import {
  aggregateUnitMetrics,
  judgeUnit,
} from '../../../packages/brain/src/crystal-judge.js';
import { CRYSTAL_THRESHOLDS } from '../../../packages/brain/src/crystal/verdict-engine.js';

/** 记录所有 SQL 的假 pool；对证据查询返回给定行。 */
function poolWith(rows) {
  const seen = [];
  const pool = {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      if (/FROM crystal_run_evidence/i.test(sql)) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    },
  };
  return pool;
}

const base = {
  unit_key: 'search_account',
  funnel_cell: 'source',
  baseline_tokens: 10158,
  hot_path_tokens: 696,
  avg_ms: 24000,
  crystallized: true,
  has_postcondition: true,
  new_branch_count: 0,
  broken_count: 0,
};

describe('F1 step1 · 判官按滚动窗口聚合，不按自然日切断', () => {
  it('两天各 10 次 → n_runs 累计为 20，而不是只看当天的 10', async () => {
    const twoDays = [
      { ...base, report_date: '2026-09-05', runs: 10, passes: 10 },
      { ...base, report_date: '2026-09-06', runs: 10, passes: 10 },
    ];
    const m = await aggregateUnitMetrics(poolWith(twoDays), 'search_account', '2026-09-06');
    expect(m.n_runs).toBe(20);
    expect(m.n_runs).toBeGreaterThanOrEqual(CRYSTAL_THRESHOLDS.minRuns);
  });

  it('聚合 SQL 用日期区间，不是等值匹配当天（等值即跨天不累计）', async () => {
    const p = poolWith([{ ...base, report_date: '2026-09-06', runs: 3, passes: 3 }]);
    await aggregateUnitMetrics(p, 'search_account', '2026-09-06');
    const q = p.seen.find((s) => /FROM crystal_run_evidence/i.test(s.sql));
    expect(q).toBeDefined();
    // 必须是区间；出现 `report_date = $` 说明退回了单日切断
    expect(q.sql).not.toMatch(/report_date\s*=\s*\$/);
    expect(q.sql).toMatch(/report_date\s*(>=|>)/);
  });

  it('窗口长度与降级观察窗一致，晋升/降级不许一个看单日一个看窗口', async () => {
    const p = poolWith([{ ...base, report_date: '2026-09-06', runs: 3, passes: 3 }]);
    await aggregateUnitMetrics(p, 'search_account', '2026-09-06');
    const q = p.seen.find((s) => /FROM crystal_run_evidence/i.test(s.sql));
    expect(q.params).toContain(CRYSTAL_THRESHOLDS.demoteWindowDays);
  });

  it('broken_count 也按窗口累计（否则 7 天碎 3 次的降级判据形同虚设）', async () => {
    const broke = [
      { ...base, report_date: '2026-09-04', runs: 10, passes: 8, broken_count: 2 },
      { ...base, report_date: '2026-09-06', runs: 10, passes: 9, broken_count: 1 },
    ];
    const m = await aggregateUnitMetrics(poolWith(broke), 'search_account', '2026-09-06');
    expect(m.broken_count).toBe(3);
    expect(m.broken_count).toBeGreaterThanOrEqual(CRYSTAL_THRESHOLDS.demoteBreaks);
  });
});

describe('F1 step1 · 单段判决可独立触发，不必等每日窗口', () => {
  it('judgeUnit 已导出（证据入库后即可就地重判）', () => {
    expect(typeof judgeUnit).toBe('function');
  });

  it('judgeUnit 返回该段判决并落库台账与判决两张表', async () => {
    const rows = [{ ...base, report_date: '2026-09-06', runs: 20, passes: 20 }];
    const p = poolWith(rows);
    const r = await judgeUnit(p, 'search_account', '2026-09-06');
    expect(r.verdict).toBeDefined();
    expect(r.metrics.n_runs).toBe(20);
    const wrote = p.seen.map((s) => s.sql).join('\n');
    expect(wrote).toMatch(/INSERT INTO crystal_ledger/i);
    expect(wrote).toMatch(/INSERT INTO crystal_verdict/i);
  });

  it('跑够 20 次且各项达标时判 promote（不再被单日窗口卡死）', async () => {
    const rows = [
      { ...base, report_date: '2026-09-05', runs: 10, passes: 10 },
      { ...base, report_date: '2026-09-06', runs: 10, passes: 10 },
    ];
    const r = await judgeUnit(poolWith(rows), 'search_account', '2026-09-06');
    expect(r.verdict).toBe('promote');
  });
});
