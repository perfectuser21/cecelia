/**
 * daily-backup-scheduler.test.js
 *
 * 测试策略（unit）：
 *   - isInDailyBackupWindow() 纯函数，覆盖边界
 *   - scheduleDailyBackup() 时间窗口判断 + 幂等性 + 创建任务
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isInDailyBackupWindow,
  scheduleDailyBackup,
} from '../daily-backup-scheduler.js';

// ─────────────────────────────────────────────────────────────
// isInDailyBackupWindow() — 时间窗口纯函数测试
// 目标：北京时间 02:00 = UTC 18:00
// ─────────────────────────────────────────────────────────────
describe('isInDailyBackupWindow()', () => {
  it('UTC 18:00:00 — 在窗口内（北京时间 02:00）', () => {
    const d = new Date('2026-04-28T18:00:00Z');
    expect(isInDailyBackupWindow(d)).toBe(true);
  });

  it('UTC 18:04:59 — 在窗口内（北京时间 02:04:59）', () => {
    const d = new Date('2026-04-28T18:04:59Z');
    expect(isInDailyBackupWindow(d)).toBe(true);
  });

  it('UTC 18:05:00 — 超出窗口', () => {
    const d = new Date('2026-04-28T18:05:00Z');
    expect(isInDailyBackupWindow(d)).toBe(false);
  });

  it('UTC 12:00:00 — 不在触发时间', () => {
    const d = new Date('2026-04-28T12:00:00Z');
    expect(isInDailyBackupWindow(d)).toBe(false);
  });

  it('UTC 17:59:59 — 刚好未到窗口', () => {
    const d = new Date('2026-04-28T17:59:59Z');
    expect(isInDailyBackupWindow(d)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// scheduleDailyBackup() — 调度逻辑测试
// ─────────────────────────────────────────────────────────────
describe('scheduleDailyBackup()', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = { query: vi.fn() };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('不在时间窗口且非 force — 直接返回 inWindow=false，不查 DB', async () => {
    vi.setSystemTime(new Date('2026-04-28T12:00:00Z'));

    const result = await scheduleDailyBackup(mockPool);
    expect(result.inWindow).toBe(false);
    expect(result.triggered).toBe(false);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('在时间窗口且今天已触发 — 返回 alreadyDone=true, triggered=false', async () => {
    vi.setSystemTime(new Date('2026-04-28T18:00:00Z'));
    mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const result = await scheduleDailyBackup(mockPool);
    expect(result.inWindow).toBe(true);
    expect(result.triggered).toBe(false);
    expect(result.alreadyDone).toBe(true);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('在时间窗口且今天未触发 — 创建 trigger_backup 任务', async () => {
    vi.setSystemTime(new Date('2026-04-28T18:00:00Z'));
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'mock-backup-task-id' }] });

    const result = await scheduleDailyBackup(mockPool);
    expect(result.inWindow).toBe(true);
    expect(result.triggered).toBe(true);
    expect(result.alreadyDone).toBe(false);
    expect(result.taskId).toBe('mock-backup-task-id');
    expect(mockPool.query).toHaveBeenCalledTimes(2);

    // 验证 INSERT SQL 包含正确的 task_type
    const insertCall = mockPool.query.mock.calls[1];
    expect(insertCall[0]).toContain('trigger_backup');
  });

  it('force=true — 跳过时间窗口检查，直接触发', async () => {
    vi.setSystemTime(new Date('2026-04-28T12:00:00Z'));
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'forced-task-id' }] });

    const result = await scheduleDailyBackup(mockPool, { force: true });
    expect(result.triggered).toBe(true);
    expect(result.taskId).toBe('forced-task-id');
  });

  it('force=true 但今天已触发 — 返回 alreadyDone=true', async () => {
    vi.setSystemTime(new Date('2026-04-28T12:00:00Z'));
    mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const result = await scheduleDailyBackup(mockPool, { force: true });
    expect(result.triggered).toBe(false);
    expect(result.alreadyDone).toBe(true);
  });
});
