/**
 * quarantine-block 单元测试
 * 验证 BILLING_CAP / RATE_LIMIT 失败时触发 blockTask 而非 quarantine
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ── mock 区 ──────────────────────────────────────────────

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

const mockEmit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../event-bus.js', () => ({ emit: mockEmit }));

// task-updater blockTask mock — hoisted
const mockBlockTask = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, task: { id: 'task-001', status: 'blocked' } }));
const mockUnblockTask = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, task: { id: 'task-001', status: 'queued' } }));
const mockUnblockExpiredTasks = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('../task-updater.js', () => ({
  blockTask: mockBlockTask,
  unblockTask: mockUnblockTask,
  unblockExpiredTasks: mockUnblockExpiredTasks,
}));

// ── 导入被测模块 ──────────────────────────────────────────
// isolate:false 修复：不在顶层 await import，改为 beforeAll + vi.resetModules()
let handleTaskFailure, FAILURE_CLASS;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../quarantine.js');
  handleTaskFailure = mod.handleTaskFailure;
  FAILURE_CLASS = mod.FAILURE_CLASS;
});

// ── 辅助函数 ────────────────────────────────────────────

function makeTaskPayload(errorStr) {
  return JSON.stringify({
    failure_count: 0,
    error_details: errorStr,
  });
}

function mockTaskQuery(taskId, errorStr) {
  mockPool.query
    // SELECT task
    .mockResolvedValueOnce({
      rows: [{
        id: taskId,
        title: '测试任务',
        status: 'in_progress',
        task_type: 'dev',
        payload: { failure_count: 0, error_details: errorStr },
        prd_content: '',
        description: '',
      }],
    })
    // UPDATE failure_count
    .mockResolvedValueOnce({ rows: [] });
}

// ── 测试 ─────────────────────────────────────────────────

describe('handleTaskFailure — blocked 联动', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('BILLING_CAP 错误 → 调用 blockTask 而非 quarantineTask', async () => {
    mockTaskQuery('task-001', 'spending cap reached, resets 11pm');

    const result = await handleTaskFailure('task-001');

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('billing_cap');
    expect(mockBlockTask).toHaveBeenCalledOnce();
    const [taskId, opts] = mockBlockTask.mock.calls[0];
    expect(taskId).toBe('task-001');
    expect(opts.reason).toBe('billing_cap');
    expect(opts.until).toBeInstanceOf(Date);
  });

  it('RATE_LIMIT 错误 → 调用 blockTask，5 分钟超时', async () => {
    const before = Date.now();
    mockTaskQuery('task-001', 'too many requests 429');

    const result = await handleTaskFailure('task-001');

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('rate_limit');
    expect(mockBlockTask).toHaveBeenCalledOnce();
    const [, opts] = mockBlockTask.mock.calls[0];
    expect(opts.reason).toBe('rate_limit');
    // blocked_until 应在 4~6 分钟之间
    const untilMs = opts.until.getTime();
    expect(untilMs - before).toBeGreaterThan(4 * 60 * 1000);
    expect(untilMs - before).toBeLessThan(6 * 60 * 1000);
  });

  it('TASK_ERROR → 不调用 blockTask，走普通失败流程', async () => {
    mockTaskQuery('task-001', 'syntax error at line 5');
    // 不需要 quarantine（failure_count=1 < threshold=3）

    const result = await handleTaskFailure('task-001');

    expect(result.blocked).toBeUndefined();
    expect(result.quarantined).toBe(false);
    expect(mockBlockTask).not.toHaveBeenCalled();
  });

  it('AUTH 错误 → 不调用 blockTask，走普通失败/隔离流程', async () => {
    mockTaskQuery('task-001', 'permission denied EACCES');

    const result = await handleTaskFailure('task-001');

    expect(result.blocked).toBeUndefined();
    expect(mockBlockTask).not.toHaveBeenCalled();
  });
});
