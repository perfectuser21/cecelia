/**
 * 回归测试：harness_initiative 任务在 cecelia-bridge 不可用时仍应被派发
 *
 * Bug：dispatcher 对所有任务都检查 bridge 是否存活，
 * 但 harness_initiative 走 Docker spawn 路径，完全不需要 bridge。
 * bridge 不在 → 任务被错误 revert 到 queued，pipeline 永远无法启动。
 *
 * 修法：在 checkCeceliaRunAvailable 之前，跳过 harness_initiative。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
    backpressure: null,
    budgetState: { state: 'abundant' },
  }),
  shouldBypassBackpressure: vi.fn(() => false),
}));

vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn().mockReturnValue(true),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  getAllStates: vi.fn().mockReturnValue({}),
}));

vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn().mockReturnValue({ p2_paused: false, drain_mode_requested: false }),
}));

vi.mock('../actions.js', () => ({
  updateTask: vi.fn().mockResolvedValue({ success: true, task: { id: 'task-harness-1', status: 'in_progress' } }),
  createTask: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));

const mockTriggerCeceliaRun = vi.fn().mockResolvedValue({ success: true, taskId: 'task-harness-1' });
const mockCheckCeceliaRunAvailable = vi.fn().mockResolvedValue({ available: false, error: 'Bridge not running' });

vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: (...args) => mockCheckCeceliaRunAvailable(...args),
  canDispatch: vi.fn().mockReturnValue(true),
  isDraining: vi.fn().mockReturnValue(false),
  getDrainStartedAt: vi.fn().mockReturnValue(null),
  isGlobalQuotaCooling: vi.fn().mockReturnValue(false),
  getQuotaCoolingState: vi.fn().mockReturnValue({}),
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
  checkQuotaGuard: vi.fn().mockResolvedValue({ allow: true }),
  killProcessTwoStage: vi.fn().mockResolvedValue({ killed: false }),
  XIAN_CODEX_BRIDGE_URL: 'http://xian:3458',
  XIAN_M1_BRIDGE_URL: 'http://xian-m1:3458',
}));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../emit.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../tick-logger.js', () => ({
  tickLog: vi.fn(),
  logTickDecision: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../dispatch-result-recorder.js', () => ({
  recordDispatchResult: vi.fn().mockResolvedValue(undefined),
}));

const HARNESS_TASK = {
  id: 'task-harness-1',
  title: 'GET /api/brain/harness/runs/:id',
  task_type: 'harness_initiative',
  status: 'queued',
  priority: 'P1',
  goal_id: null,
  project_id: null,
  payload: { sprint_dir: 'sprints/test', base_repo: '/repo' },
};

describe('harness_initiative bridge bypass (Bug 回归)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCeceliaRunAvailable.mockResolvedValue({ available: false, error: 'Bridge not running' });
    mockTriggerCeceliaRun.mockResolvedValue({ success: true, taskId: 'task-harness-1' });

    // DB: claim + full task fetch
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-harness-1' }] })  // C1 claim
      .mockResolvedValueOnce({ rows: [HARNESS_TASK] });              // full task fetch
  });

  it('bridge 不可用时 harness_initiative 仍被派发（不走 bridge guard）', async () => {
    const { dispatchNextTask } = await import('../dispatcher.js');

    const result = await dispatchNextTask(['goal-1']);

    // harness_initiative 应该绕过 bridge 检查，直接到达 triggerCeceliaRun
    expect(mockTriggerCeceliaRun).toHaveBeenCalledWith(
      expect.objectContaining({ task_type: 'harness_initiative' })
    );
    expect(result.dispatched).toBe(true);
  });

  it('bridge 不可用时普通 dev 任务仍被拦截', async () => {
    const DEV_TASK = { ...HARNESS_TASK, task_type: 'dev', id: 'task-dev-1', title: 'dev task' };
    mockQuery
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ id: 'task-dev-1' }] })
      .mockResolvedValueOnce({ rows: [DEV_TASK] });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('no_executor');
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
  });
});
