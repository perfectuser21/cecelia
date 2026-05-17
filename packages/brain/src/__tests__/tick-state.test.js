/**
 * tick-state.test.js — Brain v2 Phase D1.7a 单元测试
 *
 * 验证 tickState 单例的 14 个 lastXxxTime 字段 + 5 个控制态字段全部存在，
 * 且 resetTickStateForTests() 能正确归零。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { tickState, resetTickStateForTests } from '../tick-state.js';

const REQUIRED_LAST_TIME_FIELDS = [
  'lastExecuteTime',
  'lastCleanupTime',
  'lastHealthCheckTime',
  'lastKrProgressSyncTime',
  'lastHeartbeatTime',
  'lastGoalEvalTime',
  'lastZombieSweepTime',
  'lastZombieCleanupTime',
  'lastPipelinePatrolTime',
  'lastPipelineWatchdogTime',
  'lastKrHealthDailyTime',
  'lastCredentialCheckTime',
  'lastCleanupWorkerTime',
  'lastOrphanPrWorkerTime'
];

const REQUIRED_LOOP_FIELDS = [
  'loopTimer',
  'recoveryTimer',
  'tickRunning',
  'tickLockTime',
  'lastConsciousnessReload'
];

describe('tick-state.js (D1.7a)', () => {
  beforeEach(() => {
    resetTickStateForTests();
  });

  it('exports tickState singleton with all 14 lastXxxTime fields', () => {
    for (const field of REQUIRED_LAST_TIME_FIELDS) {
      expect(field in tickState, `missing field: ${field}`).toBe(true);
      expect(typeof tickState[field]).toBe('number');
    }
  });

  it('exports tickState with 5 loop control fields', () => {
    for (const field of REQUIRED_LOOP_FIELDS) {
      expect(field in tickState, `missing field: ${field}`).toBe(true);
    }
  });

  it('initializes all lastXxxTime to 0', () => {
    for (const field of REQUIRED_LAST_TIME_FIELDS) {
      expect(tickState[field]).toBe(0);
    }
  });

  it('initializes loop timers to null and tickRunning to false', () => {
    expect(tickState.loopTimer).toBeNull();
    expect(tickState.recoveryTimer).toBeNull();
    expect(tickState.tickRunning).toBe(false);
    expect(tickState.tickLockTime).toBeNull();
    expect(tickState.lastConsciousnessReload).toBe(0);
  });

  it('resetTickStateForTests() restores all fields to initial state', () => {
    // 弄脏所有字段
    for (const field of REQUIRED_LAST_TIME_FIELDS) {
      tickState[field] = Date.now();
    }
    tickState.loopTimer = {};
    tickState.recoveryTimer = {};
    tickState.tickRunning = true;
    tickState.tickLockTime = Date.now();
    tickState.lastConsciousnessReload = Date.now();

    resetTickStateForTests();

    for (const field of REQUIRED_LAST_TIME_FIELDS) {
      expect(tickState[field]).toBe(0);
    }
    expect(tickState.loopTimer).toBeNull();
    expect(tickState.recoveryTimer).toBeNull();
    expect(tickState.tickRunning).toBe(false);
    expect(tickState.tickLockTime).toBeNull();
    expect(tickState.lastConsciousnessReload).toBe(0);
  });

  it('tickState is a singleton (mutations persist across imports)', async () => {
    tickState.lastExecuteTime = 12345;
    const fresh = await import('../tick-state.js');
    expect(fresh.tickState.lastExecuteTime).toBe(12345);
    resetTickStateForTests();
    expect(fresh.tickState.lastExecuteTime).toBe(0);
  });
});
