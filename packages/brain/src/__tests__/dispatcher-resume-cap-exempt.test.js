/**
 * dispatcher-resume-cap-exempt.test.js
 *
 * OPEN-2 看门狗与并发 cap 的交互（team-lead 点名必须覆盖）：
 * 看门狗把 parked in_progress → queued 重排（resume_from_checkpoint=true）后，
 * dispatcher 重新派发时**不能**把它当新 harness 任务被 harness admission 判定
 * （slot-allocator.harnessSlotCheck + 任务数兜底 HARNESS_TASK_CAP_BACKSTOP）
 * 挡住——否则其它活跑占满 cap 时，自愈被 cap 永久锁死。
 *
 * shouldApplyHarnessCap(candidate)：
 *   - harness_initiative 且非 resume → true（照常受 cap 限制）
 *   - harness_initiative 且 resume_from_checkpoint=true → false（豁免：恢复已存在的跑，非新工作）
 *   - 非 harness → false（cap 只管 harness）
 */

import { describe, it, expect } from 'vitest';
import { shouldApplyHarnessCap } from '../dispatcher.js';

describe('shouldApplyHarnessCap — resume 任务豁免并发 cap', () => {
  it('export 存在', () => {
    expect(typeof shouldApplyHarnessCap).toBe('function');
  });

  it('普通 harness_initiative（无 resume 标志）→ 受 cap 限制 (true)', () => {
    expect(shouldApplyHarnessCap({ task_type: 'harness_initiative', payload: {} })).toBe(true);
    expect(shouldApplyHarnessCap({ task_type: 'harness_initiative', payload: null })).toBe(true);
    expect(shouldApplyHarnessCap({ task_type: 'harness_initiative' })).toBe(true);
  });

  it('resume_from_checkpoint=true 的 harness_initiative → 豁免 cap (false)', () => {
    expect(
      shouldApplyHarnessCap({ task_type: 'harness_initiative', payload: { resume_from_checkpoint: true } })
    ).toBe(false);
  });

  it('非 harness 任务 → 不进 cap 分支 (false)', () => {
    expect(shouldApplyHarnessCap({ task_type: 'dev', payload: {} })).toBe(false);
    expect(shouldApplyHarnessCap({ task_type: 'content', payload: { resume_from_checkpoint: true } })).toBe(false);
  });
});
