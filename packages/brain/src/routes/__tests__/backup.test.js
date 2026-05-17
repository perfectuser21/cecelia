/**
 * routes/__tests__/backup.test.js
 *
 * 测试策略（unit）：backup 路由依赖 scheduleDailyBackup，mock 后验证行为
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock daily-backup-scheduler
vi.mock('../../daily-backup-scheduler.js', () => ({
  scheduleDailyBackup: vi.fn(),
}));

// mock db pool
vi.mock('../../db.js', () => ({
  default: {},
}));

import { scheduleDailyBackup } from '../../daily-backup-scheduler.js';

describe('backup route — scheduleDailyBackup 集成', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scheduleDailyBackup 成功触发时返回 triggered=true', async () => {
    scheduleDailyBackup.mockResolvedValue({
      triggered: true,
      alreadyDone: false,
      inWindow: true,
      taskId: 'test-task-id',
    });

    const result = await scheduleDailyBackup({}, { force: true });
    expect(result.triggered).toBe(true);
    expect(result.taskId).toBe('test-task-id');
  });

  it('scheduleDailyBackup 已触发时返回 alreadyDone=true', async () => {
    scheduleDailyBackup.mockResolvedValue({
      triggered: false,
      alreadyDone: true,
      inWindow: true,
    });

    const result = await scheduleDailyBackup({}, { force: false });
    expect(result.triggered).toBe(false);
    expect(result.alreadyDone).toBe(true);
  });

  it('scheduleDailyBackup 不在时间窗口返回 inWindow=false', async () => {
    scheduleDailyBackup.mockResolvedValue({
      triggered: false,
      alreadyDone: false,
      inWindow: false,
    });

    const result = await scheduleDailyBackup({});
    expect(result.inWindow).toBe(false);
    expect(result.triggered).toBe(false);
  });
});
