/**
 * 沉淀技能（树+仓库 v3.0 第 4 刀，路 B）：技能按 Step 发 span 跑通后，读 spans + SKILL.md 起草 Activity 15 列 / Steps 8 列，
 * 登记为「候选」。机器能定的列机器写；承诺、哪些失败要人、判定点误判后果留给主理人拍板，草稿里明标「待拍板」。
 */
import { describe, it, expect } from 'vitest';
import { draftFromSpans, parseSkillMd } from '../lib/skill-settlement.js';

let t = 0;
const sp = (run, key, over = {}) => {
  const { evidence = {}, ...rest } = over;
  return {
    run_id: run, outcome: 'pass', executor_kind: 'agent', attempts: 1, started_at: new Date(Date.UTC(2026, 9, 5, 0, 0, t++)).toISOString(), ...rest,
    evidence: { step_key: key, name: `名字-${key}`, action: `做 ${key}`, reads: [], writes: [], observed: 1, ...evidence },
  };
};
const runOf = (run, over = {}) => [
  sp(run, 'open_app', { evidence: { reads: ['Device.serial'], writes: ['App.open'], ...(over.open || {}) } }),
  sp(run, 'search', { evidence: { reads: ['App.open'], writes: ['Result.list'], ...(over.search || {}) }, attempts: over.searchAttempts ?? 1 }),
  sp(run, 'save', { evidence: { reads: ['Result.list'], writes: ['Lead.row'], observed: 3, ...(over.save || {}) } }),
];

const SKILL_MD = `---
name: 抖音关键词搜索
description: 用关键词在抖音搜出最新视频并存成线索。第二句不该进承诺。
---
# 步骤
1. 打开 app
`;

describe('parseSkillMd', () => {
  it('取 frontmatter 的 name/description，承诺草稿只取第一句', () => {
    expect(parseSkillMd(SKILL_MD)).toEqual({ name: '抖音关键词搜索', description: '用关键词在抖音搜出最新视频并存成线索。第二句不该进承诺。', promise_draft: '用关键词在抖音搜出最新视频并存成线索。' });
  });
  it('没有 frontmatter：不编造，全空', () => {
    expect(parseSkillMd('# 只有正文')).toEqual({ name: null, description: null, promise_draft: null });
  });
});

describe('draftFromSpans', () => {
  const spans = [...runOf('r1'), ...runOf('r2'), ...runOf('r3')];
  const draft = draftFromSpans({ skill: parseSkillMd(SKILL_MD), spans, capabilityKey: 'leadgen', activityKey: 'keyword_search' });

  it('Step 按各次运行里的出场顺序排，进出取自 span，名字/动作取最新一次', () => {
    expect(draft.steps.map(s => s.key)).toEqual(['open_app', 'search', 'save']);
    expect(draft.steps[0]).toMatchObject({ order: 1, name: '名字-open_app', action: '做 open_app', inputs: ['Device.serial'], outputs: ['App.open'] });
    expect(draft.steps[2].order).toBe(3);
  });

  it('读回：各次观测值一致才起草 ==；不一致/不足两次留空并标待定，绝不猜', () => {
    const mixed = draftFromSpans({ skill: {}, capabilityKey: 'c', activityKey: 'a',
      spans: [...runOf('r1'), ...runOf('r2', { search: { observed: 7 } }), ...runOf('r3', { search: { observed: 9 } })] });
    expect(draft.steps.find(s => s.key === 'save').readback).toEqual({ type: 'observed', field: 'value', expect: { op: '==', value: 3 } });
    expect(mixed.steps.find(s => s.key === 'search').readback).toEqual({});
    expect(mixed.gaps).toContain('readback_undetermined:search');
    const once = draftFromSpans({ skill: {}, capabilityKey: 'c', activityKey: 'a', spans: runOf('r1') });
    expect(once.steps[0].readback).toEqual({});
  });

  it('失败处理：有重试痕迹→retry:N（N=最大尝试数-1）；失败过→abort；都没有→null', () => {
    const d = draftFromSpans({ skill: {}, capabilityKey: 'c', activityKey: 'a',
      spans: [...runOf('r1', { searchAttempts: 3 }), ...runOf('r2'), sp('r3', 'open_app', { outcome: 'fail' }), sp('r3', 'search'), sp('r3', 'save')] });
    expect(Object.fromEntries(d.steps.map(s => [s.key, s.on_fail]))).toEqual({ open_app: 'abort', search: 'retry:2', save: null });
    expect(d.activity.failure.retryable).toEqual(['search']);
    expect(d.activity.failure.fatal).toEqual(['open_app']);
  });

  it('Activity 草稿：key/name、承诺草稿、执行主体取多数、进出取首尾 Step', () => {
    expect(draft.activity).toMatchObject({ key: 'keyword_search', name: '抖音关键词搜索', executor_kind: 'agent',
      promise_draft: '用关键词在抖音搜出最新视频并存成线索。', inputs: ['Device.serial'], outputs: ['Lead.row'] });
  });

  it('三问永远待拍板；没有步骤标识的 span 被忽略并计数；没有任何带步骤的 span 直接拒绝', () => {
    expect(draft.gaps).toEqual(expect.arrayContaining(['promise_pending_owner', 'failure_needs_human_pending_owner', 'judgment_pending_owner']));
    const noisy = draftFromSpans({ skill: {}, capabilityKey: 'c', activityKey: 'a', spans: [...runOf('r1'), { run_id: 'r1', outcome: 'pass', executor_kind: 'agent', started_at: '2026-10-05T00:00:00Z', evidence: {} }] });
    expect(noisy.gaps).toContain('span_without_step_key:1');
    expect(() => draftFromSpans({ skill: {}, capabilityKey: 'c', activityKey: 'a', spans: [] })).toThrow(/no_step_spans/);
  });

  it('统计：用了几次运行、几条 span', () => {
    expect(draft.stats).toEqual({ runs: 3, spans: 9 });
  });
});
