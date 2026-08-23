import { describe, it, expect } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT = 5400;
const row = (hop: number, action: string, createdAt: string) => ({
  hop,
  action,
  created_at: createdAt,
  detail: {},
});

describe('validation clock fix extension [BEHAVIOR]', () => {
  it('r50 场景：最近成功 fix 刷新原点并保持存活', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      timeoutSeconds: TIMEOUT,
      intentAt: '2026-08-24T00:00:00.000Z',
      decisionLog: [
        row(1, 'spawn:generator', '2026-08-24T00:00:00.000Z'),
        row(20, 'spawn:generator-fix', '2026-08-24T02:00:00.000Z'),
      ],
    });
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-24T02:00:00.000Z',
      deadline_at: '2026-08-24T03:30:00.000Z',
    });
  });

  it('乱序日志按 hop 可重放', () => {
    const input = {
      action: 'spawn:judge',
      timeoutSeconds: 60,
      intentAt: '2026-08-24T00:00:00.000Z',
      decisionLog: [
        row(8, 'spawn:generator-fix', '2026-08-24T00:08:00.000Z'),
        row(1, 'spawn:generator', '2026-08-24T00:00:00.000Z'),
        row(3, 'spawn:generator-fix', '2026-08-24T00:03:00.000Z'),
      ],
    };
    const first = resolveValidationClock(input);
    expect(resolveValidationClock(input)).toEqual(first);
    expect(first?.pipeline_started_at).toBe('2026-08-24T00:08:00.000Z');
  });

  it('第 7 次 fix 不再延长 deadline', () => {
    const decisionLog = [row(1, 'spawn:generator', '2026-08-24T00:00:00.000Z')];
    for (let fix = 1; fix <= 7; fix += 1) {
      decisionLog.push(row(fix + 1, 'spawn:generator-fix', `2026-08-24T00:0${fix}:00.000Z`));
    }
    const clock = resolveValidationClock({
      action: 'spawn:evaluator', decisionLog, intentAt: decisionLog[0].created_at, timeoutSeconds: 60,
    });
    expect(clock?.pipeline_started_at).toBe('2026-08-24T00:06:00.000Z');
    expect(clock?.pipeline_started_at).not.toBe('2026-08-24T00:07:00.000Z');
    expect(clock?.deadline_at).toBe('2026-08-24T00:07:00.000Z');
  });

  it('无 fix 轮保持原有 generator clock', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [row(10, 'spawn:generator', '2026-08-24T01:00:00.000Z')],
      intentAt: '2026-08-24T00:00:00.000Z',
      timeoutSeconds: 300,
    });
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-24T01:00:00.000Z',
      deadline_at: '2026-08-24T01:05:00.000Z',
    });
  });
});
