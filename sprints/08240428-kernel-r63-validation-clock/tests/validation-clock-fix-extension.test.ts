import { describe, it, expect } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT = 5400;
const originalStarted = '2026-08-24T00:00:00.000Z';
const originalDeadline = '2026-08-24T01:30:00.000Z';
const intent = (hop: number, action: string, createdAt: string, timeout = TIMEOUT) => ({
  hop, action, created_at: createdAt,
  detail: { reason: action === 'spawn:generator-fix' ? 'product_failure' : 'contract_approved', pipeline_started_at: originalStarted, deadline_at: new Date(new Date(originalStarted).getTime() + timeout * 1000).toISOString() },
});
const launched = (hop: number, dispatchHop: number, dispatchAction = 'spawn:generator-fix') => ({
  hop, action: 'effect:attempt_launched', created_at: `2026-08-24T00:${String(hop).padStart(2, '0')}:01.000Z`,
  detail: { dispatch_hop: dispatchHop, dispatch_action: dispatchAction, run_id: `run-${dispatchHop}`, attempt_id: `attempt-${dispatchHop}`, lease_generation: 1, provider: 'codex' },
});

describe('validation clock fix extension [BEHAVIOR]', () => {
  it('r50 场景：最近成功 fix 刷新原点并保持存活', () => {
    const clock = resolveValidationClock({ action: 'spawn:evaluator', timeoutSeconds: TIMEOUT, intentAt: '2026-08-24T03:00:00.000Z', decisionLog: [
      intent(1, 'spawn:generator', originalStarted),
      intent(20, 'spawn:generator-fix', '2026-08-24T02:00:00.000Z'),
      launched(21, 20),
    ] });
    expect(clock).toEqual({ pipeline_started_at: '2026-08-24T02:00:00.000Z', deadline_at: '2026-08-24T03:30:00.000Z' });
  });

  it('失败或被阻止的 fix intent 不刷新原点', () => {
    const clock = resolveValidationClock({ action: 'spawn:evaluator', timeoutSeconds: TIMEOUT, intentAt: '2026-08-24T03:00:00.000Z', decisionLog: [
      intent(1, 'spawn:generator', originalStarted),
      intent(20, 'spawn:generator-fix', '2026-08-24T02:00:00.000Z'),
      launched(21, 999),
      launched(22, 20, 'spawn:evaluator'),
    ] });
    expect(clock).toEqual({ pipeline_started_at: originalStarted, deadline_at: originalDeadline });
  });

  it('乱序日志按 hop 可重放', () => {
    const input = { action: 'spawn:judge', timeoutSeconds: 60, intentAt: originalStarted, decisionLog: [
      launched(9, 8), intent(8, 'spawn:generator-fix', '2026-08-24T00:08:00.000Z', 60),
      intent(1, 'spawn:generator', originalStarted, 60), launched(4, 3),
      intent(3, 'spawn:generator-fix', '2026-08-24T00:03:00.000Z', 60),
    ] };
    const first = resolveValidationClock(input);
    expect(resolveValidationClock(input)).toEqual(first);
    expect(first?.pipeline_started_at).toBe('2026-08-24T00:08:00.000Z');
  });

  it('第 7 次 fix 不再延长 deadline', () => {
    const decisionLog = [intent(1, 'spawn:generator', originalStarted, 60)];
    for (let fix = 1; fix <= 7; fix += 1) {
      const dispatchHop = fix * 2;
      decisionLog.push(intent(dispatchHop, 'spawn:generator-fix', `2026-08-24T00:0${fix}:00.000Z`, 60));
      decisionLog.push(launched(dispatchHop + 1, dispatchHop));
    }
    const clock = resolveValidationClock({ action: 'spawn:evaluator', decisionLog, intentAt: originalStarted, timeoutSeconds: 60 });
    expect(clock?.pipeline_started_at).toBe('2026-08-24T00:06:00.000Z');
    expect(clock?.pipeline_started_at).not.toBe('2026-08-24T00:07:00.000Z');
    expect(clock?.deadline_at).toBe('2026-08-24T00:07:00.000Z');
  });

  it('无 fix 轮保持原有 generator clock', () => {
    const clock = resolveValidationClock({ action: 'spawn:evaluator', decisionLog: [intent(10, 'spawn:generator', originalStarted)], intentAt: originalStarted, timeoutSeconds: TIMEOUT });
    expect(clock).toEqual({ pipeline_started_at: originalStarted, deadline_at: originalDeadline });
  });
});
