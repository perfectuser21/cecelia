import { describe, expect, it } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const timeoutSeconds = 5400;
const row = (hop, action, startedAt) => ({ hop, action, detail: { pipeline_started_at: startedAt, deadline_at: new Date(Date.parse(startedAt) + timeoutSeconds * 1000).toISOString() } });
const launched = (hop, dispatchHop) => ({ hop, action: 'effect:attempt_launched', detail: { dispatch_hop: dispatchHop, dispatch_action: 'spawn:generator-fix', attempt_id: `00000000-0000-4000-8000-${String(hop).padStart(12, '0')}` } });

describe('resolveValidationClock extends deadline per fix round', () => {
  it('r50 型场景旧 deadline 已过但最新成功 fix 窗口仍存活', () => {
    const actual = resolveValidationClock({ action: 'spawn:evaluator', timeoutSeconds, intentAt: '2026-08-24T03:20:00.000Z', decisionLog: [row(10, 'spawn:generator', '2026-08-24T00:00:00.000Z'), row(30, 'spawn:generator-fix', '2026-08-24T02:30:00.000Z'), launched(31, 30)] });
    expect(actual.deadline_at).toBe('2026-08-24T04:00:00.000Z');
  });

  it('第七次 fix 不得突破六次顺延上限', () => {
    const rows = [row(1, 'spawn:generator', '2026-08-24T00:00:00.000Z')];
    for (let n = 1; n <= 7; n += 1) { rows.push(row(n * 10, 'spawn:generator-fix', `2026-08-24T0${n}:00:00.000Z`)); rows.push(launched(n * 10 + 1, n * 10)); }
    expect(resolveValidationClock({ action: 'spawn:judge', timeoutSeconds, intentAt: '2026-08-24T07:10:00.000Z', decisionLog: rows }).deadline_at).toBe('2026-08-24T07:30:00.000Z');
  });

  it('无匹配 attempt_launched 回执的 fix intent 不顺延', () => {
    const actual = resolveValidationClock({ action: 'spawn:evaluator', timeoutSeconds, intentAt: '2026-08-24T03:20:00.000Z', decisionLog: [row(1, 'spawn:generator', '2026-08-24T00:00:00.000Z'), row(30, 'spawn:generator-fix', '2026-08-24T02:30:00.000Z'), launched(31, 29)] });
    expect(actual.deadline_at).toBe('2026-08-24T01:30:00.000Z');
  });

  it('无 fix 轮仍使用首次 generator 原点', () => {
    expect(resolveValidationClock({ action: 'spawn:judge', timeoutSeconds, intentAt: '2026-08-24T00:10:00.000Z', decisionLog: [row(1, 'spawn:generator', '2026-08-24T00:00:00.000Z')] }).deadline_at).toBe('2026-08-24T01:30:00.000Z');
  });
});
