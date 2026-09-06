/**
 * coding-evidence.test.js — 编码线格子成败 → 判官口粮（判官口粮第二铲，纯函数层）
 *
 * 病灶：判官只吃 crystal_run_evidence（迁移 438），而编码线九格的真实成败从未进过这张表
 * ——og1..og8 全判 data_gap 的同时，harness_attempts 里躺着 3400+ 条 phase×status 实录。
 * 本文件锁死聚合规则：**哪些算一次跑、哪次算通过、缺的维度一律留空不臆造、幂等键怎么定**。
 */
import { describe, it, expect } from 'vitest';
import {
  CODING_TERMINAL_STATUSES,
  aggregateCodingEvidence,
} from '../coding-evidence.js';

const rec = (o) => ({ report_date: '2026-09-05', grid: 'generate', status: 'completed', duration_ms: 1000, ...o });

describe('编码线证据聚合（一格一日一行）', () => {
  it('同格同日多次尝试聚成一行，runs 为次数', () => {
    const rows = aggregateCodingEvidence([rec({}), rec({}), rec({ status: 'failed' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].unit_key).toBe('coding:generate');
    expect(rows[0].report_date).toBe('2026-09-05');
    expect(rows[0].runs).toBe(3);
    expect(rows[0].passes).toBe(2);
    expect(rows[0].broken_count).toBe(1);
  });

  it('completed_with_concerns 计入 runs 但不算通过（带关切的完成不是干净通过，宁可晋升慢）', () => {
    const rows = aggregateCodingEvidence([rec({ status: 'completed_with_concerns' }), rec({})]);
    expect(rows[0].runs).toBe(2);
    expect(rows[0].passes).toBe(1);
  });

  it('非终态与 cancelled 不入账（在途不是成败，取消不是格子的表现）', () => {
    const rows = aggregateCodingEvidence([
      rec({ status: 'running' }), rec({ status: 'queued' }), rec({ status: 'cancelled' }), rec({}),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].runs).toBe(1);
    expect(CODING_TERMINAL_STATUSES).not.toContain('cancelled');
    expect(CODING_TERMINAL_STATUSES).toContain('failed');
  });

  it('认不出格子的记录整条丢弃，绝不塞进某一格', () => {
    const rows = aggregateCodingEvidence([rec({ grid: null }), rec({ grid: '' }), rec({})]);
    expect(rows).toHaveLength(1);
    expect(rows[0].runs).toBe(1);
  });

  it('不同格 / 不同日各占一行，按 (日期, 单位) 稳定排序', () => {
    const rows = aggregateCodingEvidence([
      rec({ report_date: '2026-09-06', grid: 'publish' }),
      rec({ report_date: '2026-09-05', grid: 'plan' }),
      rec({ report_date: '2026-09-05', grid: 'generate' }),
    ]);
    expect(rows.map((r) => `${r.report_date}|${r.unit_key}`)).toEqual([
      '2026-09-05|coding:generate',
      '2026-09-05|coding:plan',
      '2026-09-06|coding:publish',
    ]);
  });
});

describe('缺的维度诚实留空（不臆造，判官宁可判 keep_llm）', () => {
  it('无 token 源 → baseline_tokens / hot_path_tokens 一律 null，不拿耗时或别的数顶替', () => {
    const [row] = aggregateCodingEvidence([rec({})]);
    expect(row.baseline_tokens).toBeNull();
    expect(row.hot_path_tokens).toBeNull();
  });

  it('无时长样本 → avg_ms 为 null 而不是 0（0ms 是假事实）', () => {
    const [row] = aggregateCodingEvidence([rec({ duration_ms: null }), rec({ duration_ms: undefined })]);
    expect(row.avg_ms).toBeNull();
  });

  it('有时长样本取均值，只按有样本的次数算', () => {
    const [row] = aggregateCodingEvidence([rec({ duration_ms: 1000 }), rec({ duration_ms: 3000 }), rec({ duration_ms: null })]);
    expect(row.avg_ms).toBe(2000);
  });

  it('新分支率无源记 0，固化标志为 false（编码九格今天全是纯 LLM）', () => {
    const [row] = aggregateCodingEvidence([rec({})]);
    expect(row.new_branch_count).toBe(0);
    expect(row.crystallized).toBe(false);
  });

  it('探针标志随格子走（INV-2：generate 有交接件契约，plan 没有）', () => {
    const [gen] = aggregateCodingEvidence([rec({ grid: 'generate' })]);
    const [plan] = aggregateCodingEvidence([rec({ grid: 'plan' })]);
    expect(gen.has_postcondition).toBe(true);
    expect(plan.has_postcondition).toBe(false);
  });
});

describe('幂等键确定性（重跑不产生重复行）', () => {
  it('verified_at 由 (格, 北京日) 唯一确定，同输入重跑逐字节相同', () => {
    const a = aggregateCodingEvidence([rec({})]);
    const b = aggregateCodingEvidence([rec({}), rec({})]);
    expect(a[0].verified_at).toBe(b[0].verified_at);
    expect(a[0].verified_at).toBe(new Date('2026-09-05T00:00:00+08:00').toISOString());
  });

  it('verified_at 落回同一北京日（与 report_date 自洽，防跨天漂移）', () => {
    const [row] = aggregateCodingEvidence([rec({ report_date: '2026-09-06' })]);
    const shifted = new Date(new Date(row.verified_at).getTime() + 8 * 3600 * 1000);
    expect(shifted.toISOString().slice(0, 10)).toBe('2026-09-06');
  });
});
