import { describe, it, expect } from 'vitest';
import { buildEvalRecord } from '../ops-collector.js';

describe('buildEvalRecord — eval 分数入库通道（刀8-B 框架）', () => {
  it('对照式评测：算出提升幅度', () => {
    const r = buildEvalRecord({ skill: 'x', withSkill: 15, withoutSkill: 6, total: 16, suite: 'douyin-v1' });
    expect(r.eval_score).toBe(94);        // 15/16
    expect(r.eval_baseline).toBe(38);     // 6/16
    expect(r.lift).toBe(56);              // 提升幅度=94-38
    expect(r.eval_raw).toContain('15/16');
    expect(r.eval_raw).toContain('douyin-v1');
  });

  it('单臂评测（无对照）：baseline 与 lift 为 null，禁编造', () => {
    const r = buildEvalRecord({ skill: 'x', withSkill: 27, total: 27, suite: 's' });
    expect(r.eval_score).toBe(100);
    expect(r.eval_baseline).toBeNull();
    expect(r.lift).toBeNull();
  });

  it('缺 total 或非法输入 → 抛错（不接受说不清的分数入库）', () => {
    expect(() => buildEvalRecord({ skill: 'x', withSkill: 5 })).toThrow(/total/);
    expect(() => buildEvalRecord({ withSkill: 5, total: 10 })).toThrow(/skill/);
    expect(() => buildEvalRecord({ skill: 'x', withSkill: 11, total: 10 })).toThrow(/超过/);
  });

  it('记录评测集标识与时间——将来要能追"这分是哪套题考的"', () => {
    const r = buildEvalRecord({ skill: 'x', withSkill: 1, total: 1, suite: 'suite-A', note: '首轮' });
    expect(r.suite).toBe('suite-A');
    expect(r.change_note).toContain('suite-A');
    expect(r.change_note).toContain('首轮');
  });
});
