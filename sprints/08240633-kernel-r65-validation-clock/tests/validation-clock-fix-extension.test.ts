import { describe, expect, it } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const timeoutSeconds = 5400;
const origin = (hop: number, action: string, startedAt: string) => ({
  hop,
  action,
  detail: {
    pipeline_started_at: startedAt,
    deadline_at: new Date(Date.parse(startedAt) + timeoutSeconds * 1000).toISOString(),
  },
});

describe('validation clock 按 generator-fix 有界顺延 [BEHAVIOR]', () => {
  it('r50 型场景以最新成功 fix 原点重算后保持存活', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator', timeoutSeconds, intentAt: '2026-08-24T03:20:00.000Z',
      decisionLog: [
        origin(10, 'spawn:generator', '2026-08-24T00:00:00.000Z'),
        origin(30, 'spawn:generator-fix', '2026-08-24T02:30:00.000Z'),
      ],
    });
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-24T02:30:00.000Z',
      deadline_at: '2026-08-24T04:00:00.000Z',
    });
  });

  it('第六次成功 fix 仍以第六次 fix 原点顺延', () => {
    const rows = [origin(1, 'spawn:generator', '2026-08-24T00:00:00.000Z')];
    for (let n = 1; n <= 6; n += 1) rows.push(origin(1 + n, 'spawn:generator-fix', `2026-08-24T0${n}:00:00.000Z`));
    expect(resolveValidationClock({ action: 'spawn:judge', decisionLog: rows, intentAt: '2026-08-24T06:10:00.000Z', timeoutSeconds })).toEqual({
      pipeline_started_at: '2026-08-24T06:00:00.000Z', deadline_at: '2026-08-24T07:30:00.000Z',
    });
  });

  it('第七次成功 fix 超限且不得把原点延到第七次', () => {
    const rows = [origin(1, 'spawn:generator', '2026-08-24T00:00:00.000Z')];
    for (let n = 1; n <= 7; n += 1) rows.push(origin(1 + n, 'spawn:generator-fix', `2026-08-24T0${n}:00:00.000Z`));
    expect(resolveValidationClock({ action: 'spawn:judge', decisionLog: rows.reverse(), intentAt: '2026-08-24T07:10:00.000Z', timeoutSeconds })).toEqual({
      pipeline_started_at: '2026-08-24T06:00:00.000Z', deadline_at: '2026-08-24T07:30:00.000Z',
    });
  });

  it('无 fix 轮保持首次 generator 原点语义', () => {
    expect(resolveValidationClock({
      action: 'spawn:evaluator', timeoutSeconds, intentAt: '2026-08-24T00:10:00.000Z',
      decisionLog: [origin(4, 'spawn:generator', '2026-08-24T00:00:00.000Z')],
    })).toEqual({ pipeline_started_at: '2026-08-24T00:00:00.000Z', deadline_at: '2026-08-24T01:30:00.000Z' });
  });
});
