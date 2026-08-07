import { describe, it, expect } from 'vitest';
import { computeCellState } from '../acceptance-state.js';

/** 默认是一个合法可人判的普通格（S12-c1 那种） */
const base = { verifiable_by: 'human_only', scenario_class: null, adjudication: null };
const st = (o) => computeCellState({ ...base, ...o }).final_state;

describe('A5 九组合矩阵', () => {
  it('Q1 双绿 → 绿', () => {
    expect(st({ result: '通过', ai_verdict: '通过' })).toBe('绿');
  });

  it('Q2 人绿 AI 红 → 未定', () => {
    expect(st({ result: '通过', ai_verdict: '不通过' })).toBe('未定');
  });

  it('Q3 合法无法验证（human_only 格）+ 人列通过 → 绿', () => {
    expect(st({ result: '通过', ai_verdict: '无法验证', verifiable_by: 'human_only' })).toBe('绿');
  });

  it('Q3′ 故障无法验证（machine_db 格）+ 人列通过 → 未定', () => {
    expect(st({ result: '通过', ai_verdict: '无法验证', verifiable_by: 'machine_db' })).toBe('未定');
  });

  it('Q4 人红 AI 绿 → 未定', () => {
    expect(st({ result: '不通过', ai_verdict: '通过' })).toBe('未定');
  });

  it('Q5 双红 → 红', () => {
    expect(st({ result: '不通过', ai_verdict: '不通过' })).toBe('红');
  });

  it('Q6 人红 + AI 无法验证 → 红（人红独判）', () => {
    expect(st({ result: '不通过', ai_verdict: '无法验证' })).toBe('红');
    expect(st({ result: '不通过', ai_verdict: '无法验证', verifiable_by: 'machine_db' })).toBe('红');
  });

  it('Q7 人无法验证 + AI 通过 → 未定', () => {
    expect(st({ result: '无法验证', ai_verdict: '通过' })).toBe('未定');
  });

  it('Q8 人无法验证 + AI 不通过 → 红', () => {
    expect(st({ result: '无法验证', ai_verdict: '不通过' })).toBe('红');
  });

  it('Q9 双盲 → 未定', () => {
    expect(st({ result: '无法验证', ai_verdict: '无法验证' })).toBe('未定');
  });

  it('Q0 人列未填 + AI 有结论 → 未定', () => {
    expect(st({ result: null, ai_verdict: '通过' })).toBe('未定');
  });
});

describe('Q0′ AI 缺格恒判未定（优先级最高，读人列之前就短路）', () => {
  for (const result of ['通过', '不通过', '无法验证']) {
    it(`人列「${result}」+ AI 列 NULL → 未定`, () => {
      expect(st({ result, ai_verdict: null })).toBe('未定');
    });
  }
});

describe('unverifiable_this_version（本版 = S13-c4）绿只能来自裁决', () => {
  const cell = { verifiable_by: 'human_only', scenario_class: 'unverifiable_this_version' };

  it('A17⑤ 无裁决时双绿也不判绿', () => {
    expect(st({ ...cell, result: '通过', ai_verdict: '通过' })).toBe('未定');
  });

  it('A17⑤ 无裁决时不走 Q3 绿通道', () => {
    expect(st({ ...cell, result: '通过', ai_verdict: '无法验证' })).toBe('未定');
  });

  it('红判定不受影响（双红仍是红）', () => {
    expect(st({ ...cell, result: '不通过', ai_verdict: '不通过' })).toBe('红');
  });

  it('A17⑤ 有裁决 verdict=绿 且 by/reason/at 齐全 → 绿', () => {
    expect(st({
      ...cell, result: '无法验证', ai_verdict: null,
      adjudication: { verdict: '绿', by: 'alex', reason: '频控红线本版不自动验，人判放行', at: '2026-08-07T10:00:00Z' },
    })).toBe('绿');
  });

  it('裁决字段不全（缺 reason）不生效', () => {
    expect(st({
      ...cell, result: '通过', ai_verdict: '通过',
      adjudication: { verdict: '绿', by: 'alex', at: '2026-08-07T10:00:00Z' },
    })).toBe('未定');
  });
});

describe('A17④ Q3 合法通道没被 fail-closed 误伤', () => {
  it('S12-c1（human_only，恒需安卓真机）AI reason=human_only 无法验证 + 人列通过 → 绿', () => {
    expect(computeCellState({
      result: '通过', ai_verdict: '无法验证', adjudication: null,
      verifiable_by: 'human_only', scenario_class: null,
    }).final_state).toBe('绿');
  });
});

describe('裁决判红也生效', () => {
  it('adjudication.verdict=红 → 红', () => {
    expect(st({
      result: '通过', ai_verdict: '通过',
      adjudication: { verdict: '红', by: 'alex', reason: '证据不足', at: '2026-08-07T10:00:00Z' },
    })).toBe('红');
  });
});
