/**
 * 收敛对账（树+仓库 v3.0 第 4 刀，路 B）：技能按 Step 发 span 跑 N 次，把 span 和 Steps.readback 对账。
 * 对得上 → 该 Step 当次「已验证」；对不上（观测值违反读回）/缺 span/出现没声明的 Step → 报出来让人改 Steps，直到稳定。
 * 连续 N 次整个 Activity 全绿 = 收敛，可以固化（蒸馏成脚本）。
 */
import { describe, it, expect } from 'vitest';
import { reconcileSteps } from '../lib/step-reconcile.js';

const steps = [
  { id: 's1', key: 'a.b.lock', readback: { type: 'metric', ref: 'metrics.lock', expect: { op: '==', value: 1 } } },
  { id: 's2', key: 'a.b.verify', readback: { type: 'metric', ref: 'metrics.ok', expect: { op: '>=', value: 1 } } },
  { id: 's3', key: 'a.b.note', readback: { type: 'none' } },
];
let t = 0;
const span = (run, step, observed, outcome = 'pass', extra = {}) => ({
  run_id: run, step_id: step, outcome, started_at: new Date(Date.UTC(2026, 9, 5, 0, 0, t++)).toISOString(),
  evidence: observed === undefined ? {} : { observed }, attempts: 1, ...extra,
});
const greenRun = run => [span(run, 's1', 1), span(run, 's2', 2), span(run, 's3', undefined)];

describe('reconcileSteps：单次运行的逐步判定', () => {
  it('观测值满足读回=已验证；type=none 的步骤豁免；整次运行全绿', () => {
    const r = reconcileSteps({ steps, spans: greenRun('r1'), runsWanted: 1, requiredGreen: 1 });
    expect(r.runs[0].steps.map(s => s.status)).toEqual(['verified', 'verified', 'exempt']);
    expect(r.runs[0].green).toBe(true);
    expect(r.verdict).toBe('converged');
  });

  it('观测值违反读回：对不上（mismatch），整次运行不绿，问题带 Step 与运行号', () => {
    const r = reconcileSteps({ steps, spans: [span('r1', 's1', 0), span('r1', 's2', 2), span('r1', 's3')], runsWanted: 1, requiredGreen: 1 });
    expect(r.runs[0].steps[0].status).toBe('mismatch');
    expect(r.runs[0].green).toBe(false);
    expect(r.issues).toContainEqual(expect.objectContaining({ code: 'step_readback_mismatch', step_key: 'a.b.lock', run_id: 'r1' }));
    expect(r.verdict).toBe('diverged');
  });

  it('span 说通过但没报观测值：未验证（对不上无从谈起），不算绿', () => {
    const r = reconcileSteps({ steps, spans: [span('r1', 's1'), span('r1', 's2', 2), span('r1', 's3')], runsWanted: 1, requiredGreen: 1 });
    expect(r.runs[0].steps[0].status).toBe('unverified');
    expect(r.runs[0].green).toBe(false);
    expect(r.issues).toContainEqual(expect.objectContaining({ code: 'step_unobserved', step_key: 'a.b.lock' }));
  });

  it('Step 自己跑失败（outcome=fail）是失败不是对不上；缺 span 报缺；跳过中性', () => {
    const r = reconcileSteps({ steps, spans: [span('r1', 's1', 1, 'fail'), span('r1', 's3', undefined, 'skipped')], runsWanted: 1, requiredGreen: 1 });
    expect(r.runs[0].steps.map(s => s.status)).toEqual(['failed', 'missing', 'skipped']);
    expect(r.issues.map(i => i.code).sort()).toEqual(['step_failed', 'step_missing']);
  });

  it('出现合同里没声明的 Step span：报 undeclared_step，整次运行不绿（技能多做了没登记的步骤）', () => {
    const r = reconcileSteps({ steps, spans: [...greenRun('r1'), span('r1', 'sX', 1)], runsWanted: 1, requiredGreen: 1 });
    expect(r.runs[0].undeclared).toEqual(['sX']);
    expect(r.runs[0].green).toBe(false);
    expect(r.issues).toContainEqual(expect.objectContaining({ code: 'undeclared_step', step_id: 'sX' }));
  });
});

describe('reconcileSteps：跨运行收敛', () => {
  it('取最近 N 次（按运行内最晚 span 排序），连续绿次数从最新往前数', () => {
    const spans = [...greenRun('r1'), ...greenRun('r2'), [span('r3', 's1', 0), span('r3', 's2', 2), span('r3', 's3')].flat(), ...greenRun('r4'), ...greenRun('r5')].flat();
    const r = reconcileSteps({ steps, spans, runsWanted: 5, requiredGreen: 3 });
    expect(r.runs.map(x => x.run_id)).toEqual(['r5', 'r4', 'r3', 'r2', 'r1']);
    expect(r.consecutive_green).toBe(2);
    expect(r.verdict).toBe('converging');
    expect(r.converged).toBe(false);
  });

  it('连续绿达到要求次数 = 收敛', () => {
    const spans = ['r1', 'r2', 'r3'].flatMap(greenRun);
    const r = reconcileSteps({ steps, spans, runsWanted: 5, requiredGreen: 3 });
    expect(r).toMatchObject({ consecutive_green: 3, converged: true, verdict: 'converged' });
  });

  it('最新一次就有问题：diverged；没有任何 Step span：no_data', () => {
    const r = reconcileSteps({ steps, spans: [...greenRun('r1'), span('r2', 's1', 0), span('r2', 's2', 2), span('r2', 's3')], runsWanted: 5, requiredGreen: 2 });
    expect(r.verdict).toBe('diverged');
    expect(r.consecutive_green).toBe(0);
    expect(reconcileSteps({ steps, spans: [], runsWanted: 5, requiredGreen: 2 })).toMatchObject({ verdict: 'no_data', converged: false, runs: [] });
  });

  it('每个 Step 汇总各状态次数，供「哪一步总对不上」一眼看出', () => {
    const spans = [...greenRun('r1'), span('r2', 's1', 0), span('r2', 's2', 2), span('r2', 's3')];
    const r = reconcileSteps({ steps, spans, runsWanted: 5, requiredGreen: 2 });
    expect(r.per_step.find(s => s.key === 'a.b.lock')).toMatchObject({ verified: 1, mismatch: 1, failed: 0, missing: 0 });
  });
});
