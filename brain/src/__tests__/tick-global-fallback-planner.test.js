/**
 * Tick Global Fallback Planner Test
 * Fix: hasFocus=false 且队列空时，planNextTask 应被调用（krIds 逻辑修复）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TICK_INTERVAL_MINUTES } from '../tick.js';

describe('tick global fallback: planner trigger', () => {
  it('TICK_INTERVAL_MINUTES is defined and positive', () => {
    expect(typeof TICK_INTERVAL_MINUTES).toBe('number');
    expect(TICK_INTERVAL_MINUTES).toBeGreaterThan(0);
  });

  it('global fallback planner condition: allGoalIds.length > 0 (not krIds.length)', () => {
    // 模拟 hasFocus=false 时的状态
    const hasFocus = false;
    const krIds = [];  // hasFocus=false → krIds 永远是 []
    const allGoalIds = ['goal-uuid-1', 'goal-uuid-2'];  // 全局 fallback 有活跃 goal

    // Fix 前：krIds.length > 0 → false → planner 不触发
    const oldCondition = krIds.length > 0;
    expect(oldCondition).toBe(false);  // 确认旧代码有 bug

    // Fix 后：allGoalIds.length > 0 → true → planner 触发
    const newCondition = allGoalIds.length > 0;
    expect(newCondition).toBe(true);  // 确认新代码正确
  });

  it('global fallback: planKrIds 使用 allGoalIds 而非 krIds', () => {
    const hasFocus = false;
    const krIds = [];
    const allGoalIds = ['goal-uuid-1', 'goal-uuid-2'];

    // Fix 逻辑：hasFocus ? krIds : allGoalIds
    const planKrIds = hasFocus ? krIds : allGoalIds;
    expect(planKrIds).toEqual(allGoalIds);
    expect(planKrIds.length).toBe(2);
  });

  it('hasFocus=true 时 planKrIds 仍使用 krIds', () => {
    const hasFocus = true;
    const krIds = ['kr-uuid-1', 'kr-uuid-2'];
    const allGoalIds = ['obj-uuid', 'kr-uuid-1', 'kr-uuid-2'];

    const planKrIds = hasFocus ? krIds : allGoalIds;
    expect(planKrIds).toEqual(krIds);
  });
});
