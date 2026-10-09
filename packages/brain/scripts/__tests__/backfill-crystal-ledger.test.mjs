// 回归守卫：判官口粮回填（近 30 天 run 数据 → crystal_ledger）
//
// 现场（2026-09-07 实测）：crystal_ledger 仅 10 行，og1..og8 全部 n_runs=0/data_gap=true，
// crystal_verdict 8 条全是 keep_llm{"rule":"data_gap"}——判官在空账上判案。
// 与此同时 ops_runs 躺着 4505 行 n8n 实录（AwrSocialLeadgenV4 155/193≈80%、
// AwrCodingHarnessV4 56/63≈89%）、tasks 躺着 59 条 dev 终态，无人搬运。
//
// 本测试锁死的不变量：
//   ① 聚合是源数据的确定性函数（同样输入 → 同样行，重跑不新增 → 幂等前提）
//   ② 有 run 的日子必须出 n_runs>0 的行（防回填退化成又一张空账）
//   ③ 无成本证据时 token_cost=0 且 data_gap=true（诚实标注，不编造 token）
//   ④ 无 run 的日子不写行（不造 0 行）
import { describe, it, expect } from 'vitest';
import {
  aggregateLedgerRows,
  gridKeyForTask,
  BACKFILL_DEFAULT_DAYS,
} from '../backfill-crystal-ledger.mjs';

const run = (o) => ({ report_date: '2026-09-01', grid_key: 'n8n:X', success: true, duration_ms: null, ...o });

describe('aggregateLedgerRows', () => {
  it('按 (report_date, grid_key) 聚合出 n_runs / success_rate / broken_count', () => {
    const rows = aggregateLedgerRows([
      run({ success: true }),
      run({ success: true }),
      run({ success: false }),
      run({ report_date: '2026-09-02', success: true }),
    ]);
    expect(rows).toHaveLength(2);
    const d1 = rows.find((r) => r.report_date === '2026-09-01');
    expect(d1.grid_key).toBe('n8n:X');
    expect(d1.n_runs).toBe(3);
    expect(d1.success_rate).toBeCloseTo(2 / 3, 10);
    expect(d1.broken_count).toBe(1);
  });

  it('无成本证据 → token_cost=0 且 data_gap=true（诚实标注，不编造 token）', () => {
    const [r] = aggregateLedgerRows([run({})]);
    expect(r.token_cost).toBe(0);
    expect(r.data_gap).toBe(true);
    expect(r.new_branch_rate).toBe(0);
  });

  it('有时长样本取均值；全无样本时 latency_ms 为 null（不填 0）', () => {
    const [withMs] = aggregateLedgerRows([
      run({ duration_ms: 1000 }),
      run({ duration_ms: 3000 }),
      run({ duration_ms: null }),
    ]);
    expect(withMs.latency_ms).toBe(2000);

    const [noMs] = aggregateLedgerRows([run({ duration_ms: null })]);
    expect(noMs.latency_ms).toBeNull();
  });

  it('不同 grid_key 同日互不混淆', () => {
    const rows = aggregateLedgerRows([
      run({ grid_key: 'n8n:A', success: true }),
      run({ grid_key: 'task:dev', success: false }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.grid_key === 'n8n:A').success_rate).toBe(1);
    expect(rows.find((r) => r.grid_key === 'task:dev').success_rate).toBe(0);
  });

  it('无 run 的日子不写行（空输入 → 空数组，不造 0 行）', () => {
    expect(aggregateLedgerRows([])).toEqual([]);
  });

  it('确定性：同样输入两次得到完全一致的行（幂等前提）', () => {
    const input = [run({ duration_ms: 500 }), run({ grid_key: 'task:dev', success: false })];
    expect(aggregateLedgerRows(input)).toEqual(aggregateLedgerRows(input));
  });

  it('缺 report_date 或 grid_key 的脏行被跳过，不污染账本', () => {
    const rows = aggregateLedgerRows([run({ report_date: null }), run({ grid_key: '' }), run({})]);
    expect(rows).toHaveLength(1);
    expect(rows[0].n_runs).toBe(1);
  });

  it('输出按 (report_date, grid_key) 稳定排序', () => {
    const rows = aggregateLedgerRows([
      run({ report_date: '2026-09-02', grid_key: 'n8n:B' }),
      run({ report_date: '2026-09-01', grid_key: 'n8n:B' }),
      run({ report_date: '2026-09-01', grid_key: 'n8n:A' }),
    ]);
    expect(rows.map((r) => `${r.report_date}|${r.grid_key}`)).toEqual([
      '2026-09-01|n8n:A',
      '2026-09-01|n8n:B',
      '2026-09-02|n8n:B',
    ]);
  });
});

describe('gridKeyForTask', () => {
  it('dev 任务 → task:dev', () => {
    expect(gridKeyForTask({ task_type: 'dev', pipeline: null })).toBe('task:dev');
  });

  it('payload.pipeline=canvas → task:canvas（优先于 task_type）', () => {
    expect(gridKeyForTask({ task_type: 'dev', pipeline: 'canvas' })).toBe('task:canvas');
  });

  it('两条规则都不命中 → null（不入账）', () => {
    expect(gridKeyForTask({ task_type: 'research', pipeline: null })).toBeNull();
  });

  it('grid_key 带前缀，绝不与判官自管单位（og1..og8 / 段名）撞键', () => {
    for (const gk of [gridKeyForTask({ task_type: 'dev' }), gridKeyForTask({ pipeline: 'canvas' })]) {
      expect(gk).toMatch(/^task:/);
      expect(['og1', 'og2', 'og3', 'og4', 'og5', 'og6', 'og7', 'og8', 'search_account']).not.toContain(gk);
    }
  });
});

describe('BACKFILL_DEFAULT_DAYS', () => {
  it('默认回填窗口为 30 天', () => {
    expect(BACKFILL_DEFAULT_DAYS).toBe(30);
  });
});
