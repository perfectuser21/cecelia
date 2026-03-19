import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock('../actions.js', () => ({
  createTask: vi.fn().mockResolvedValue('test-task-id'),
}));

vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({
    text: JSON.stringify({
      reasoning: 'Scanner 无法识别内嵌能力，需要修复',
      actions: [
        {
          title: '修复 Scanner 对内嵌能力的识别',
          description: '让 Scanner 能识别不通过 tasks 表运行的能力',
          task_type: 'dev',
          priority: 'P2',
          area: 'cecelia',
        },
      ],
    }),
  }),
}));

describe('self-drive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runSelfDrive', () => {
    it('should read probe and scan data, call LLM, and create tasks', async () => {
      const pool = (await import('../db.js')).default;
      const { createTask } = await import('../actions.js');

      // Mock: getLatestProbeResults
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            payload: {
              probes: [
                { name: 'db', ok: true },
                { name: 'dispatch', ok: true },
              ],
            },
          }],
        })
        // Mock: getLatestScanResults
        .mockResolvedValueOnce({
          rows: [{
            payload: {
              summary: { total: 37, active: 7, island: 30, dormant: 0, failing: 0 },
              capabilities: [
                { id: 'test', name: 'Test', status: 'island', stage: 1 },
              ],
            },
          }],
        })
        // Mock: getExistingAutoTasks
        .mockResolvedValueOnce({ rows: [] })
        // Mock: dedup check (similar title)
        .mockResolvedValueOnce({ rows: [] })
        // Mock: getGoalIdForArea('cecelia')
        .mockResolvedValueOnce({ rows: [{ id: 'goal-cecelia-001' }] })
        // Mock: recordEvent
        .mockResolvedValueOnce({ rows: [] });

      const { runSelfDrive } = await import('../self-drive.js');
      const result = await runSelfDrive();

      expect(result).toHaveProperty('actions');
      expect(result.reason).toBe('ok');
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ goal_id: 'goal-cecelia-001' })
      );
    });

    it('should skip when no probe/scan data', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({ rows: [] }) // no probe
        .mockResolvedValueOnce({ rows: [] }) // no scan
        .mockResolvedValueOnce({ rows: [] }); // no tasks

      const { runSelfDrive } = await import('../self-drive.js');
      const result = await runSelfDrive();

      expect(result.reason).toBe('no_data');
    });
  });

  describe('getSelfDriveStatus', () => {
    it('should return status', async () => {
      const { getSelfDriveStatus } = await import('../self-drive.js');
      const status = getSelfDriveStatus();

      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('interval_ms');
      expect(status).toHaveProperty('max_tasks_per_cycle');
    });
  });
});
