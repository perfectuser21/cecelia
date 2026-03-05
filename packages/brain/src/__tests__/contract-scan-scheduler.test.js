/**
 * contract-scan-scheduler.test.js
 * Tests for daily contract scan scheduler (added in daily-review-scheduler.js)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isInContractScanWindow,
  hasTodayContractScan,
  triggerContractScan,
} from '../daily-review-scheduler.js';

// ============================================================
// isInContractScanWindow
// ============================================================
describe('isInContractScanWindow', () => {
  it('03:00 UTC triggers', () => {
    const d = new Date('2026-03-05T03:00:00Z');
    expect(isInContractScanWindow(d)).toBe(true);
  });

  it('03:04 UTC still in window', () => {
    const d = new Date('2026-03-05T03:04:00Z');
    expect(isInContractScanWindow(d)).toBe(true);
  });

  it('03:05 UTC outside window', () => {
    const d = new Date('2026-03-05T03:05:00Z');
    expect(isInContractScanWindow(d)).toBe(false);
  });

  it('02:00 UTC does not trigger (that is code-review window)', () => {
    const d = new Date('2026-03-05T02:00:00Z');
    expect(isInContractScanWindow(d)).toBe(false);
  });

  it('10:30 UTC does not trigger', () => {
    const d = new Date('2026-03-05T10:30:00Z');
    expect(isInContractScanWindow(d)).toBe(false);
  });
});

// ============================================================
// hasTodayContractScan
// ============================================================
describe('hasTodayContractScan', () => {
  it('returns true when today already has contract-scan task', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'cs-1' }] }) };
    const result = await hasTodayContractScan(pool);
    expect(result).toBe(true);
    expect(pool.query).toHaveBeenCalledOnce();
    // Verify the query filters on task_type=dev AND created_by=contract-scan
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("task_type = 'dev'");
    expect(sql).toContain("created_by = 'contract-scan'");
  });

  it('returns false when no contract-scan task today', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await hasTodayContractScan(pool);
    expect(result).toBe(false);
  });
});

// ============================================================
// triggerContractScan
// ============================================================
describe('triggerContractScan', () => {
  it('skips outside trigger window', async () => {
    const pool = { query: vi.fn() };
    const notTriggerTime = new Date('2026-03-05T10:00:00Z');
    const result = await triggerContractScan(pool, notTriggerTime);
    expect(result.skipped_window).toBe(true);
    expect(result.triggered).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('skips if already ran today', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'existing' }] }) };
    const triggerTime = new Date('2026-03-05T03:01:00Z');
    const result = await triggerContractScan(pool, triggerTime);
    expect(result.skipped_window).toBe(false);
    expect(result.skipped_today).toBe(true);
    expect(result.triggered).toBe(false);
  });

  it('triggers scan script in trigger window with no existing task', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const triggerTime = new Date('2026-03-05T03:02:00Z');

    const mockChild = { unref: vi.fn() };
    const mockSpawn = vi.fn().mockReturnValue(mockChild);

    const result = await triggerContractScan(pool, triggerTime, mockSpawn);
    expect(result.skipped_window).toBe(false);
    expect(result.skipped_today).toBe(false);
    expect(result.triggered).toBe(true);

    // Verify spawn was called with node + script path
    expect(mockSpawn).toHaveBeenCalledOnce();
    const [cmd, args, opts] = mockSpawn.mock.calls[0];
    expect(cmd).toBe('node');
    expect(args[0]).toContain('run-contract-scan.mjs');
    expect(opts.detached).toBe(true);
    expect(opts.stdio).toBe('ignore');

    // Verify child.unref was called (fire-and-forget)
    expect(mockChild.unref).toHaveBeenCalledOnce();
  });

  it('continues even if dedup check fails', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('DB down')) };
    const triggerTime = new Date('2026-03-05T03:00:00Z');

    const mockChild = { unref: vi.fn() };
    const mockSpawn = vi.fn().mockReturnValue(mockChild);

    const result = await triggerContractScan(pool, triggerTime, mockSpawn);
    // Should still trigger despite DB error on dedup check
    expect(result.triggered).toBe(true);
    expect(mockSpawn).toHaveBeenCalledOnce();
  });
});
