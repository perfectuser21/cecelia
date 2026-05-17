/**
 * 情绪门禁测试 — emotion-dispatch.test.js
 *
 * 测试 evaluateEmotion 返回的 dispatch_rate_modifier 和
 * tick.js 中情绪门禁对派发上限的影响逻辑。
 */

import { describe, it, expect } from 'vitest';
import { evaluateEmotion, EMOTION_STATES } from '../cognitive-core.js';

describe('情绪系统 dispatch_rate_modifier', () => {
  it('overloaded 状态返回低修正系数（0.4）', () => {
    const result = evaluateEmotion({
      cpuPercent: 85,
      queueDepth: 15,
      successRate: 0.8,
      alertnessLevel: 2
    });
    expect(result.state).toBe(EMOTION_STATES.overloaded);
    expect(result.dispatch_rate_modifier).toBe(0.4);
  });

  it('focused 状态返回高修正系数（1.2）', () => {
    const result = evaluateEmotion({
      cpuPercent: 15,
      queueDepth: 1,
      successRate: 0.9,
      alertnessLevel: 1
    });
    expect(result.state).toBe(EMOTION_STATES.focused);
    expect(result.dispatch_rate_modifier).toBe(1.2);
  });

  it('excited 状态返回最高修正系数（1.3）', () => {
    const result = evaluateEmotion({
      cpuPercent: 25,
      queueDepth: 5,
      successRate: 0.95,
      alertnessLevel: 1
    });
    expect(result.state).toBe(EMOTION_STATES.excited);
    expect(result.dispatch_rate_modifier).toBe(1.3);
  });

  it('tired 状态返回降速系数（0.7）', () => {
    const result = evaluateEmotion({
      cpuPercent: 40,
      queueDepth: 3,
      successRate: 0.8,
      alertnessLevel: 2,
      uptimeHours: 14
    });
    expect(result.state).toBe(EMOTION_STATES.tired);
    expect(result.dispatch_rate_modifier).toBe(0.7);
  });

  it('anxious 状态返回谨慎系数（0.8）', () => {
    const result = evaluateEmotion({
      cpuPercent: 30,
      queueDepth: 3,
      successRate: 0.45,
      alertnessLevel: 1
    });
    expect(result.state).toBe(EMOTION_STATES.anxious);
    expect(result.dispatch_rate_modifier).toBe(0.8);
  });

  it('calm 状态返回正常系数（1.0）', () => {
    const result = evaluateEmotion({
      cpuPercent: 30,
      queueDepth: 3,
      successRate: 0.8,
      alertnessLevel: 1
    });
    expect(result.state).toBe(EMOTION_STATES.calm);
    expect(result.dispatch_rate_modifier).toBe(1.0);
  });

  it('dispatch_rate_modifier 应用后：overloaded 有效上限小于 calm', () => {
    const poolAvailable = 4;
    const alertnessRate = 1.0;

    const overloadResult = evaluateEmotion({ cpuPercent: 85, queueDepth: 15, successRate: 0.8 });
    const calmResult = evaluateEmotion({ cpuPercent: 30, queueDepth: 3, successRate: 0.8 });

    const overloadMax = Math.max(1, Math.floor(poolAvailable * alertnessRate * overloadResult.dispatch_rate_modifier));
    const calmMax = Math.max(1, Math.floor(poolAvailable * alertnessRate * calmResult.dispatch_rate_modifier));

    expect(overloadMax).toBeLessThan(calmMax);
  });
});
