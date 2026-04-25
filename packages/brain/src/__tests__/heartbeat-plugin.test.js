/**
 * heartbeat-plugin.test.js — Brain v2 Phase D1.7c-plugin1
 *
 * 验证 heartbeat-plugin.js tick(now, tickState):
 *  - elapsed < HEARTBEAT_INTERVAL_MS 时不跑
 *  - 成功时更新 lastHeartbeatTime + push action（actions_count > 0）
 *  - actions_count==0 或 skipped 时不 push
 *  - **失败时不更新 lastHeartbeatTime**（关键行为：下次 tick 立即重试）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunHeartbeatInspection = vi.fn();
const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000; // 30min
const mockPool = { query: vi.fn() };

vi.mock('../heartbeat-inspector.js', () => ({
  HEARTBEAT_INTERVAL_MS,
  runHeartbeatInspection: (pool) => mockRunHeartbeatInspection(pool),
}));
vi.mock('../db.js', () => ({
  default: mockPool,
}));

import * as hbPlugin from '../heartbeat-plugin.js';

describe('heartbeat-plugin tick()', () => {
  beforeEach(() => {
    mockRunHeartbeatInspection.mockReset();
  });

  it('exports a tick function', () => {
    expect(typeof hbPlugin.tick).toBe('function');
  });

  it('returns {ran:false} when tickState missing', async () => {
    const r = await hbPlugin.tick(new Date(), null);
    expect(r).toEqual({ ran: false, actions: [] });
  });

  it('skips when elapsed < HEARTBEAT_INTERVAL_MS', async () => {
    const tickState = { lastHeartbeatTime: Date.now() };
    const r = await hbPlugin.tick(new Date(), tickState);
    expect(r.ran).toBe(false);
    expect(mockRunHeartbeatInspection).not.toHaveBeenCalled();
  });

  it('runs and updates lastHeartbeatTime on success with actions', async () => {
    mockRunHeartbeatInspection.mockResolvedValue({ skipped: false, actions_count: 3 });
    const tickState = { lastHeartbeatTime: Date.now() - 2 * HEARTBEAT_INTERVAL_MS };
    const before = tickState.lastHeartbeatTime;

    const r = await hbPlugin.tick(new Date(), tickState);

    expect(r.ran).toBe(true);
    expect(tickState.lastHeartbeatTime).toBeGreaterThan(before);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({ action: 'heartbeat_inspection', actions_count: 3 });
  });

  it('runs but pushes no action when actions_count == 0', async () => {
    mockRunHeartbeatInspection.mockResolvedValue({ skipped: false, actions_count: 0 });
    const tickState = { lastHeartbeatTime: 0 };

    const r = await hbPlugin.tick(new Date(), tickState);
    expect(r.ran).toBe(true);
    expect(r.actions).toEqual([]);
  });

  it('runs but pushes no action when skipped', async () => {
    mockRunHeartbeatInspection.mockResolvedValue({ skipped: true, actions_count: 5 });
    const tickState = { lastHeartbeatTime: 0 };

    const r = await hbPlugin.tick(new Date(), tickState);
    expect(r.ran).toBe(true);
    expect(r.actions).toEqual([]);
  });

  it('does NOT update lastHeartbeatTime when inspection throws (retry on next tick)', async () => {
    mockRunHeartbeatInspection.mockRejectedValue(new Error('inspector boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const tickState = { lastHeartbeatTime: 0 };
    const r = await hbPlugin.tick(new Date(), tickState);

    expect(r.ran).toBe(true);
    expect(tickState.lastHeartbeatTime).toBe(0); // 仍是 0，下次 tick 立即重试
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });
});
