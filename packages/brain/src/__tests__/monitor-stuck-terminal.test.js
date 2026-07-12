/**
 * monitor-stuck-terminal.test.js — bug2 回归：completed 任务不可被 stuck 处置打回 queued
 * 实证：issue 219a9efc / _ghost_audit record4 / run 1181b7f7 (MONITOR_RESTART 08:10:14)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

const mockUpdateTask = vi.hoisted(() => vi.fn());
vi.mock('../actions.js', () => ({ updateTask: mockUpdateTask }));

vi.mock('../rca-deduplication.js', () => ({
  shouldAnalyzeFailure: vi.fn(),
  cacheRcaResult: vi.fn(),
  getRcaCacheStats: vi.fn(),
  generateErrorSignature: vi.fn().mockReturnValue('sig'),
}));
vi.mock('../auto-fix.js', () => ({
  shouldAutoFix: vi.fn(),
  dispatchToDevSkill: vi.fn(),
  getAutoFixStats: vi.fn(),
}));
vi.mock('../policy-validator.js', () => ({ validatePolicyJson: vi.fn() }));
vi.mock('../executor.js', () => ({ getActiveProcessCount: vi.fn(), MAX_SEATS: 10 }));
vi.mock('../quarantine.js', () => ({ quarantineTask: vi.fn() }));
vi.mock('../cortex.js', () => ({ performRCA: vi.fn() }));

const { handleStuckRun } = await import('../monitor-loop.js');

const STUCK = {
  run_id: 'run-1',
  task_id: 'task-1',
  minutes_since_heartbeat: '6.0',
};

describe('handleStuckRun 终态调和', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    mockUpdateTask.mockReset();
  });

  it('completed 任务：不 requeue，关闭 stale run 为 reconciled', async () => {
    // 第一问：retry_count + status
    mockPool.query.mockResolvedValueOnce({ rows: [{ retry_count: 0, status: 'completed' }] });
    // 后续 UPDATE run_events
    mockPool.query.mockResolvedValue({ rows: [] });

    await handleStuckRun(STUCK);

    expect(mockUpdateTask).not.toHaveBeenCalled();
    const runClose = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('MONITOR_STALE_RUN_RECONCILED')
    );
    expect(runClose).toBeTruthy();
  });

  it('cancelled/failed 任务同样不 requeue', async () => {
    for (const s of ['cancelled', 'failed']) {
      mockPool.query.mockReset();
      mockUpdateTask.mockReset();
      mockPool.query.mockResolvedValueOnce({ rows: [{ retry_count: 0, status: s }] });
      mockPool.query.mockResolvedValue({ rows: [] });

      await handleStuckRun(STUCK);
      expect(mockUpdateTask).not.toHaveBeenCalled();
    }
  });

  it('in_progress 任务保持原重启行为（1st stuck → requeue）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ retry_count: 0, status: 'in_progress' }] });
    // task_type 查询（非 harness）
    mockPool.query.mockResolvedValueOnce({ rows: [{ task_type: 'strategist_decision', payload: {} }] });
    mockPool.query.mockResolvedValue({ rows: [] });
    mockUpdateTask.mockResolvedValue({ success: true });

    await handleStuckRun(STUCK);

    expect(mockUpdateTask).toHaveBeenCalledWith({ task_id: 'task-1', status: 'queued' });
  });
});
