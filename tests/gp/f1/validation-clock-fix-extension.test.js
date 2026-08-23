import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const generatorAt = '2026-08-20T00:00:00.000Z';
const row = (hop, action, created_at) => ({ hop, action, created_at, detail: {} });
const launchedFix = (hop, createdAt) => [
  row(hop, 'spawn:generator-fix', createdAt),
  { hop: hop + 1, action: 'effect:attempt_launched', created_at: createdAt,
    detail: { dispatch_hop: hop, dispatch_action: 'spawn:generator-fix' } },
];
const resolve = (decisionLog) => resolveValidationClock({
  action: 'spawn:evaluator', decisionLog,
  intentAt: '2026-08-20T03:00:00.000Z', timeoutSeconds: 5400,
});

describe('F1 validation clock fix extension permanent regression', () => {
  it('r50 型长跑在第 1 次 fix 新期限内保持存活', () => {
    expect(resolve([row(10, 'spawn:generator', generatorAt), ...launchedFix(30, '2026-08-20T01:20:00.000Z')]))
      .toEqual({ pipeline_started_at: '2026-08-20T01:20:00.000Z', deadline_at: '2026-08-20T02:50:00.000Z' });
  });

  it('乱序输入仍按 hop 重放并选第 6 次 fix 为新原点', () => {
    const fixes = Array.from({ length: 6 }, (_, i) => launchedFix(20 + i * 2, `2026-08-20T0${i + 1}:00:00.000Z`)).flat();
    expect(resolve([...fixes.slice(-2), row(10, 'spawn:generator', generatorAt), ...fixes.slice(0, -2)]))
      .toEqual({ pipeline_started_at: '2026-08-20T06:00:00.000Z', deadline_at: '2026-08-20T07:30:00.000Z' });
  });

  it('第 7 次及以后 fix 不再顺延并沿用第 6 次期限', () => {
    const fixes = Array.from({ length: 8 }, (_, i) => launchedFix(20 + i * 2, `2026-08-20T${String(i + 1).padStart(2, '0')}:00:00.000Z`)).flat();
    expect(resolve([row(10, 'spawn:generator', generatorAt), ...fixes]))
      .toEqual({ pipeline_started_at: '2026-08-20T06:00:00.000Z', deadline_at: '2026-08-20T07:30:00.000Z' });
  });

  it('无 fix 轮时保持首次 generator 原点语义', () => {
    expect(resolve([row(10, 'spawn:generator', generatorAt)]))
      .toEqual({ pipeline_started_at: generatorAt, deadline_at: '2026-08-20T01:30:00.000Z' });
  });

  it('非成功 fix 派发没有 launched effect 时不得顺延', () => {
    expect(resolve([
      row(10, 'spawn:generator', generatorAt),
      row(30, 'spawn:generator-fix', '2026-08-20T01:20:00.000Z'),
      { hop: 31, action: 'result:dispatch', created_at: '2026-08-20T01:20:01.000Z',
        detail: { dispatch_hop: 30, dispatch_action: 'spawn:generator-fix', status: 'BLOCKED' } },
    ])).toEqual({ pipeline_started_at: generatorAt, deadline_at: '2026-08-20T01:30:00.000Z' });
  });
});
