/**
 * quarantine-billing-pause 单元测试
 *
 * 验证 BILLING_CAP 失败时 quarantine 路径同步触发全局熔断：
 * D1: BILLING_CAP → blockTask 被调用（个体阻塞）
 * D2: BILLING_CAP → setBillingPause 被调用（全局熔断）
 * D3: RATE_LIMIT → setBillingPause 不被调用（只阻塞不熔断）
 * D4: 普通错误 → setBillingPause 不被调用
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ── mock 区 ──────────────────────────────────────────────

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

const mockEmit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../event-bus.js', () => ({ emit: mockEmit }));

const mockBlockTask = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, task: { id: 'task-001', status: 'blocked' } }));
vi.mock('../task-updater.js', () => ({
  blockTask: mockBlockTask,
  unblockTask: vi.fn(),
  unblockExpiredTasks: vi.fn(),
}));

const mockSetBillingPause = vi.hoisted(() => vi.fn());
const mockGetBillingPause = vi.hoisted(() => vi.fn(() => ({ active: false })));
vi.mock('../executor.js', () => ({
  setBillingPause: mockSetBillingPause,
  getBillingPause: mockGetBillingPause,
  clearBillingPause: vi.fn(),
  triggerCeceliaRun: vi.fn(),
  checkCeceliaRunAvailable: vi.fn(),
  getActiveProcessCount: vi.fn(() => 0),
  getActiveProcesses: vi.fn(() => []),
  killProcess: vi.fn(),
  checkServerResources: vi.fn(() => ({ ok: true })),
  probeTaskLiveness: vi.fn(),
  syncOrphanTasksOnStartup: vi.fn(),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 4,
  INTERACTIVE_RESERVE: 2,
  recordHeartbeat: vi.fn(),
  removeActiveProcess: vi.fn(),
  resolveRepoPath: vi.fn(),
}));

// ── 导入被测模块 ──────────────────────────────────────────
let handleTaskFailure;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../quarantine.js');
  handleTaskFailure = mod.handleTaskFailure;
});

// ── 辅助函数 ────────────────────────────────────────────

function mockTaskQuery(taskId, errorStr) {
  mockPool.query
    // 1) hasActiveCheckpoint: 无活跃 checkpoint
    .mockResolvedValueOnce({ rows: [] })
    // 2) hasActivePr: pr_url=NULL 表示没有 in-flight PR
    .mockResolvedValueOnce({ rows: [{ pr_url: null, pr_status: null }] })
    // 3) SELECT task
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
    // 4) UPDATE failure_count
    .mockResolvedValueOnce({ rows: [] });
}

// ── 测试 ─────────────────────────────────────────────────

describe('handleTaskFailure — BILLING_CAP 触发全局熔断', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockBlockTask.mockResolvedValue({ success: true, task: { id: 'task-001', status: 'blocked' } });
    mockEmit.mockResolvedValue(undefined);
  });

  it('D1+D2: BILLING_CAP → blockTask 被调用 + setBillingPause 被调用', async () => {
    mockTaskQuery('task-001', 'spending cap reached, resets 11pm');

    const result = await handleTaskFailure('task-001');

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('billing_cap');

    // 个体阻塞
    expect(mockBlockTask).toHaveBeenCalledOnce();
    expect(mockBlockTask.mock.calls[0][0]).toBe('task-001');
    expect(mockBlockTask.mock.calls[0][1].reason).toBe('billing_cap');

    // 全局熔断
    expect(mockSetBillingPause).toHaveBeenCalledOnce();
    const [resetTimeISO, reason] = mockSetBillingPause.mock.calls[0];
    expect(typeof resetTimeISO).toBe('string');
    expect(new Date(resetTimeISO).getTime()).toBeGreaterThan(Date.now());
    expect(reason).toBe('billing_cap');
  });

  it('D2: setBillingPause resetTime 来自 parseResetTime（与 blockTask until 一致）', async () => {
    mockTaskQuery('task-001', 'spending cap reached resets in 2 hours');

    await handleTaskFailure('task-001');

    expect(mockSetBillingPause).toHaveBeenCalledOnce();
    const [resetTimeISO] = mockSetBillingPause.mock.calls[0];
    const blockUntil = mockBlockTask.mock.calls[0][1].until;

    // setBillingPause 的时间应和 blockTask until 一致（同一个 resetTime 对象）
    expect(resetTimeISO).toBe(blockUntil.toISOString());
  });

  it('D3: RATE_LIMIT → setBillingPause 不被调用', async () => {
    mockTaskQuery('task-001', 'too many requests 429');

    const result = await handleTaskFailure('task-001');

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('rate_limit');
    expect(mockSetBillingPause).not.toHaveBeenCalled();
  });

  it('D4: 普通错误 → setBillingPause 不被调用', async () => {
    mockTaskQuery('task-001', 'syntax error at line 5');

    const result = await handleTaskFailure('task-001');

    expect(result.quarantined).toBe(false);
    expect(mockSetBillingPause).not.toHaveBeenCalled();
  });
});
