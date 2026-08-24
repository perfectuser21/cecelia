/**
 * GP-Anchor: factory/F1 造完真验 #step3
 * 被改边：orchestrator_decision_log 行序列 -> resolveValidationClock 原点选择。
 * 真 import 被改模块，不 mock resolver、decision log 排序或时钟计算。
 */
import { describe, expect, it } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT_SECONDS = 5400;
const generator = {
  hop: 10,
  action: 'spawn:generator',
  created_at: '2026-08-23T00:00:00.000Z',
};

function fix(hop, hour) {
  return {
    hop,
    action: 'spawn:generator-fix',
    created_at: `2026-08-23T${String(hour).padStart(2, '0')}:00:00.000Z`,
  };
}

function launched(hop, dispatchHop) {
  return {
    hop,
    action: 'effect:attempt_launched',
    detail: {
      dispatch_hop: dispatchHop,
      dispatch_action: 'spawn:generator-fix',
      attempt_id: `attempt-${dispatchHop}`,
    },
  };
}

function successfulFix(hop, hour) {
  return [fix(hop, hour), launched(hop + 1, hop)];
}

function resolve(decisionLog) {
  return resolveValidationClock({
    action: 'spawn:evaluator',
    decisionLog,
    intentAt: '2026-08-23T20:00:00.000Z',
    timeoutSeconds: TIMEOUT_SECONDS,
  });
}

describe('F1 step3 validation clock 按 fix 轮有界顺延', () => {
  it('r50 类场景由最新成功 fix 重置时钟', () => {
    expect(resolve([
      generator,
      ...successfulFix(20, 1),
      ...successfulFix(30, 2),
      ...successfulFix(40, 3),
    ])).toEqual({
      pipeline_started_at: '2026-08-23T03:00:00.000Z',
      deadline_at: '2026-08-23T04:30:00.000Z',
    });
  });

  it('第七次成功 fix 不再顺延', () => {
    const fixes = Array.from(
      { length: 7 },
      (_, index) => successfulFix(20 + index * 2, index + 1),
    ).flat();
    expect(resolve([generator, ...fixes])).toEqual({
      pipeline_started_at: '2026-08-23T06:00:00.000Z',
      deadline_at: '2026-08-23T07:30:00.000Z',
    });
  });

  it('零次 fix 保持 generator 原点语义', () => {
    expect(resolve([generator])).toEqual({
      pipeline_started_at: '2026-08-23T00:00:00.000Z',
      deadline_at: '2026-08-23T01:30:00.000Z',
    });
  });

  it('没有 attempt_launched 成功回执的 fix 不顺延', () => {
    expect(resolve([
      generator,
      ...successfulFix(20, 1),
      fix(30, 2),
    ])).toEqual({
      pipeline_started_at: '2026-08-23T01:00:00.000Z',
      deadline_at: '2026-08-23T02:30:00.000Z',
    });
  });

  it('乱序输入按 hop 重放得到同一时钟', () => {
    const rows = [generator, ...successfulFix(20, 1), ...successfulFix(30, 2)];
    expect(resolve([...rows].reverse())).toEqual(resolve(rows));
  });

  it('同 hop 重复 fix 行只消耗一次顺延额度', () => {
    const fixes = Array.from(
      { length: 6 },
      (_, index) => successfulFix(20 + index * 2, index + 1),
    ).flat();
    const duplicate = { ...fixes[0] };
    expect(resolve([generator, duplicate, ...fixes])).toEqual({
      pipeline_started_at: '2026-08-23T06:00:00.000Z',
      deadline_at: '2026-08-23T07:30:00.000Z',
    });
  });
});
