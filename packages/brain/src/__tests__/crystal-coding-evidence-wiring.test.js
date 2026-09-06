/**
 * crystal-coding-evidence-wiring.test.js — 判官口粮第二铲：编码线格子证据接线（IO + 判据）
 *
 * 病灶（2026-09-07 实测）：crystal_verdict 里 og1..og8 全是 keep_llm{"rule":"data_gap"}——
 * 判官在空账上判案。编码线九格的真实成败在 harness_attempts 里（planning/gan/generate/
 * evaluate/judge/publish 六相 3400+ 条），从没有人把它搬进 crystal_run_evidence。
 *
 * 本文件锁死两件事：
 *   ① 接线：harness_attempts（∪ home-sequencer sequencer_ledger）→ crystal_run_evidence，
 *      幂等（重跑同 (unit_key, verified_at) upsert，不长行）。
 *   ② 判据纠偏：**「成本证据缺口」不等于「全维度数据缺口」**。有真实 runs 只缺 token 时，
 *      台账必须记真实 n_runs/success_rate（而不是抹成 0/null），判决 basis 必须说清是
 *      缺成本证据（cost_evidence_missing），而不是笼统 data_gap。彻底没有证据行才是 data_gap。
 */
import { describe, it, expect } from 'vitest';
import { aggregateUnitMetrics, runCrystalJudge } from '../crystal-judge.js';
import { syncCodingEvidence } from '../crystal/coding-evidence.js';
import { CODING_GRIDS, codingUnitKey } from '../crystal/coding-grids.js';

/** 假 pool：证据查询返回给定行，其余查询记账后返回空。 */
function poolWith(evidenceRows, extra = {}) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      for (const [re, rows] of Object.entries(extra)) {
        if (new RegExp(re, 'i').test(sql)) return { rows, rowCount: rows.length };
      }
      if (/FROM crystal_run_evidence/i.test(sql)) return { rows: evidenceRows, rowCount: evidenceRows.length };
      return { rows: [], rowCount: 0 };
    },
  };
}

const codingRow = {
  unit_key: 'coding:generate',
  funnel_cell: null,
  report_date: '2026-09-05',
  runs: 30,
  passes: 24,
  baseline_tokens: null,   // 编码线无 token 源
  hot_path_tokens: null,
  avg_ms: 120000,
  crystallized: false,
  has_postcondition: true,
  new_branch_count: 0,
  broken_count: 6,
};

describe('成本证据缺口 ≠ 全维度数据缺口（判官不得把真跑过的量抹成 0）', () => {
  it('有 runs 只缺 baseline_tokens → n_runs/success_rate 保真，data_gap=false，cost_gap=true', async () => {
    const m = await aggregateUnitMetrics(poolWith([codingRow]), 'coding:generate', '2026-09-06');
    expect(m.n_runs).toBe(30);
    expect(m.success_rate).toBeCloseTo(24 / 30, 6);
    expect(m.broken_count).toBe(6);
    expect(m.latency_ms).toBe(120000);
    expect(m.data_gap).toBe(false);
    expect(m.cost_gap).toBe(true);
    expect(m.token_cost).toBe(0);
  });

  it('缺成本证据时判 keep_llm 且 basis 点名 cost_evidence_missing（不是笼统 data_gap）', async () => {
    const p = poolWith([codingRow]);
    const { judgeUnit } = await import('../crystal-judge.js');
    const r = await judgeUnit(p, 'coding:generate', '2026-09-06');
    expect(r.verdict).toBe('keep_llm');
    expect(r.basis.rule).toBe('cost_evidence_missing');
    expect(r.metrics.n_runs).toBe(30);
  });

  it('库里一行证据都没有时仍是 data_gap（件4 不误判语义原样保留）', async () => {
    const m = await aggregateUnitMetrics(poolWith([]), 'coding:cleanup', '2026-09-06');
    expect(m.data_gap).toBe(true);
    expect(m.n_runs).toBe(0);
    expect(m.success_rate).toBeNull();
  });

  it('台账 upsert 把 cost_gap 一起落库（只写 verdict 会让台账读者误以为成本真是 0）', async () => {
    const p = poolWith([codingRow]);
    const { judgeUnit } = await import('../crystal-judge.js');
    await judgeUnit(p, 'coding:generate', '2026-09-06');
    const ledger = p.seen.find((q) => /INSERT INTO crystal_ledger/i.test(q.sql));
    expect(ledger).toBeTruthy();
    expect(/cost_gap/i.test(ledger.sql)).toBe(true);
    expect(ledger.params).toContain(true); // cost_gap=true 进了参数
  });
});

describe('判决单位册页含编码九格（否则今天没跑就整条线从报告里消失）', () => {
  it('runCrystalJudge 逐格判编码九格，且键带 coding: 前缀', async () => {
    const p = poolWith([]);
    await runCrystalJudge(p, new Date('2026-09-07T00:00:00Z'));
    const judged = p.seen
      .filter((q) => /INSERT INTO crystal_verdict/i.test(q.sql))
      .map((q) => q.params[1]);
    for (const g of CODING_GRIDS) {
      expect(judged).toContain(codingUnitKey(g));
    }
    expect(judged).toContain('og1'); // 件4 第一批被告不动
  });
});

describe('接线幂等（syncCodingEvidence）', () => {
  it('把 attempts 聚合结果 upsert 进 crystal_run_evidence，冲突键 (unit_key, verified_at)', async () => {
    const attempts = [
      { report_date: '2026-09-05', grid: 'generate', status: 'completed', duration_ms: 1000 },
      { report_date: '2026-09-05', grid: 'generate', status: 'failed', duration_ms: 2000 },
    ];
    const p = poolWith([], { 'FROM harness_attempts': attempts, 'FROM sequencer_ledger': [] });
    const r = await syncCodingEvidence({ dbPool: p, days: 30, force: true, now: new Date('2026-09-07T00:00:00Z') });
    const ins = p.seen.filter((q) => /INSERT INTO crystal_run_evidence/i.test(q.sql));
    expect(ins).toHaveLength(1);
    expect(/ON CONFLICT \(unit_key, verified_at\) DO UPDATE/i.test(ins[0].sql)).toBe(true);
    expect(r.evidence_rows).toBe(1);
  });

  it('dry-run 只算不写库', async () => {
    const attempts = [{ report_date: '2026-09-05', grid: 'plan', status: 'completed', duration_ms: 10 }];
    const p = poolWith([], { 'FROM harness_attempts': attempts, 'FROM sequencer_ledger': [] });
    const r = await syncCodingEvidence({ dbPool: p, days: 30, dryRun: true, force: true, now: new Date('2026-09-07T00:00:00Z') });
    expect(p.seen.some((q) => /INSERT INTO crystal_run_evidence/i.test(q.sql))).toBe(false);
    expect(r.evidence_rows).toBe(1);
  });

  it('两代格序都吃：kernel 相与 home-sequencer 格名归到同一判决单位', async () => {
    const p = poolWith([], {
      'FROM harness_attempts': [{ report_date: '2026-09-05', grid: 'generate', status: 'completed', duration_ms: 10 }],
      'FROM sequencer_ledger': [{ report_date: '2026-09-05', grid: 'generate', status: 'completed', duration_ms: null }],
    });
    const r = await syncCodingEvidence({ dbPool: p, days: 30, force: true, now: new Date('2026-09-07T00:00:00Z') });
    expect(r.evidence_rows).toBe(1);
    const ins = p.seen.find((q) => /INSERT INTO crystal_run_evidence/i.test(q.sql));
    expect(ins.params[0]).toBe('coding:generate');
    expect(ins.params[3]).toBe(2); // runs 两代相加
  });

  it('自 gate：间隔内重复调用直接跳过，不重复扫源表', async () => {
    const p = poolWith([], { 'FROM harness_attempts': [], 'FROM sequencer_ledger': [] });
    const now = new Date('2026-09-07T10:00:00Z'); // 远离前面用例的时刻，确保首次不被上一次调用的 gate 挡住
    await syncCodingEvidence({ dbPool: p, now });
    const before = p.seen.length;
    const second = await syncCodingEvidence({ dbPool: p, now: new Date(now.getTime() + 1000) });
    expect(second.skipped).toBe(true);
    expect(p.seen.length).toBe(before);
  });
});

describe('scheduler 注册面', () => {
  it('syncCodingEvidence 已注册为 scheduler job（否则接完线也不会自己长新数）', async () => {
    const { JOBS } = await import('../scheduler-jobs.js');
    const job = JOBS.find((j) => j.name === 'crystal-coding-evidence');
    expect(job).toBeTruthy();
    expect(typeof job.handler).toBe('function');
    expect(job.needsPool).toBe(true);
  });

  it('job 排在 crystal-judge 之前（先喂饭再判案）', async () => {
    const { JOBS } = await import('../scheduler-jobs.js');
    const names = JOBS.map((j) => j.name);
    expect(names.indexOf('crystal-coding-evidence')).toBeLessThan(names.indexOf('crystal-judge'));
  });
});
