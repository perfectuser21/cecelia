import { describe, it, expect } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const started = '2026-08-24T00:00:00.000Z';
const deadline = '2026-08-24T01:30:00.000Z';
const intent = (hop, action, created_at, timeout = 5400) => ({ hop, action, created_at, detail: { pipeline_started_at: started, deadline_at: new Date(new Date(started).getTime() + timeout * 1000).toISOString() } });
const launched = (hop, dispatch_hop, dispatch_action = 'spawn:generator-fix') => ({
  hop, action: 'effect:attempt_launched', created_at: `2026-08-24T00:${String(hop).padStart(2, '0')}:01.000Z`,
  detail: { dispatch_hop, dispatch_action, run_id: `run-${hop}`, attempt_id: `attempt-${hop}`, lease_generation: 1, provider: 'codex' },
});

describe('validation clock fix extension required CI [BEHAVIOR]', () => {
  it('r50 场景：最近成功 fix 刷新原点并保持存活', () => {
    expect(resolveValidationClock({ action: 'spawn:evaluator', timeoutSeconds: 5400, intentAt: started, decisionLog: [
      intent(1, 'spawn:generator', started), intent(20, 'spawn:generator-fix', '2026-08-24T02:00:00.000Z'), launched(21, 20),
    ] })).toEqual({ pipeline_started_at: '2026-08-24T02:00:00.000Z', deadline_at: '2026-08-24T03:30:00.000Z' });
  });

  it('失败或被阻止的 fix intent 不刷新原点', () => {
    expect(resolveValidationClock({ action: 'spawn:evaluator', timeoutSeconds: 5400, intentAt: started, decisionLog: [
      intent(1, 'spawn:generator', started), intent(20, 'spawn:generator-fix', '2026-08-24T02:00:00.000Z'), launched(21, 999), launched(22, 20, 'spawn:evaluator'),
    ] })).toEqual({ pipeline_started_at: started, deadline_at: deadline });
  });

  it('乱序日志按 hop 可重放', () => {
    const input = { action: 'spawn:judge', timeoutSeconds: 60, intentAt: started, decisionLog: [launched(9, 8), intent(8, 'spawn:generator-fix', '2026-08-24T00:08:00.000Z', 60), intent(1, 'spawn:generator', started, 60)] };
    expect(resolveValidationClock(input)).toEqual(resolveValidationClock(input));
    expect(resolveValidationClock(input).pipeline_started_at).toBe('2026-08-24T00:08:00.000Z');
  });

  it('第 7 次 fix 不再延长 deadline', () => {
    const decisionLog = [intent(1, 'spawn:generator', started, 60)];
    for (let fix = 1; fix <= 7; fix += 1) {
      decisionLog.push(intent(fix * 2, 'spawn:generator-fix', `2026-08-24T00:0${fix}:00.000Z`, 60), launched(fix * 2 + 1, fix * 2));
    }
    expect(resolveValidationClock({ action: 'spawn:evaluator', timeoutSeconds: 60, intentAt: started, decisionLog }).pipeline_started_at).toBe('2026-08-24T00:06:00.000Z');
  });

  it('无 fix 轮保持原有 generator clock', () => {
    expect(resolveValidationClock({ action: 'spawn:evaluator', timeoutSeconds: 5400, intentAt: started, decisionLog: [intent(1, 'spawn:generator', started)] })).toEqual({ pipeline_started_at: started, deadline_at: deadline });
  });
});
