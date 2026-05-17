import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isInSmokeWindow,
  hasTodaySmoke,
  createSmokeTask,
  findFailedStage,
  assertSmokeOutput,
  handleSmokeFailure,
  archiveOldSmokePipelines,
  runDailySmoke,
  waitAndAssertSmoke,
  SMOKE_HOUR_UTC,
  MIN_IMAGES,
  ARCHIVE_AFTER_DAYS,
} from '../daily-real-business-smoke.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock 外部依赖
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
  };
});

import { raise } from '../../alerting.js';
import { existsSync, readdirSync } from 'fs';

// ─────────────────────────────────────────────────────────────────────────────
// isInSmokeWindow
// ─────────────────────────────────────────────────────────────────────────────

describe('isInSmokeWindow', () => {
  it('UTC 20:00 在窗口内', () => {
    const d = new Date('2026-04-27T20:00:00Z');
    expect(isInSmokeWindow(d)).toBe(true);
  });

  it('UTC 20:04 在窗口内', () => {
    const d = new Date('2026-04-27T20:04:59Z');
    expect(isInSmokeWindow(d)).toBe(true);
  });

  it('UTC 20:05 在窗口外', () => {
    const d = new Date('2026-04-27T20:05:00Z');
    expect(isInSmokeWindow(d)).toBe(false);
  });

  it('UTC 04:00 不触发（错误时区）', () => {
    const d = new Date('2026-04-27T04:00:00Z');
    expect(isInSmokeWindow(d)).toBe(false);
  });

  it('UTC 19:59 不触发', () => {
    const d = new Date('2026-04-27T19:59:00Z');
    expect(isInSmokeWindow(d)).toBe(false);
  });

  it('窗口小时等于 SMOKE_HOUR_UTC', () => {
    // 设置到精确触发时刻
    const onHour = new Date(`2026-04-27T${String(SMOKE_HOUR_UTC).padStart(2, '0')}:00:00Z`);
    expect(isInSmokeWindow(onHour)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasTodaySmoke
// ─────────────────────────────────────────────────────────────────────────────

describe('hasTodaySmoke', () => {
  it('今天已有记录 → 返回 true', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'abc' }] }) };
    const now = new Date('2026-04-27T20:01:00Z');
    expect(await hasTodaySmoke(mockPool, now)).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('brain_cron_daily_smoke'),
      ['2026-04-27']
    );
  });

  it('今天无记录 → 返回 false', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    expect(await hasTodaySmoke(mockPool, new Date('2026-04-27T20:01:00Z'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createSmokeTask
// ─────────────────────────────────────────────────────────────────────────────

describe('createSmokeTask', () => {
  it('INSERT 成功 → 返回 task_id', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'task-123' }] }),
    };
    const now = new Date('2026-04-27T20:01:00Z');
    const id = await createSmokeTask(mockPool, now);

    expect(id).toBe('task-123');
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('content-pipeline');
    expect(sql).toContain('brain_cron_daily_smoke');
    expect(params[0]).toBe('[E2E daily smoke] 2026-04-27');
    const payload = JSON.parse(params[1]);
    expect(payload.content_type).toBe('solo-company-case');
    expect(payload.triggered_by).toBe('brain_cron_daily_smoke');
  });

  it('ON CONFLICT → 查询已有记录并返回', async () => {
    const mockPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })             // INSERT ON CONFLICT: 无新行
        .mockResolvedValueOnce({ rows: [{ id: 'existing-456' }] }),  // 查已有
    };
    const id = await createSmokeTask(mockPool, new Date('2026-04-27T20:01:00Z'));
    expect(id).toBe('existing-456');
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findFailedStage
// ─────────────────────────────────────────────────────────────────────────────

describe('findFailedStage', () => {
  it('research 失败 → 返回 content-research', () => {
    expect(findFailedStage({
      'content-research': { status: 'failed' },
      'content-copywriting': { status: 'queued' },
    })).toBe('content-research');
  });

  it('export 失败 → 返回 content-export', () => {
    expect(findFailedStage({
      'content-research': { status: 'completed' },
      'content-export': { status: 'failed' },
    })).toBe('content-export');
  });

  it('无失败 stage → 返回 null', () => {
    expect(findFailedStage({
      'content-research': { status: 'completed' },
      'content-export': { status: 'completed' },
    })).toBeNull();
  });

  it('空 stages → 返回 null', () => {
    expect(findFailedStage({})).toBeNull();
  });

  it('按顺序返回第一个 failed（research 优先于 export）', () => {
    expect(findFailedStage({
      'content-research': { status: 'failed' },
      'content-export': { status: 'failed' },
    })).toBe('content-research');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// assertSmokeOutput
// ─────────────────────────────────────────────────────────────────────────────

describe('assertSmokeOutput', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
  });

  it('export 完成 + 图片足够 → ok=true', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ task_type: 'content-export', status: 'completed', summary: null }],
      }),
    };
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(
      Array.from({ length: 9 }, (_, i) => `e2e-daily-smoke-2026-04-27-${i + 1}.png`)
    );

    const result = await assertSmokeOutput(mockPool, 'task-1', {
      keyword: '[E2E daily smoke] 2026-04-27',
    });
    expect(result.ok).toBe(true);
    expect(result.nasOk).toBe(true);
    expect(result.imageCount).toBe(9);
  });

  it('export 未完成 → ok=false，nasOk=false', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ task_type: 'content-export', status: 'in_progress', summary: null }],
      }),
    };
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(
      Array.from({ length: 9 }, (_, i) => `e2e-daily-smoke-2026-04-27-${i + 1}.png`)
    );

    const result = await assertSmokeOutput(mockPool, 'task-1', {
      keyword: '[E2E daily smoke] 2026-04-27',
    });
    expect(result.ok).toBe(false);
    expect(result.nasOk).toBe(false);
    expect(result.message).toContain('export stage');
  });

  it('图片不足 → ok=false，message 含图片数量', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ task_type: 'content-export', status: 'completed', summary: null }],
      }),
    };
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(
      Array.from({ length: 5 }, (_, i) => `e2e-daily-smoke-2026-04-27-${i + 1}.png`)
    );

    const result = await assertSmokeOutput(mockPool, 'task-1', {
      keyword: '[E2E daily smoke] 2026-04-27',
    });
    expect(result.ok).toBe(false);
    expect(result.imageCount).toBe(5);
    expect(result.message).toContain(`5/${MIN_IMAGES}`);
  });

  it('图片目录不存在 → imageCount=0', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ task_type: 'content-export', status: 'completed', summary: null }],
      }),
    };
    // existsSync = false（默认），readdirSync 不会被调用

    const result = await assertSmokeOutput(mockPool, 'task-1', {
      keyword: '[E2E daily smoke] 2026-04-27',
    });
    expect(result.ok).toBe(false);
    expect(result.imageCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleSmokeFailure
// ─────────────────────────────────────────────────────────────────────────────

describe('handleSmokeFailure', () => {
  beforeEach(() => {
    vi.mocked(raise).mockClear();
  });

  it('P0 告警 + 创建 dev task', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    await handleSmokeFailure(mockPool, 'task-999', 'pipeline failed', 'content-research');

    expect(raise).toHaveBeenCalledWith('P0', 'daily_smoke_failed', expect.stringContaining('content-research'));
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain("'dev'");
    expect(params[0]).toContain('smoke-alert');
    const payload = JSON.parse(params[1]);
    expect(payload.pipeline_id).toBe('task-999');
    expect(payload.failed_stage).toBe('content-research');
  });

  it('无 failedStage → 告警不含阶段信息', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await handleSmokeFailure(mockPool, 'task-1', '超时', null);

    expect(raise).toHaveBeenCalledWith('P0', 'daily_smoke_failed', expect.not.stringContaining('失败阶段'));
  });

  it('创建 task 失败时不抛出（只 console.error）', async () => {
    const mockPool = {
      query: vi.fn().mockRejectedValue(new Error('DB error')),
    };
    // 不应抛出
    await expect(handleSmokeFailure(mockPool, 'task-1', '失败', null)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// archiveOldSmokePipelines
// ─────────────────────────────────────────────────────────────────────────────

describe('archiveOldSmokePipelines', () => {
  it('成功 archive 旧记录', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rowCount: 3 }),
    };
    await archiveOldSmokePipelines(mockPool);
    const [sql] = mockPool.query.mock.calls[0];
    expect(sql).toContain('smoke-archived');
    expect(sql).toContain(`${ARCHIVE_AFTER_DAYS} days`);
  });

  it('无旧记录时静默通过', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rowCount: 0 }),
    };
    await expect(archiveOldSmokePipelines(mockPool)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runDailySmoke（调度入口）
// ─────────────────────────────────────────────────────────────────────────────

describe('runDailySmoke', () => {
  it('非触发窗口 → skipped_window=true', async () => {
    const mockPool = { query: vi.fn() };
    const outsideWindow = new Date('2026-04-27T12:00:00Z');
    const result = await runDailySmoke(mockPool, outsideWindow);

    expect(result.skipped_window).toBe(true);
    expect(result.triggered).toBe(false);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('触发窗口内 + 今天已跑 → skipped_today=true', async () => {
    const mockPool = {
      // hasTodaySmoke → 有记录; archiveOldSmokePipelines → 0 rowCount
      query: vi.fn()
        .mockResolvedValueOnce({ rowCount: 0 })       // archive
        .mockResolvedValueOnce({ rows: [{ id: 'x' }] }),  // hasTodaySmoke
    };
    const inWindow = new Date('2026-04-27T20:02:00Z');
    const result = await runDailySmoke(mockPool, inWindow);

    expect(result.skipped_today).toBe(true);
    expect(result.triggered).toBe(false);
  });

  it('触发窗口内 + 今天未跑 → triggered=true，返回 task_id', async () => {
    const mockPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rowCount: 0 })          // archive
        .mockResolvedValueOnce({ rows: [] })              // hasTodaySmoke → 未跑
        .mockResolvedValueOnce({ rows: [{ id: 'new-task-777' }] }),  // createSmokeTask
    };
    const inWindow = new Date('2026-04-27T20:01:00Z');
    const result = await runDailySmoke(mockPool, inWindow);

    expect(result.triggered).toBe(true);
    expect(result.task_id).toBe('new-task-777');
    expect(result.skipped_window).toBe(false);
    expect(result.skipped_today).toBe(false);
  });

  it('创建 task 失败 → P0 告警，triggered=false', async () => {
    vi.mocked(raise).mockClear();
    const mockPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rowCount: 0 })    // archive
        .mockResolvedValueOnce({ rows: [] })        // hasTodaySmoke
        .mockRejectedValueOnce(new Error('DB down')),  // createSmokeTask 失败
    };
    const inWindow = new Date('2026-04-27T20:01:00Z');
    const result = await runDailySmoke(mockPool, inWindow);

    expect(result.triggered).toBe(false);
    expect(result.error).toContain('DB down');
    expect(raise).toHaveBeenCalledWith('P0', 'daily_smoke_create_failed', expect.stringContaining('DB down'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// waitAndAssertSmoke（轮询断言）
// ─────────────────────────────────────────────────────────────────────────────

describe('waitAndAssertSmoke', () => {
  beforeEach(() => {
    vi.mocked(raise).mockClear();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.useFakeTimers();
  });

  it('pipeline completed + 断言通过 → 不告警', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(
      Array.from({ length: 9 }, (_, i) => `e2e-daily-smoke-2026-04-27-${i + 1}.png`)
    );

    const mockPool = {
      query: vi.fn()
        // getPipelineStatus → completed
        .mockResolvedValueOnce({ rows: [{ status: 'completed', payload: {} }] })
        // getPipelineStages (for assertSmokeOutput)
        .mockResolvedValueOnce({
          rows: [{ task_type: 'content-export', status: 'completed', summary: null }],
        }),
    };

    const promise = waitAndAssertSmoke(mockPool, 'task-ok', { keyword: '[E2E daily smoke] 2026-04-27' }, 60000);
    await vi.runAllTimersAsync();
    await promise;

    expect(raise).not.toHaveBeenCalled();
  });

  it('pipeline failed → P0 告警', async () => {
    const mockPool = {
      query: vi.fn()
        // getPipelineStatus → failed
        .mockResolvedValueOnce({ rows: [{ status: 'failed', payload: {} }] })
        // getPipelineStages (for findFailedStage)
        .mockResolvedValueOnce({
          rows: [{ task_type: 'content-research', status: 'failed', summary: null }],
        })
        // handleSmokeFailure: INSERT dev task
        .mockResolvedValueOnce({ rows: [] }),
    };

    const promise = waitAndAssertSmoke(mockPool, 'task-fail', {}, 60000);
    await vi.runAllTimersAsync();
    await promise;

    expect(raise).toHaveBeenCalledWith('P0', 'daily_smoke_failed', expect.stringContaining('content-research'));
  });

  it('超时 → P0 告警含"超时"', async () => {
    const mockPool = {
      query: vi.fn()
        // getPipelineStatus 每次都返回 in_progress（永远不完成）
        .mockResolvedValue({ rows: [{ status: 'in_progress', payload: {} }] }),
    };

    const MAX = 2000;  // 2s 超时方便测试
    const promise = waitAndAssertSmoke(mockPool, 'task-timeout', {}, MAX);
    await vi.runAllTimersAsync();
    await promise;

    expect(raise).toHaveBeenCalledWith('P0', 'daily_smoke_failed', expect.stringContaining('超时'));
  });
});
