import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const timeoutSeconds = 100;
const origin = '2026-08-01T00:00:00.000Z';

function row(hop: number, action: string, createdAt: string, detail: Record<string, unknown> = {}) {
  return { hop, action, created_at: createdAt, detail };
}

function launched(hop: number, dispatchHop: number) {
  return row(hop, 'attempt:launched', `2026-08-01T00:00:${String(hop).padStart(2, '0')}.000Z`, {
    dispatch_hop: dispatchHop,
    dispatch_action: 'spawn:generator-fix',
  });
}

function logWithSuccessfulFixes(count: number) {
  const log = [row(1, 'spawn:generator', origin, {
    pipeline_started_at: origin,
    deadline_at: '2026-08-01T00:01:40.000Z',
  })];
  for (let index = 1; index <= count; index += 1) {
    const dispatchHop = index * 2;
    const createdAt = `2026-08-01T00:${String(index).padStart(2, '0')}:00.000Z`;
    log.push(row(dispatchHop, 'spawn:generator-fix', createdAt), launched(dispatchHop + 1, dispatchHop));
  }
  return log;
}

describe('validation clock 按成功 generator-fix 有界顺延', () => {
  it('r50 场景最近一次成功 fix 作为新原点使界内 run 存活', () => {
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: logWithSuccessfulFixes(3),
      intentAt: '2026-08-01T00:03:30.000Z',
      timeoutSeconds,
    })).toEqual({
      pipeline_started_at: '2026-08-01T00:03:00.000Z',
      deadline_at: '2026-08-01T00:04:40.000Z',
    });
  });

  it('恰好六次成功 fix 均可顺延且结果只由 hop 时序决定', () => {
    const ordered = logWithSuccessfulFixes(6);
    const replayed = [ordered[0], ...ordered.slice(1).reverse()];
    expect(resolveValidationClock({ action: 'spawn:judge', decisionLog: replayed, intentAt: origin, timeoutSeconds }))
      .toEqual({ pipeline_started_at: '2026-08-01T00:06:00.000Z', deadline_at: '2026-08-01T00:07:40.000Z' });
  });

  it('第七次成功 fix 不再顺延并保留第六次 deadline', () => {
    expect(resolveValidationClock({ action: 'spawn:judge', decisionLog: logWithSuccessfulFixes(7), intentAt: origin, timeoutSeconds }))
      .toEqual({ pipeline_started_at: '2026-08-01T00:06:00.000Z', deadline_at: '2026-08-01T00:07:40.000Z' });
  });

  it('没有成功 launch receipt 的 fix 不顺延且无 fix 语义不变', () => {
    const base = logWithSuccessfulFixes(0);
    base.push(row(2, 'spawn:generator-fix', '2026-08-01T00:01:00.000Z'));
    expect(resolveValidationClock({ action: 'spawn:evaluator', decisionLog: base, intentAt: origin, timeoutSeconds }))
      .toEqual({ pipeline_started_at: origin, deadline_at: '2026-08-01T00:01:40.000Z' });
  });
});
