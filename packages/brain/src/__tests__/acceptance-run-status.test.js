import { describe, it, expect } from 'vitest';
import { computeRunStatus, RUN_STATUSES, ACTIVE_RUN_STATUSES } from '../acceptance-state.js';

describe('computeRunStatus — 7 值状态机（只看人列填写进度）', () => {
  it('人列一格未填 → pending', () => {
    expect(computeRunStatus('pending', { total: 36, humanFilled: 0 })).toBe('pending');
  });

  it('人列填了一部分 → in_review', () => {
    expect(computeRunStatus('pending', { total: 36, humanFilled: 12 })).toBe('in_review');
  });

  it('A10⑤-a 人列填满且含「不通过」→ human_complete，绝不能是 failed', () => {
    // humanFilled 只数「非 NULL」，与取值无关：这正是旧三元式判错的地方
    expect(computeRunStatus('in_review', { total: 36, humanFilled: 36 })).toBe('human_complete');
  });

  it('A10⑤-b 人列全通过 → 同样是 human_complete，不是 passed', () => {
    expect(computeRunStatus('in_review', { total: 36, humanFilled: 36 })).toBe('human_complete');
  });

  it('非活跃前态不被提交路径改回去', () => {
    for (const prev of ['human_complete', 'adjudicated', 'stale', 'expired', 'abandoned']) {
      expect(computeRunStatus(prev, { total: 36, humanFilled: 36 })).toBe(prev);
      expect(computeRunStatus(prev, { total: 36, humanFilled: 0 })).toBe(prev);
    }
  });

  it('computeRunStatus 在任何输入下都不产生 passed/failed（历史兼容值只读）', () => {
    for (let filled = 0; filled <= 36; filled++) {
      for (const prev of ACTIVE_RUN_STATUSES) {
        expect(['passed', 'failed']).not.toContain(computeRunStatus(prev, { total: 36, humanFilled: filled }));
      }
    }
  });

  it('历史兼容值 passed/failed 原样保留，不被提交路径改写', () => {
    for (const prev of ['passed', 'failed']) {
      expect(computeRunStatus(prev, { total: 36, humanFilled: 36 })).toBe(prev);
    }
  });

  it('前态缺失/不可识别时按填写进度重算，绝不返回非状态值', () => {
    // run 行被并发删掉、或库里躺着某个没人认识的历史值时，旧三元式至少还能产出合法状态；
    // 原样透传会把 undefined 写进 NOT NULL 的 status 列，整笔提交连带已落库的 check 一起炸
    for (const prev of [undefined, null, '', 'totally_unknown']) {
      expect(computeRunStatus(prev, { total: 3, humanFilled: 0 })).toBe('pending');
      expect(computeRunStatus(prev, { total: 3, humanFilled: 1 })).toBe('in_review');
      expect(computeRunStatus(prev, { total: 3, humanFilled: 3 })).toBe('human_complete');
    }
  });

  it('RUN_STATUSES 恰为 7 个活跃/终态值，passed/failed 不在其中', () => {
    expect(RUN_STATUSES).toEqual([
      'pending', 'in_review', 'human_complete', 'adjudicated', 'stale', 'expired', 'abandoned',
    ]);
    expect(ACTIVE_RUN_STATUSES).toEqual(['pending', 'in_review']);
  });
});
