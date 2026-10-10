/**
 * 新旧版本对比裁判（五块模型·裁判，决策 de6dff5d）：同一 Activity 的候选版本 vs 基线版本，
 * 按 spans.activity_definition_version_id 分组，比成功率 / 读回 verified 比例 / 读回观测值一致性，
 * 给 not_worse / worse / insufficient_data，带数字依据。这里锁纯函数口径。
 */
import { describe, it, expect } from 'vitest';
import {
  summarizeVersionRuns, decideVersionComparison, stepsFromVersionPayload, observationShape, DEFAULT_MIN_RUNS,
} from '../activity-version-compare.js';

const S1 = 'a0000000-0000-4000-8000-000000000001';
const S2 = 'a0000000-0000-4000-8000-000000000002';
const steps = [
  { id: S1, key: 'c.a.open', readback: { type: 'metric', expect: { op: '==', value: 1 } } },
  { id: S2, key: 'c.a.save', readback: { type: 'metric', expect: { op: '>=', value: 1 } } },
];
let tick = 0;
const at = () => new Date(Date.UTC(2026, 9, 10, 0, 0, tick++)).toISOString();
const stepSpan = (run, step, observed, outcome = 'pass') => ({ run_id: run, step_id: step, enabler_id: null, outcome, evidence: observed === undefined ? {} : { observed }, started_at: at() });
const actSpan = (run, outcome) => ({ run_id: run, step_id: null, enabler_id: null, outcome, evidence: null, started_at: at() });
const greenRun = run => [stepSpan(run, S1, 1), stepSpan(run, S2, 3)];

describe('stepsFromVersionPayload', () => {
  it('取版本快照里冻结的 Step（登记身份优先，读回取登记，没有退回合同）', () => {
    const payload = { steps: [
      { step_id: S1, contract: { key: 'open', readback: { type: 'none' } }, registration: { id: S1, key: 'c.a.open', readback: { type: 'metric', expect: { op: '==', value: 1 } } } },
      { step_id: null, contract: { key: 'save', readback: { type: 'metric', expect: { op: '>=', value: 1 } } }, registration: null },
    ] };
    expect(stepsFromVersionPayload(payload)).toEqual([
      { id: S1, key: 'c.a.open', readback: { type: 'metric', expect: { op: '==', value: 1 } } },
      { id: null, key: 'save', readback: { type: 'metric', expect: { op: '>=', value: 1 } } },
    ]);
  });
  it('快照没有 steps 返回 null（调用方退回当前 Step 表）', () => {
    expect(stepsFromVersionPayload({})).toBeNull();
    expect(stepsFromVersionPayload({ steps: [] })).toBeNull();
    expect(stepsFromVersionPayload(null)).toBeNull();
  });
});

describe('observationShape', () => {
  it('只看形状不看值：数相同形状，对象按键排序，缺观测单列', () => {
    expect(observationShape(1)).toBe(observationShape(42));
    expect(observationShape({ b: 1, a: 'x' })).toBe(observationShape({ a: 'y', b: 2 }));
    expect(observationShape({ a: 1 })).not.toBe(observationShape({ a: '1' }));
    expect(observationShape(undefined)).toBe('absent');
    expect(observationShape(null)).toBe('null');
  });
});

describe('summarizeVersionRuns', () => {
  it('全绿 3 次：成功率 1、读回 verified 1、观测一致 1', () => {
    const spans = [...greenRun('r1'), ...greenRun('r2'), ...greenRun('r3')];
    const s = summarizeVersionRuns({ steps, spans });
    expect(s).toMatchObject({ runs: 3, decided_runs: 3, passed_runs: 3, failed_runs: 0, success_rate: 1 });
    expect(s.readback).toMatchObject({ verified: 6, mismatch: 0, unverified: 0, checked: 6, verified_ratio: 1 });
    expect(s.observation.consistency).toBe(1);
  });

  it('Activity 级 span 的结果优先；没有就由 Step 末次结果推（任一失败=失败）', () => {
    const spans = [
      ...greenRun('r1'), actSpan('r1', 'fail'),
      stepSpan('r2', S1, 1), stepSpan('r2', S2, undefined, 'fail'),
      stepSpan('r3', S1, 1, 'fail'), stepSpan('r3', S1, 1), stepSpan('r3', S2, 2),
    ];
    const s = summarizeVersionRuns({ steps, spans });
    expect(s).toMatchObject({ runs: 3, passed_runs: 1, failed_runs: 2, success_rate: 0.3333 });
  });

  it('读回比例只算 span 通过的 Step：对不上与无观测拉低比例，失败不重复扣', () => {
    const spans = [
      stepSpan('r1', S1, 1), stepSpan('r1', S2, 0),
      stepSpan('r2', S1, undefined), stepSpan('r2', S2, 5),
      stepSpan('r3', S1, 1), stepSpan('r3', S2, undefined, 'fail'),
    ];
    const s = summarizeVersionRuns({ steps, spans });
    expect(s.readback).toMatchObject({ verified: 3, mismatch: 1, unverified: 1, checked: 5, verified_ratio: 0.6 });
  });

  it('观测一致性 = 每个 Step 众数形状的占比再取平均', () => {
    const spans = [
      stepSpan('r1', S1, 1), stepSpan('r1', S2, 1),
      stepSpan('r2', S1, 1), stepSpan('r2', S2, { rows: 1 }),
      stepSpan('r3', S1, 1), stepSpan('r3', S2, 1),
      stepSpan('r4', S1, 1), stepSpan('r4', S2, undefined),
    ];
    const s = summarizeVersionRuns({ steps, spans });
    const save = s.observation.per_step.find(p => p.key === 'c.a.save');
    expect(save).toMatchObject({ observed_runs: 4, modal_count: 2, consistency: 0.5 });
    expect(s.observation.consistency).toBe(0.75);
  });

  it('只取最近 maxRuns 次运行', () => {
    const spans = ['r1', 'r2', 'r3', 'r4'].flatMap(greenRun);
    const s = summarizeVersionRuns({ steps, spans, maxRuns: 2 });
    expect(s.runs).toBe(2);
    expect(s.run_ids).toEqual(['r4', 'r3']);
  });

  it('没有 span：全部为 0/null，不编造', () => {
    const s = summarizeVersionRuns({ steps, spans: [] });
    expect(s).toMatchObject({ runs: 0, decided_runs: 0, success_rate: null });
    expect(s.readback.verified_ratio).toBeNull();
    expect(s.observation.consistency).toBeNull();
  });
});

const summary = (over = {}) => ({
  runs: 6, decided_runs: 6, success_rate: 1,
  readback: { verified_ratio: 1 }, observation: { consistency: 1 }, ...over,
});

describe('decideVersionComparison', () => {
  it('默认样本下限 5', () => { expect(DEFAULT_MIN_RUNS).toBe(5); });

  it('任一边样本不够 → insufficient_data，指标照算，理由写明数字', () => {
    const d = decideVersionComparison({ candidate: summary({ runs: 3, decided_runs: 3 }), baseline: summary() });
    expect(d.verdict).toBe('insufficient_data');
    expect(d.sample).toEqual({ candidate_runs: 3, baseline_runs: 6, min_runs: 5 });
    expect(d.reasons.join('\n')).toMatch(/候选.*3.*5/);
    expect(d.metrics.success_rate).toMatchObject({ candidate: 1, baseline: 1, delta: 0 });
  });

  it('成功率不可算（全是跳过/未知）→ insufficient_data', () => {
    const d = decideVersionComparison({ candidate: summary({ decided_runs: 0, success_rate: null }), baseline: summary() });
    expect(d.verdict).toBe('insufficient_data');
  });

  it('三项都不低于基线 → not_worse', () => {
    const d = decideVersionComparison({
      candidate: summary({ success_rate: 0.9, readback: { verified_ratio: 0.95 }, observation: { consistency: 1 } }),
      baseline: summary({ success_rate: 0.8, readback: { verified_ratio: 0.95 }, observation: { consistency: 0.9 } }),
    });
    expect(d.verdict).toBe('not_worse');
    expect(d.metrics.success_rate).toMatchObject({ candidate: 0.9, baseline: 0.8, delta: 0.1, worse: false });
  });

  it('任一项低于基线（超容差）→ worse，理由点名哪项低多少', () => {
    const d = decideVersionComparison({
      candidate: summary({ readback: { verified_ratio: 0.7 } }),
      baseline: summary({ readback: { verified_ratio: 0.9 } }),
    });
    expect(d.verdict).toBe('worse');
    expect(d.metrics.readback_verified_ratio).toMatchObject({ delta: -0.2, worse: true });
    expect(d.reasons.join('\n')).toMatch(/readback_verified_ratio/);
  });

  it('容差内的小幅下降不算更差', () => {
    const d = decideVersionComparison({
      candidate: summary({ success_rate: 0.95 }), baseline: summary({ success_rate: 1 }), tolerance: 0.05,
    });
    expect(d.verdict).toBe('not_worse');
  });

  it('读回指标一边不可算 → 该项标不可比，不参与判更差', () => {
    const d = decideVersionComparison({
      candidate: summary({ readback: { verified_ratio: null } }), baseline: summary(),
    });
    expect(d.metrics.readback_verified_ratio).toMatchObject({ comparable: false, worse: null });
    expect(d.verdict).toBe('not_worse');
  });

  it('自定义样本下限', () => {
    const d = decideVersionComparison({ candidate: summary({ runs: 3 }), baseline: summary({ runs: 3 }), minRuns: 3 });
    expect(d.verdict).toBe('not_worse');
  });
});
