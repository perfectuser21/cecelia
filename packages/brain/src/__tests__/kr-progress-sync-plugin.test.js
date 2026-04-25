/**
 * kr-progress-sync-plugin.test.js — Brain v2 Phase D1.7c-plugin1
 *
 * 验证 kr-progress-sync-plugin.js tick(now, tickState):
 *  - 节流：elapsed < CLEANUP_INTERVAL_MS 时不跑
 *  - elapsed >= CLEANUP_INTERVAL_MS 时跑：mark 时间戳 + 跑 verifier + fallback
 *  - verifier.updated > 0 时 push kr_verifier_sync action
 *  - kr-progress.updated > 0 时 push kr_progress_sync action
 *  - 内部抛错被吞，返回 ran:true、actions 已收集的部分
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRunAllVerifiers = vi.fn();
const mockSyncAllKrProgress = vi.fn();
const mockPool = { query: vi.fn() };

vi.mock('../kr-verifier.js', () => ({
  runAllVerifiers: () => mockRunAllVerifiers(),
}));
vi.mock('../kr-progress.js', () => ({
  syncAllKrProgress: (pool) => mockSyncAllKrProgress(pool),
}));
vi.mock('../db.js', () => ({
  default: mockPool,
}));

import * as krPlugin from '../kr-progress-sync-plugin.js';

describe('kr-progress-sync-plugin tick()', () => {
  beforeEach(() => {
    mockRunAllVerifiers.mockReset();
    mockSyncAllKrProgress.mockReset();
  });

  it('exports a tick function and constant', () => {
    expect(typeof krPlugin.tick).toBe('function');
    expect(typeof krPlugin._CLEANUP_INTERVAL_MS).toBe('number');
  });

  it('returns {ran:false, actions:[]} when tickState is missing', async () => {
    const r = await krPlugin.tick(new Date(), null);
    expect(r).toEqual({ ran: false, actions: [] });
  });

  it('skips when elapsed < CLEANUP_INTERVAL_MS', async () => {
    const tickState = { lastKrProgressSyncTime: Date.now() }; // 刚跑过
    const r = await krPlugin.tick(new Date(), tickState);
    expect(r.ran).toBe(false);
    expect(mockRunAllVerifiers).not.toHaveBeenCalled();
    expect(mockSyncAllKrProgress).not.toHaveBeenCalled();
  });

  it('runs and pushes actions when elapsed >= CLEANUP_INTERVAL_MS', async () => {
    mockRunAllVerifiers.mockResolvedValue({ updated: 3, errors: [] });
    mockSyncAllKrProgress.mockResolvedValue({ updated: 2 });

    // 2h ago
    const tickState = { lastKrProgressSyncTime: Date.now() - 2 * 60 * 60 * 1000 };
    const before = tickState.lastKrProgressSyncTime;

    const r = await krPlugin.tick(new Date(), tickState);

    expect(r.ran).toBe(true);
    expect(tickState.lastKrProgressSyncTime).toBeGreaterThan(before);

    expect(r.actions).toHaveLength(2);
    expect(r.actions[0]).toMatchObject({ action: 'kr_verifier_sync', updated_count: 3 });
    expect(r.actions[1]).toMatchObject({ action: 'kr_progress_sync', updated_count: 2 });
  });

  it('omits action when updated == 0', async () => {
    mockRunAllVerifiers.mockResolvedValue({ updated: 0, errors: [] });
    mockSyncAllKrProgress.mockResolvedValue({ updated: 0 });

    const tickState = { lastKrProgressSyncTime: 0 };
    const r = await krPlugin.tick(new Date(), tickState);

    expect(r.ran).toBe(true);
    expect(r.actions).toEqual([]);
  });

  it('swallows verifier error and continues (returns ran:true)', async () => {
    mockRunAllVerifiers.mockRejectedValue(new Error('verifier boom'));
    mockSyncAllKrProgress.mockResolvedValue({ updated: 0 });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const tickState = { lastKrProgressSyncTime: 0 };
    const r = await krPlugin.tick(new Date(), tickState);

    expect(r.ran).toBe(true);
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it('marks timestamp BEFORE running (no retry on inner error)', async () => {
    mockRunAllVerifiers.mockRejectedValue(new Error('verifier boom'));

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const tickState = { lastKrProgressSyncTime: 0 };
    await krPlugin.tick(new Date(), tickState);

    // 即使 verifier 抛错，时间戳已 mark（与原 tick.js inline 行为一致）
    expect(tickState.lastKrProgressSyncTime).toBeGreaterThan(0);

    errSpy.mockRestore();
  });
});
