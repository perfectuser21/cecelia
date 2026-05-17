/**
 * dept-heartbeat-plugin.test.js — Brain v2 Phase D1.7c-plugin1
 *
 * 验证 dept-heartbeat.js 新增 plugin 接口 tick(now, tickState, opts)：
 *  - CONSCIOUSNESS_ENABLED=false 时跳过（不调 triggerDeptHeartbeats）
 *  - CONSCIOUSNESS_ENABLED=true 时调 triggerDeptHeartbeats(pool) 并返回结果
 *  - triggerDeptHeartbeats 抛错时不向上抛（吞错返回 SKIPPED_RESULT）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock consciousness-guard before importing plugin
const mockIsConsciousnessEnabled = vi.fn();
vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: () => mockIsConsciousnessEnabled(),
  reloadConsciousnessCache: vi.fn(),
}));

// Mock db.js (pool)
const mockPool = { query: vi.fn() };
vi.mock('../db.js', () => ({
  default: mockPool,
}));

import * as deptHeartbeatModule from '../dept-heartbeat.js';

describe('dept-heartbeat-plugin tick(now, tickState)', () => {
  beforeEach(() => {
    mockIsConsciousnessEnabled.mockReset();
    mockPool.query.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports a tick function', () => {
    expect(typeof deptHeartbeatModule.tick).toBe('function');
  });

  it('returns SKIPPED_RESULT when consciousness disabled (no triggerDeptHeartbeats call)', async () => {
    mockIsConsciousnessEnabled.mockReturnValue(false);

    const triggerSpy = vi.spyOn(deptHeartbeatModule, 'triggerDeptHeartbeats');
    const result = await deptHeartbeatModule.tick(new Date(), {}, { pool: mockPool });

    expect(result).toEqual({ triggered: 0, skipped: 0, results: [] });
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('returns triggerDeptHeartbeats output when consciousness enabled', async () => {
    mockIsConsciousnessEnabled.mockReturnValue(true);

    // Mock dept_configs query → 0 depts → triggerDeptHeartbeats returns 0/0
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await deptHeartbeatModule.tick(new Date(), {}, { pool: mockPool });

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(0);
    expect(Array.isArray(result.results)).toBe(true);
  });

  it('swallows errors from triggerDeptHeartbeats and returns SKIPPED_RESULT', async () => {
    mockIsConsciousnessEnabled.mockReturnValue(true);

    // Make pool.query throw
    mockPool.query.mockRejectedValueOnce(new Error('boom'));

    // Spy console.error to silence
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await deptHeartbeatModule.tick(new Date(), {}, { pool: mockPool });

    // triggerDeptHeartbeats already swallows the error internally;
    // it returns triggered:0, skipped:0, results:[]
    expect(result).toEqual({ triggered: 0, skipped: 0, results: [] });

    errSpy.mockRestore();
  });
});
