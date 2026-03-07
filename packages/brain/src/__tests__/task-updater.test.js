/**
 * task-updater 单元测试（mock pool + mock events — 无需真实 DB）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock 区 ──────────────────────────────────────────────

const mockPool = { query: vi.fn() };

vi.mock('../db.js', () => ({ default: mockPool }));

const mockPublishTaskStarted = vi.fn();
const mockPublishTaskCompleted = vi.fn();
const mockPublishTaskFailed = vi.fn();
const mockPublishTaskProgress = vi.fn();

vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: mockPublishTaskStarted,
  publishTaskCompleted: mockPublishTaskCompleted,
  publishTaskFailed: mockPublishTaskFailed,
  publishTaskProgress: mockPublishTaskProgress,
}));

// ── 导入被测模块（必须在 vi.mock 之后）──────────────────

const { updateTaskStatus, updateTaskProgress, broadcastTaskState, blockTask, unblockTask } = await import('../task-updater.js');

// ── 辅助函数 ────────────────────────────────────────────

function makeTask(overrides = {}) {
  return {
    id: 'task-001',
    title: '测试任务',
    status: 'queued',
    payload: {},
    ...overrides,
  };
}

// ── 测试 ─────────────────────────────────────────────────

describe('task-updater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // updateTaskStatus
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('updateTaskStatus', () => {
    // -- 正常路径 --

    it('应当成功更新状态为 in_progress 并广播 TaskStarted', async () => {
      const task = makeTask({ status: 'in_progress' });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await updateTaskStatus('task-001', 'in_progress');

      expect(result.success).toBe(true);
      expect(result.task).toEqual(task);
      // SQL 应包含 started_at = NOW()
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('started_at = NOW()');
      expect(mockPublishTaskStarted).toHaveBeenCalledOnce();
    });

    it('应当成功更新状态为 completed 并广播 TaskCompleted', async () => {
      const task = makeTask({ status: 'completed', payload: { result: 'ok' } });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await updateTaskStatus('task-001', 'completed');

      expect(result.success).toBe(true);
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('completed_at = NOW()');
      expect(mockPublishTaskCompleted).toHaveBeenCalledOnce();
    });

    it('应当成功更新状态为 failed 并广播 TaskFailed', async () => {
      const task = makeTask({ status: 'failed', payload: { error: '超时' } });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await updateTaskStatus('task-001', 'failed');

      expect(result.success).toBe(true);
      expect(mockPublishTaskFailed).toHaveBeenCalledOnce();
    });

    it('应当成功更新状态为 queued 且有 progress 时广播 TaskProgress', async () => {
      const task = makeTask({ status: 'queued', payload: { progress: 50 } });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await updateTaskStatus('task-001', 'queued');

      expect(result.success).toBe(true);
      expect(mockPublishTaskProgress).toHaveBeenCalledOnce();
    });

    it('应当成功更新状态为 queued 且无 progress 时不广播 TaskProgress', async () => {
      const task = makeTask({ status: 'queued', payload: {} });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await updateTaskStatus('task-001', 'queued');

      expect(result.success).toBe(true);
      expect(mockPublishTaskProgress).not.toHaveBeenCalled();
    });

    // -- 附加字段 --

    it('应当正确合并白名单内的附加字段', async () => {
      const task = makeTask({ status: 'in_progress', assigned_to: 'agent-1' });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await updateTaskStatus('task-001', 'in_progress', {
        assigned_to: 'agent-1',
        priority: 'P0',
      });

      expect(result.success).toBe(true);
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('assigned_to = $3');
      expect(sql).toContain('priority = $4');
      const params = mockPool.query.mock.calls[0][1];
      expect(params).toEqual(['task-001', 'in_progress', 'agent-1', 'P0']);
    });

    it('应当合并 payload 字段为 JSONB', async () => {
      const task = makeTask({ status: 'in_progress', payload: { run_id: 'r1' } });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await updateTaskStatus('task-001', 'in_progress', {
        payload: { run_id: 'r1' },
      });

      expect(result.success).toBe(true);
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('COALESCE(payload');
      expect(sql).toContain('::jsonb');
      const params = mockPool.query.mock.calls[0][1];
      // payload 应被 JSON.stringify
      expect(params[2]).toBe(JSON.stringify({ run_id: 'r1' }));
    });

    it('应当忽略非白名单字段并继续执行', async () => {
      const task = makeTask({ status: 'in_progress' });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await updateTaskStatus('task-001', 'in_progress', {
        sql_injection: 'DROP TABLE',
      });

      expect(result.success).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring non-whitelisted column: sql_injection')
      );
      // SQL 不应包含 sql_injection
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).not.toContain('sql_injection');
      warnSpy.mockRestore();
    });

    // -- 错误路径 --

    it('应当拒绝无效 status', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await updateTaskStatus('task-001', 'invalid_status');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid status');
      expect(mockPool.query).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('应当处理任务不存在（返回空行）', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await updateTaskStatus('nonexistent', 'queued');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      errorSpy.mockRestore();
    });

    it('应当处理数据库查询异常', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPool.query.mockRejectedValueOnce(new Error('connection refused'));

      const result = await updateTaskStatus('task-001', 'queued');

      expect(result.success).toBe(false);
      expect(result.error).toContain('connection refused');
      errorSpy.mockRestore();
    });

    // -- 边界条件 --

    it('应当在无附加字段时正常工作', async () => {
      const task = makeTask({ status: 'queued' });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await updateTaskStatus('task-001', 'queued');

      expect(result.success).toBe(true);
      const params = mockPool.query.mock.calls[0][1];
      expect(params).toEqual(['task-001', 'queued']);
    });

    it('应当同时处理 payload 和其他白名单字段', async () => {
      const task = makeTask({ status: 'in_progress' });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await updateTaskStatus('task-001', 'in_progress', {
        payload: { step: 1 },
        assigned_to: 'dev-agent',
        error: 'partial failure',
      });

      expect(result.success).toBe(true);
      const params = mockPool.query.mock.calls[0][1];
      // params: [taskId, status, payload_json, assigned_to, error]
      expect(params.length).toBe(5);
      expect(params[0]).toBe('task-001');
      expect(params[1]).toBe('in_progress');
      expect(params[2]).toBe(JSON.stringify({ step: 1 }));
      expect(params[3]).toBe('dev-agent');
      expect(params[4]).toBe('partial failure');
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // updateTaskProgress
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('updateTaskProgress', () => {
    it('应当成功更新进度并广播', async () => {
      const task = makeTask({ status: 'in_progress', payload: { progress: 75, current_run_id: 'r1' } });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await updateTaskProgress('task-001', { progress: 75 });

      expect(result.success).toBe(true);
      expect(result.task).toEqual(task);
      // 检查 SQL 包含 COALESCE payload 合并
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('COALESCE(payload');
      // 参数应包含 JSON 字符串
      const params = mockPool.query.mock.calls[0][1];
      expect(params[0]).toBe('task-001');
      expect(params[1]).toBe(JSON.stringify({ progress: 75 }));
    });

    it('应当处理任务不存在', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await updateTaskProgress('nonexistent', { progress: 50 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      errorSpy.mockRestore();
    });

    it('应当处理数据库异常', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPool.query.mockRejectedValueOnce(new Error('timeout'));

      const result = await updateTaskProgress('task-001', { progress: 50 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
      errorSpy.mockRestore();
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // broadcastTaskState
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('broadcastTaskState', () => {
    it('应当查询任务并广播当前状态 (in_progress)', async () => {
      const task = makeTask({ status: 'in_progress', payload: { current_run_id: 'r1' } });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM tasks'),
        ['task-001']
      );
      expect(mockPublishTaskStarted).toHaveBeenCalledOnce();
    });

    it('应当查询任务并广播当前状态 (completed)', async () => {
      const task = makeTask({ status: 'completed', payload: { run_id: 'r2' } });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      expect(mockPublishTaskCompleted).toHaveBeenCalledOnce();
    });

    it('应当查询任务并广播当前状态 (failed)', async () => {
      const task = makeTask({ status: 'failed', payload: { error: '崩溃' } });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      expect(mockPublishTaskFailed).toHaveBeenCalledOnce();
    });

    it('应当在任务不存在时静默处理（不抛异常）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await broadcastTaskState('nonexistent');

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found for broadcast')
      );
      expect(mockPublishTaskStarted).not.toHaveBeenCalled();
      expect(mockPublishTaskCompleted).not.toHaveBeenCalled();
      expect(mockPublishTaskFailed).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('应当在数据库异常时静默处理', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('connection lost'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await broadcastTaskState('task-001');

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // broadcastTaskUpdate（内部函数，通过公开函数间接测试）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('broadcastTaskUpdate 行为（通过 broadcastTaskState 间接测试）', () => {
    it('应当从 payload.current_run_id 提取 runId', async () => {
      const task = makeTask({ status: 'in_progress', payload: { current_run_id: 'run-abc' } });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      expect(mockPublishTaskStarted).toHaveBeenCalledWith({
        id: 'task-001',
        run_id: 'run-abc',
        title: '测试任务',
      });
    });

    it('应当回退到 payload.run_id 当 current_run_id 不存在时', async () => {
      const task = makeTask({ status: 'in_progress', payload: { run_id: 'run-fallback' } });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      expect(mockPublishTaskStarted).toHaveBeenCalledWith({
        id: 'task-001',
        run_id: 'run-fallback',
        title: '测试任务',
      });
    });

    it('应当在 payload 为 null 时 runId 为 null', async () => {
      const task = makeTask({ status: 'in_progress', payload: null });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      expect(mockPublishTaskStarted).toHaveBeenCalledWith({
        id: 'task-001',
        run_id: null,
        title: '测试任务',
      });
    });

    it('应当将 failed 任务的 error 传递给 publishTaskFailed', async () => {
      const task = makeTask({ status: 'failed', payload: { error: '内存不足', run_id: 'r1' } });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      expect(mockPublishTaskFailed).toHaveBeenCalledWith('task-001', 'r1', '内存不足');
    });

    it('应当在 failed 且无 error 时使用默认 "Unknown error"', async () => {
      const task = makeTask({ status: 'failed', payload: {} });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      expect(mockPublishTaskFailed).toHaveBeenCalledWith('task-001', null, 'Unknown error');
    });

    it('应当对 completed 任务传递完整 payload 给 publishTaskCompleted', async () => {
      const payload = { result: 'success', artifacts: ['file.js'] };
      const task = makeTask({ status: 'completed', payload });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      expect(mockPublishTaskCompleted).toHaveBeenCalledWith('task-001', null, payload);
    });

    it('应当处理未知状态且有 progress + current_step 的情况', async () => {
      const task = makeTask({
        status: 'some_other_status',
        payload: { progress: true, current_step: '42' },
      });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      // default 分支：有 progress → publishTaskProgress
      expect(mockPublishTaskProgress).toHaveBeenCalledWith('task-001', null, 42);
    });

    it('应当对 current_step 为非数字时 progress 为 0', async () => {
      const task = makeTask({
        status: 'some_other_status',
        payload: { progress: true, current_step: 'abc' },
      });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      expect(mockPublishTaskProgress).toHaveBeenCalledWith('task-001', null, 0);
    });

    it('应当对 current_step 超过 100 时 clamp 到 100', async () => {
      const task = makeTask({
        status: 'some_other_status',
        payload: { progress: true, current_step: '200' },
      });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      expect(mockPublishTaskProgress).toHaveBeenCalledWith('task-001', null, 100);
    });

    it('应当对 current_step 为负数时 clamp 到 0', async () => {
      const task = makeTask({
        status: 'some_other_status',
        payload: { progress: true, current_step: '-10' },
      });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      expect(mockPublishTaskProgress).toHaveBeenCalledWith('task-001', null, 0);
    });

    it('应当对未知状态且无 progress 时不广播', async () => {
      const task = makeTask({
        status: 'some_other_status',
        payload: {},
      });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      expect(mockPublishTaskStarted).not.toHaveBeenCalled();
      expect(mockPublishTaskCompleted).not.toHaveBeenCalled();
      expect(mockPublishTaskFailed).not.toHaveBeenCalled();
      expect(mockPublishTaskProgress).not.toHaveBeenCalled();
    });

    it('应当对 default 分支无 current_step 时 progress 为 0', async () => {
      const task = makeTask({
        status: 'some_other_status',
        payload: { progress: 30 },
      });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await broadcastTaskState('task-001');

      // current_step 不存在 → progress = 0
      expect(mockPublishTaskProgress).toHaveBeenCalledWith('task-001', null, 0);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // blockTask
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('blockTask', () => {
    it('应当将 in_progress 任务改为 blocked 并设置 blocked 字段', async () => {
      const blockedUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const task = makeTask({ status: 'blocked', blocked_reason: 'rate_limit', blocked_until: blockedUntil });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await blockTask('task-001', 'rate_limit', blockedUntil);

      expect(result.success).toBe(true);
      expect(result.task.status).toBe('blocked');
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain("status = 'blocked'");
      expect(sql).toContain('blocked_at = NOW()');
      expect(sql).toContain('blocked_reason = $2');
      expect(sql).toContain('blocked_until = $3');
      // WHERE 子句限制只允许 in_progress 或 failed → blocked
      expect(sql).toContain("status IN ('in_progress', 'failed')");
      const params = mockPool.query.mock.calls[0][1];
      expect(params[0]).toBe('task-001');
      expect(params[1]).toBe('rate_limit');
      expect(params[2]).toBe(blockedUntil);
    });

    it('应当将 failed 任务改为 blocked', async () => {
      const blockedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const task = makeTask({ status: 'blocked', blocked_reason: 'network' });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await blockTask('task-001', 'network', blockedUntil);

      expect(result.success).toBe(true);
    });

    it('应当在任务不存在或状态不合法时返回失败', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // 返回空行 = 任务不存在或不在 in_progress/failed 状态
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await blockTask('task-001', 'rate_limit', new Date().toISOString());

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found or not in blockable state');
      errorSpy.mockRestore();
    });

    it('应当在数据库异常时返回失败', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPool.query.mockRejectedValueOnce(new Error('db error'));

      const result = await blockTask('task-001', 'rate_limit', new Date().toISOString());

      expect(result.success).toBe(false);
      expect(result.error).toContain('db error');
      errorSpy.mockRestore();
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // unblockTask
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('unblockTask', () => {
    it('应当将 blocked 任务改为 queued 并清空 blocked 字段', async () => {
      const task = makeTask({ status: 'queued', blocked_at: null, blocked_reason: null, blocked_until: null });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await unblockTask('task-001');

      expect(result.success).toBe(true);
      expect(result.task.status).toBe('queued');
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain("status = 'queued'");
      expect(sql).toContain('blocked_at = NULL');
      expect(sql).toContain('blocked_reason = NULL');
      expect(sql).toContain('blocked_until = NULL');
      // WHERE 子句确保只有 blocked 状态可被释放
      expect(sql).toContain("status = 'blocked'");
      const params = mockPool.query.mock.calls[0][1];
      expect(params[0]).toBe('task-001');
    });

    it('应当在任务不在 blocked 状态时返回失败', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await unblockTask('task-001');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in blocked state');
      errorSpy.mockRestore();
    });

    it('应当在数据库异常时返回失败', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPool.query.mockRejectedValueOnce(new Error('connection lost'));

      const result = await unblockTask('task-001');

      expect(result.success).toBe(false);
      expect(result.error).toContain('connection lost');
      errorSpy.mockRestore();
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 安全性测试
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('安全性', () => {
    it('ALLOWED_COLUMNS 白名单应阻止 SQL 注入列名', async () => {
      const task = makeTask({ status: 'queued' });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await updateTaskStatus('task-001', 'queued', {
        'status; DROP TABLE tasks; --': 'evil',
      });

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).not.toContain('DROP TABLE');
      vi.restoreAllMocks();
    });

    it('所有 VALID_STATUSES 都应被接受（包括 blocked）', async () => {
      const validStatuses = ['queued', 'in_progress', 'completed', 'failed', 'blocked'];
      for (const status of validStatuses) {
        vi.clearAllMocks();
        const task = makeTask({ status });
        mockPool.query.mockResolvedValueOnce({ rows: [task] });
        const result = await updateTaskStatus('task-001', status);
        expect(result.success).toBe(true);
      }
    });

    it('所有 ALLOWED_COLUMNS 都应被接受', async () => {
      const allowedCols = ['assigned_to', 'priority', 'payload', 'error', 'artifacts', 'run_id'];
      const fields = {};
      for (const col of allowedCols) {
        fields[col] = col === 'payload' ? { test: true } : `val_${col}`;
      }

      const task = makeTask({ status: 'queued' });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await updateTaskStatus('task-001', 'queued', fields);

      expect(result.success).toBe(true);
      const sql = mockPool.query.mock.calls[0][0];
      // payload 使用 COALESCE 合并，其余直接赋值
      for (const col of allowedCols) {
        if (col === 'payload') {
          expect(sql).toContain('COALESCE(payload');
        } else {
          expect(sql).toContain(`${col} = $`);
        }
      }
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // blockTask
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('blockTask', () => {
    beforeEach(() => {
      mockPool.query.mockReset();
    });

    it('应当成功阻塞 in_progress 任务', async () => {
      const task = makeTask({ status: 'blocked', blocked_reason: { type: 'dependency', blocker_id: 'dep-001', reason: '等待依赖', blocked_at: new Date().toISOString(), auto_resolve: true } });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await blockTask('task-001', {
        type: 'dependency',
        blocker_id: 'dep-001',
        reason: '等待依赖',
      });

      expect(result.success).toBe(true);
      expect(result.task.status).toBe('blocked');
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain("status = 'blocked'");
      expect(sql).toContain('blocked_reason = $2::jsonb');
      // 验证 reason 参数包含必要字段
      const reasonParam = JSON.parse(mockPool.query.mock.calls[0][1][1]);
      expect(reasonParam.type).toBe('dependency');
      expect(reasonParam.blocker_id).toBe('dep-001');
      expect(reasonParam.auto_resolve).toBe(true);
      expect(reasonParam.blocked_at).toBeDefined();
    });

    it('应当在任务不在合法状态时返回错误', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // UPDATE 返回空行（状态不对）
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // EXISTS 查询返回 completed 状态
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'task-001', status: 'completed' }] });

      const result = await blockTask('task-001', { type: 'manual', reason: '测试' });

      expect(result.success).toBe(false);
      expect(result.error).toContain("cannot be blocked from status 'completed'");
      errorSpy.mockRestore();
    });

    it('应当在任务不存在时返回错误', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // UPDATE 空
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // EXISTS 空

      const result = await blockTask('nonexistent', { type: 'manual', reason: '测试' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      errorSpy.mockRestore();
    });

    it('应当默认 auto_resolve=true 当未提供时', async () => {
      const task = makeTask({ status: 'blocked' });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await blockTask('task-001', { type: 'manual', reason: '手动阻塞' });

      const reasonParam = JSON.parse(mockPool.query.mock.calls[0][1][1]);
      expect(reasonParam.auto_resolve).toBe(true);
    });

    it('应当在 auto_resolve=false 时正确存储', async () => {
      const task = makeTask({ status: 'blocked' });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      await blockTask('task-001', { type: 'pr_review', reason: '等待 Review', auto_resolve: false });

      const reasonParam = JSON.parse(mockPool.query.mock.calls[0][1][1]);
      expect(reasonParam.auto_resolve).toBe(false);
    });

    it('应当处理数据库异常', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const result = await blockTask('task-001', { type: 'manual', reason: '测试' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB error');
      errorSpy.mockRestore();
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // unblockTask
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('unblockTask', () => {
    beforeEach(() => {
      mockPool.query.mockReset();
    });

    it('应当成功解除阻塞并将状态改为 queued', async () => {
      const task = makeTask({ status: 'queued', blocked_reason: null });
      mockPool.query.mockResolvedValueOnce({ rows: [task] });

      const result = await unblockTask('task-001');

      expect(result.success).toBe(true);
      expect(result.task.status).toBe('queued');
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain("status = 'queued'");
      expect(sql).toContain('blocked_reason = NULL');
      // 验证 WHERE 子句确保只解除 blocked 状态的任务
      expect(sql).toContain("status = 'blocked'");
    });

    it('应当在任务不在 blocked 状态时返回错误', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // UPDATE 空
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'task-001', status: 'queued' }] }); // EXISTS

      const result = await unblockTask('task-001');

      expect(result.success).toBe(false);
      expect(result.error).toContain("is not blocked");
      errorSpy.mockRestore();
    });

    it('应当在任务不存在时返回错误', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // UPDATE 空
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // EXISTS 空

      const result = await unblockTask('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      errorSpy.mockRestore();
    });

    it('应当处理数据库异常', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPool.query.mockRejectedValueOnce(new Error('connection lost'));

      const result = await unblockTask('task-001');

      expect(result.success).toBe(false);
      expect(result.error).toContain('connection lost');
      errorSpy.mockRestore();
    });
  });
});
