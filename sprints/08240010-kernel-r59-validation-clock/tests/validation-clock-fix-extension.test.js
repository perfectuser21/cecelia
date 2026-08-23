import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const timeoutSeconds = 5400;
const generatorAt = '2026-08-20T00:00:00.000Z';

function row(hop, action, createdAt) {
  return { hop, action, created_at: createdAt, detail: { reason: 'dispatched' } };
}

function successfulFix(hop, createdAt) {
  return [
    row(hop, 'spawn:generator-fix', createdAt),
    {
      hop: hop + 1,
      action: 'effect:attempt_launched',
      created_at: createdAt,
      detail: { dispatch_hop: hop, dispatch_action: 'spawn:generator-fix' },
    },
  ];
}

function resolve(decisionLog) {
  return resolveValidationClock({
    action: 'spawn:evaluator',
    decisionLog,
    intentAt: '2026-08-20T03:00:00.000Z',
    timeoutSeconds,
  });
}

describe('F1 validation clock 按 generator-fix 轮有界顺延', () => {
  it('r50 型长跑在第 1 次 fix 新期限内保持存活', () => {
    const clock = resolve([
      row(10, 'spawn:generator', generatorAt),
      ...successfulFix(30, '2026-08-20T01:20:00.000Z'),
    ]);

    expect(clock).toEqual({
      pipeline_started_at: '2026-08-20T01:20:00.000Z',
      deadline_at: '2026-08-20T02:50:00.000Z',
    });
    expect(new Date('2026-08-20T02:00:00.000Z') < new Date(clock.deadline_at)).toBe(true);
  });

  it('乱序输入仍按 hop 重放并选第 6 次 fix 为新原点', () => {
    const fixes = Array.from({ length: 6 }, (_, index) => successfulFix(
      20 + index * 2,
      `2026-08-20T0${index + 1}:00:00.000Z`,
    )).flat();

    expect(resolve([...fixes.slice(-2), row(10, 'spawn:generator', generatorAt), ...fixes.slice(0, -2)]))
      .toEqual({
        pipeline_started_at: '2026-08-20T06:00:00.000Z',
        deadline_at: '2026-08-20T07:30:00.000Z',
      });
  });

  it('第 7 次及以后 fix 不再顺延并沿用第 6 次期限', () => {
    const fixes = Array.from({ length: 8 }, (_, index) => successfulFix(
      20 + index * 2,
      `2026-08-20T${String(index + 1).padStart(2, '0')}:00:00.000Z`,
    )).flat();

    expect(resolve([row(10, 'spawn:generator', generatorAt), ...fixes])).toEqual({
      pipeline_started_at: '2026-08-20T06:00:00.000Z',
      deadline_at: '2026-08-20T07:30:00.000Z',
    });
  });

  it('无 fix 轮时保持首次 generator 原点语义', () => {
    expect(resolve([row(10, 'spawn:generator', generatorAt)])).toEqual({
      pipeline_started_at: generatorAt,
      deadline_at: '2026-08-20T01:30:00.000Z',
    });
  });

  it('非成功 fix 派发没有 launched effect 时不得顺延', () => {
    const clock = resolve([
      row(10, 'spawn:generator', generatorAt),
      row(30, 'spawn:generator-fix', '2026-08-20T01:20:00.000Z'),
      {
        hop: 31,
        action: 'result:dispatch',
        created_at: '2026-08-20T01:20:01.000Z',
        detail: {
          dispatch_hop: 30,
          dispatch_action: 'spawn:generator-fix',
          status: 'BLOCKED',
        },
      },
    ]);

    expect(clock).toEqual({
      pipeline_started_at: generatorAt,
      deadline_at: '2026-08-20T01:30:00.000Z',
    });
  });
});
