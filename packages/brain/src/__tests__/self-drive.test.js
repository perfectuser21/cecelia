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

vi.mock('../dopamine.js', () => ({
  getRewardScore: vi.fn().mockResolvedValue({ score: 1.5, count: 3, breakdown: { positive: 2.0, negative: -0.5 } }),
}));

vi.mock('../proactive-mouth.js', () => ({
  sendProactiveMessage: vi.fn().mockResolvedValue({ sent: true, message: '测试消息' }),
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
        // Mock: getKRProgress
        .mockResolvedValueOnce({ rows: [{ id: 'kr-1', title: 'KR 测试', status: 'in_progress', progress: 40, type: 'area_kr' }] })
        // Mock: getTaskStats24h
        .mockResolvedValueOnce({ rows: [{ completed: '5', failed: '1', total: '8' }] })
        // Mock: getActiveProjects
        .mockResolvedValueOnce({ rows: [{ id: 'proj-1', name: '测试项目', status: 'active', sequence_order: 1 }] })
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

    it('should skip when no probe/scan data and record no_action event', async () => {
      const pool = (await import('../db.js')).default;

      pool.query
        .mockResolvedValueOnce({ rows: [] }) // no probe
        .mockResolvedValueOnce({ rows: [] }) // no scan
        .mockResolvedValueOnce({ rows: [] }) // no tasks
        .mockResolvedValueOnce({ rows: [] }) // no KR progress
        .mockResolvedValueOnce({ rows: [{ completed: '0', failed: '0', total: '0' }] }) // no task stats
        .mockResolvedValueOnce({ rows: [] }) // no projects
        .mockResolvedValueOnce({ rows: [] }); // recordEvent INSERT

      const { runSelfDrive } = await import('../self-drive.js');
      const result = await runSelfDrive();

      expect(result.reason).toBe('no_data');

      // Verify no_action event was recorded so self_drive_health probe counts the cycle
      const insertCall = pool.query.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('self_drive') && sql.includes('INSERT')
      );
      expect(insertCall).toBeDefined();
      const payload = JSON.parse(insertCall[1][0]);
      expect(payload.subtype).toBe('no_action');
      expect(payload.reason).toBe('no_probe_scan_data');
    });

    it('should handle adjustment actions (adjust_priority, pause_kr, activate_kr, update_roadmap)', async () => {
      const pool = (await import('../db.js')).default;
      const { callLLM } = await import('../llm-caller.js');

      // Override LLM mock to return adjustment actions
      callLLM.mockResolvedValueOnce({
        text: JSON.stringify({
          reasoning: '需要调整优先级和暂停低价值 KR',
          actions: [
            { type: 'adjust_priority', project_id: 'proj-001', new_sequence: 1, reason: '紧急项目需要提前' },
            { type: 'pause_kr', kr_id: 'kr-001', reason: '资源不足暂停' },
          ],
        }),
      });

      pool.query
        // getLatestProbeResults
        .mockResolvedValueOnce({ rows: [{ payload: { probes: [{ name: 'db', ok: true }] } }] })
        // getLatestScanResults
        .mockResolvedValueOnce({ rows: [{ payload: { summary: { total: 10, active: 5, island: 5, dormant: 0, failing: 0 }, capabilities: [] } }] })
        // getExistingAutoTasks
        .mockResolvedValueOnce({ rows: [] })
        // UPDATE projects (adjust_priority)
        .mockResolvedValueOnce({ rows: [] })
        // INSERT decision_log (adjust_priority)
        .mockResolvedValueOnce({ rows: [] })
        // UPDATE goals (pause_kr)
        .mockResolvedValueOnce({ rows: [] })
        // INSERT decision_log (pause_kr)
        .mockResolvedValueOnce({ rows: [] })
        // recordEvent
        .mockResolvedValueOnce({ rows: [] });

      const { runSelfDrive } = await import('../self-drive.js');
      const result = await runSelfDrive();

      expect(result.reason).toBe('ok');
      expect(result.adjustments).toHaveLength(2);
      expect(result.adjustments[0].type).toBe('adjust_priority');
      expect(result.adjustments[1].type).toBe('pause_kr');
    });

    it('should limit adjustment actions to MAX_ADJUSTMENT_ACTIONS (2)', async () => {
      const pool = (await import('../db.js')).default;
      const { callLLM } = await import('../llm-caller.js');

      // Override LLM mock to return 3 adjustment actions (should only execute 2)
      callLLM.mockResolvedValueOnce({
        text: JSON.stringify({
          reasoning: '多项调整',
          actions: [
            { type: 'adjust_priority', project_id: 'proj-001', new_sequence: 1, reason: '调整1' },
            { type: 'pause_kr', kr_id: 'kr-001', reason: '调整2' },
            { type: 'activate_kr', kr_id: 'kr-002', reason: '调整3（应被跳过）' },
          ],
        }),
      });

      pool.query
        .mockResolvedValueOnce({ rows: [{ payload: { probes: [{ name: 'db', ok: true }] } }] })
        .mockResolvedValueOnce({ rows: [{ payload: { summary: { total: 10, active: 5, island: 5, dormant: 0, failing: 0 }, capabilities: [] } }] })
        .mockResolvedValueOnce({ rows: [] })
        // adjust_priority UPDATE + decision_log INSERT
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        // pause_kr UPDATE + decision_log INSERT
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        // recordEvent
        .mockResolvedValueOnce({ rows: [] });

      const { runSelfDrive } = await import('../self-drive.js');
      const result = await runSelfDrive();

      expect(result.adjustments).toHaveLength(2);
      // 第 3 个调整应被跳过
    });

    it('should record adjustment actions to decision_log', async () => {
      const pool = (await import('../db.js')).default;
      const { callLLM } = await import('../llm-caller.js');

      callLLM.mockResolvedValueOnce({
        text: JSON.stringify({
          reasoning: '更新路线图',
          actions: [
            { type: 'update_roadmap', project_id: 'proj-001', phase: 'now', reason: '该项目需要立即执行' },
          ],
        }),
      });

      pool.query
        .mockResolvedValueOnce({ rows: [{ payload: { probes: [{ name: 'db', ok: true }] } }] })
        .mockResolvedValueOnce({ rows: [{ payload: { summary: { total: 5, active: 5, island: 0, dormant: 0, failing: 0 }, capabilities: [] } }] })
        .mockResolvedValueOnce({ rows: [] })
        // UPDATE projects (update_roadmap)
        .mockResolvedValueOnce({ rows: [] })
        // INSERT decision_log
        .mockResolvedValueOnce({ rows: [] })
        // recordEvent
        .mockResolvedValueOnce({ rows: [] });

      const { runSelfDrive } = await import('../self-drive.js');
      const result = await runSelfDrive();

      expect(result.adjustments).toHaveLength(1);
      expect(result.adjustments[0].phase).toBe('now');

      // 验证 decision_log 被调用（第 5 次 query 调用）
      const decisionLogCall = pool.query.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('decision_log')
      );
      expect(decisionLogCall).toBeTruthy();
      expect(decisionLogCall[1][0]).toBe('self_drive');
    });

    it('should send feishu notification when actions are taken', async () => {
      const pool = (await import('../db.js')).default;
      const { createTask } = await import('../actions.js');
      const { sendProactiveMessage } = await import('../proactive-mouth.js');

      pool.query
        .mockResolvedValueOnce({
          rows: [{
            payload: {
              probes: [{ name: 'db', ok: true }],
            },
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            payload: {
              summary: { total: 10, active: 5, island: 5, dormant: 0, failing: 0 },
              capabilities: [{ id: 'test', name: 'Test', status: 'island', stage: 1 }],
            },
          }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'kr-1', title: 'KR', status: 'in_progress', progress: 40, type: 'area_kr' }] })
        .mockResolvedValueOnce({ rows: [{ completed: '5', failed: '1', total: '8' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'proj-1', name: 'Proj', status: 'active', sequence_order: 1 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'goal-1' }] })
        .mockResolvedValueOnce({ rows: [] });

      const { runSelfDrive } = await import('../self-drive.js');
      const result = await runSelfDrive();

      expect(result.reason).toBe('ok');
      expect(result.actions.length).toBeGreaterThan(0);
      // 验证 sendProactiveMessage 被调用
      expect(sendProactiveMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          contextType: 'proactive',
          importance: 0.7,
        })
      );
    });

    it('should not send feishu notification when no actions', async () => {
      const pool = (await import('../db.js')).default;
      const { callLLM } = await import('../llm-caller.js');
      const { sendProactiveMessage } = await import('../proactive-mouth.js');

      callLLM.mockResolvedValueOnce({
        text: JSON.stringify({
          reasoning: '当前状态良好',
          actions: [],
        }),
      });

      pool.query
        .mockResolvedValueOnce({ rows: [{ payload: { probes: [{ name: 'db', ok: true }] } }] })
        .mockResolvedValueOnce({ rows: [{ payload: { summary: { total: 5, active: 5, island: 0, dormant: 0, failing: 0 }, capabilities: [] } }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ completed: '3', failed: '0', total: '3' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { runSelfDrive } = await import('../self-drive.js');
      const result = await runSelfDrive();

      expect(result.reason).toBe('no_action_needed');
      expect(sendProactiveMessage).not.toHaveBeenCalled();
    });
  });

  describe('getSelfDriveStatus', () => {
    it('should return status', async () => {
      const { getSelfDriveStatus } = await import('../self-drive.js');
      const status = getSelfDriveStatus();

      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('interval_ms');
      expect(status).toHaveProperty('max_tasks_per_cycle');
      expect(status).toHaveProperty('started_at'); // in-memory loop start time for probe grace fallback
    });
  });
});
