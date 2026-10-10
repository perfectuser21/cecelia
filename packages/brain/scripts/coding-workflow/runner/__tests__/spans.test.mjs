// runner/lib/spans.mjs：coding workflow 每个活动的执行记录上报 Brain spans（决策 b34e346a，审计 #24/#26）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { CODING_WORKFLOW_ID, ACTIVITY_IDS, chainSpans, gateSpan } from '../lib/spans.mjs';

const TASK = 'c954ebfd-469f-4006-a95f-b277fa6564f6';
const T0 = Date.parse('2026-10-10T05:00:00.000Z');

describe('ACTIVITY_IDS', () => {
  it('与迁移 541 登记的 Activity id 逐个一致（两边不许漂移）', () => {
    const sql = fs.readFileSync(new URL('../../../../migrations/541_coding_workflow_activities.sql', import.meta.url), 'utf8');
    expect(sql).toContain(`'${CODING_WORKFLOW_ID}'`);
    for (const [key, id] of Object.entries(ACTIVITY_IDS)) expect(sql).toMatch(new RegExp(`\\('${key}',\\s+'${id}'`));
    expect(Object.keys(ACTIVITY_IDS)).toEqual(['intent', 'spec', 'spec_review', 'build', 'verify', 'chain_check', 'publish', 'report', 'ci_fix', 'qa', 'judge', 'merge']);
  });
});

describe('chainSpans', () => {
  const receipt = {
    status: 'completed',
    activities: [
      { key: 'intent', status: 'completed', attempts: [{ attempt: 1, status: 'completed', metrics: {}, transport: { duration_s: 2 } }] },
      { key: 'spec', status: 'completed', attempts: [
        { attempt: 1, status: 'failed', reason_code: 'spec_invalid', metrics: { cost_usd: 0.3 }, transport: { duration_s: 60 } },
        { attempt: 2, status: 'completed', metrics: { cost_usd: 0.25 }, transport: { duration_s: 50 } },
      ] },
      { key: 'x_unknown', status: 'completed', attempts: [{ attempt: 1, status: 'completed', transport: { duration_s: 1 } }] },
      { key: 'chain_check', status: 'skipped', attempts: [] },
    ],
  };

  it('每次尝试一条 span：run_id/activity/workflow、按串行累加的起止时间、结论、花费、幂等键；不认识的活动不报', () => {
    const spans = chainSpans(receipt, { taskId: TASK, startedAt: T0 });
    expect(spans).toEqual([
      expect.objectContaining({ run_id: `coding-workflow:${TASK}`, activity_id: ACTIVITY_IDS.intent, workflow_id: CODING_WORKFLOW_ID,
        started_at: '2026-10-10T05:00:00.000Z', ended_at: '2026-10-10T05:00:02.000Z', executor_kind: 'code', outcome: 'pass', occurrence_key: 'intent:1' }),
      expect.objectContaining({ activity_id: ACTIVITY_IDS.spec, started_at: '2026-10-10T05:00:02.000Z', ended_at: '2026-10-10T05:01:02.000Z',
        executor_kind: 'agent', outcome: 'fail', cost_usd: 0.3, occurrence_key: 'spec:1', evidence: { reason_code: 'spec_invalid' } }),
      expect.objectContaining({ activity_id: ACTIVITY_IDS.spec, started_at: '2026-10-10T05:01:02.000Z', ended_at: '2026-10-10T05:01:52.000Z',
        outcome: 'pass', cost_usd: 0.25, occurrence_key: 'spec:2' }),
      expect.objectContaining({ activity_id: ACTIVITY_IDS.chain_check, outcome: 'skipped', occurrence_key: 'chain_check:0' }),
    ]);
  });

  it('回执缺失或没有活动 → []', () => {
    expect(chainSpans(null, { taskId: TASK, startedAt: T0 })).toEqual([]);
    expect(chainSpans({ activities: [] }, { taskId: TASK, startedAt: T0 })).toEqual([]);
  });
});

describe('gateSpan', () => {
  it('runner 侧环节（QA/裁判/合并/CI 修复）一条 span；结论映射 pass/fail；幂等键带 PR 与轮次', () => {
    expect(gateSpan({ taskId: TASK, key: 'qa', startedAt: T0, endedAt: T0 + 90000, ok: false, costUsd: 0.5, occurrence: '77:r1', evidence: { verdict: 'FAIL' } }))
      .toEqual({
        run_id: `coding-workflow:${TASK}`, activity_id: ACTIVITY_IDS.qa, workflow_id: CODING_WORKFLOW_ID,
        started_at: '2026-10-10T05:00:00.000Z', ended_at: '2026-10-10T05:01:30.000Z', executor_kind: 'agent', outcome: 'fail',
        cost_usd: 0.5, occurrence_key: 'qa:77:r1', evidence: { verdict: 'FAIL' },
      });
    expect(gateSpan({ taskId: TASK, key: 'merge', startedAt: T0, endedAt: T0, ok: true, occurrence: '77' })).toMatchObject({ executor_kind: 'code', outcome: 'pass' });
    expect(gateSpan({ taskId: TASK, key: 'nope', startedAt: T0, endedAt: T0, ok: true, occurrence: '1' })).toBeNull();
  });
});
