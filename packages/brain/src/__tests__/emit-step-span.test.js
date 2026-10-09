/**
 * 技能按 Step 发 span 的客户端（树+仓库 v3.0 第 4 刀，路 B）：把「这一步做了什么、看到了什么」打成 Brain 认的 span。
 * 约定：evidence = { step_key, name?, action?, reads?, writes?, observed?, field? }，经 POST /api/brain/spans 上报。
 */
import { describe, it, expect } from 'vitest';
import { buildStepSpan, parseArgs } from '../../scripts/emit-step-span.mjs';

describe('parseArgs', () => {
  it('位置参数 run / activity / step / outcome，选项带值', () => {
    expect(parseArgs(['r1', 'act-id', 'open_app', 'pass', '--observed', '3', '--name', '打开', '--reads', 'A.x,B.y', '--attempts', '2']))
      .toEqual({ run: 'r1', activity: 'act-id', step: 'open_app', outcome: 'pass', observed: '3', name: '打开', reads: 'A.x,B.y', attempts: '2' });
  });
  it('缺位置参数 → 抛错', () => {
    expect(() => parseArgs(['r1', 'act-id'])).toThrow(/用法/);
  });
});

describe('buildStepSpan', () => {
  const now = () => new Date('2026-10-05T10:00:00.000Z');
  it('把参数打成 span：evidence 带 step_key / 名字 / 动作 / 进出 / 观测值（JSON 优先，否则原文）', () => {
    const span = buildStepSpan({ run: 'r1', activity: 'a1', step: 'search', outcome: 'pass', observed: '{"rows":3}', name: '搜', action: '点搜索', reads: 'A.x, B.y', writes: 'C.z', field: 'rows' }, now);
    expect(span).toMatchObject({
      run_id: 'r1', activity_id: 'a1', outcome: 'pass', executor_kind: 'agent', attempts: 1, started_at: '2026-10-05T10:00:00.000Z',
      evidence: { step_key: 'search', name: '搜', action: '点搜索', reads: ['A.x', 'B.y'], writes: ['C.z'], observed: { rows: 3 }, field: 'rows' },
    });
    expect(buildStepSpan({ run: 'r1', activity: 'a1', step: 's', outcome: 'pass', observed: 'ok' }, now).evidence.observed).toBe('ok');
    expect(buildStepSpan({ run: 'r1', activity: 'a1', step: 's', outcome: 'pass', observed: '3' }, now).evidence.observed).toBe(3);
  });
  it('没传的不编造：没有 observed 就没有这个键；尝试次数/执行主体可改', () => {
    const span = buildStepSpan({ run: 'r1', activity: 'a1', step: 's', outcome: 'fail', attempts: '3', executor: 'code' }, now);
    expect(span.evidence).toEqual({ step_key: 's' });
    expect(span).toMatchObject({ attempts: 3, executor_kind: 'code', outcome: 'fail' });
  });
  it('outcome 不在 pass/fail/skipped/unknown → 抛错；Step 键不合规 → 抛错', () => {
    expect(() => buildStepSpan({ run: 'r', activity: 'a', step: 's', outcome: 'ok' }, now)).toThrow(/outcome/);
    expect(() => buildStepSpan({ run: 'r', activity: 'a', step: 'Bad Key', outcome: 'pass' }, now)).toThrow(/step/);
  });
});
