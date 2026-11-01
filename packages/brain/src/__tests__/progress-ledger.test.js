/**
 * Progress Ledger 步骤 CRUD 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// vi.mock 被提升到模块顶部，工厂内不能引用外部 const
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

import pool from '../db.js';
import {
  recordProgressStep,
  getProgressSteps,
  updateProgressStep,
} from '../progress-ledger.js';

// 获取 mock 后的 pool 引用
const mockPool = vi.mocked(pool);

// 辅助函数
function uuid() {
  return crypto.randomUUID();
}

describe('Progress Ledger', () => {
  let taskId, runId;

  beforeEach(() => {
    vi.clearAllMocks();
    taskId = uuid();
    runId = uuid();
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('recordProgressStep', () => {
    it('应成功记录步骤并返回 id', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 42 }], rowCount: 1 });

      const result = await recordProgressStep(taskId, runId, {
        sequence: 1,
        name: 'init',
        type: 'execution',
        status: 'completed',
        startedAt: new Date('2026-01-01T00:00:00Z'),
        completedAt: new Date('2026-01-01T00:01:00Z'),
        durationMs: 60000,
        inputSummary: '输入摘要',
        outputSummary: '输出摘要',
        findings: { key: 'value' },
        errorCode: null,
        errorMessage: null,
        retryCount: 0,
        artifacts: { file: 'a.js' },
        metadata: { env: 'test' },
        confidenceScore: 0.95,
      });

      expect(result).toBe(42);
      expect(mockPool.query).toHaveBeenCalledOnce();

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO progress_ledger');
      expect(sql).toContain('ON CONFLICT');
      expect(params[0]).toBe(taskId);
      expect(params[1]).toBe(runId);
      expect(params[2]).toBe(1); // sequence
      expect(params[3]).toBe('init'); // name
      // findings / artifacts / metadata 被 JSON.stringify
      expect(params[11]).toBe(JSON.stringify({ key: 'value' }));
      expect(params[15]).toBe(JSON.stringify({ file: 'a.js' }));
      expect(params[16]).toBe(JSON.stringify({ env: 'test' }));
      expect(params[17]).toBe(0.95); // confidenceScore
    });

    it('应使用默认值填充可选字段', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      await recordProgressStep(taskId, runId, { sequence: 1, name: 'step1' });

      const params = mockPool.query.mock.calls[0][1];
      expect(params[4]).toBe('execution'); // 默认 type
      expect(params[5]).toBe('queued'); // 默认 status
      expect(params[14]).toBe(0); // 默认 retryCount
      expect(params[17]).toBe(1.0); // 默认 confidenceScore
    });

    it('缺少 taskId 时应抛出错误', async () => {
      await expect(
        recordProgressStep(null, runId, { sequence: 1, name: 'x' })
      ).rejects.toThrow('Missing required parameters');
    });

    it('缺少 runId 时应抛出错误', async () => {
      await expect(
        recordProgressStep(taskId, null, { sequence: 1, name: 'x' })
      ).rejects.toThrow('Missing required parameters');
    });

    it('缺少 sequence 时应抛出错误', async () => {
      await expect(
        recordProgressStep(taskId, runId, { name: 'x' })
      ).rejects.toThrow('Missing required parameters');
    });

    it('缺少 name 时应抛出错误', async () => {
      await expect(
        recordProgressStep(taskId, runId, { sequence: 1 })
      ).rejects.toThrow('Missing required parameters');
    });

    it('confidenceScore 大于 1.0 时应抛出错误', async () => {
      await expect(
        recordProgressStep(taskId, runId, {
          sequence: 1,
          name: 'x',
          confidenceScore: 1.5,
        })
      ).rejects.toThrow('confidenceScore must be between 0.0 and 1.0');
    });

    it('confidenceScore 小于 0.0 时应抛出错误', async () => {
      await expect(
        recordProgressStep(taskId, runId, {
          sequence: 1,
          name: 'x',
          confidenceScore: -0.1,
        })
      ).rejects.toThrow('confidenceScore must be between 0.0 and 1.0');
    });

    it('数据库查询失败时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(
        recordProgressStep(taskId, runId, { sequence: 1, name: 'x' })
      ).rejects.toThrow('DB connection lost');
    });

    it('带有 errorCode 和 errorMessage 的步骤应正常记录', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 99 }] });

      const result = await recordProgressStep(taskId, runId, {
        sequence: 5,
        name: 'failed_step',
        status: 'failed',
        errorCode: 'TIMEOUT',
        errorMessage: '执行超时',
        retryCount: 2,
      });

      expect(result).toBe(99);
      const params = mockPool.query.mock.calls[0][1];
      expect(params[12]).toBe('TIMEOUT');
      expect(params[13]).toBe('执行超时');
      expect(params[14]).toBe(2);
    });
  });

  describe('getProgressSteps', () => {
    it('指定 runId 时应查询特定运行的步骤', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { task_id: taskId, run_id: runId, step_sequence: 1, step_name: 'a', findings: {}, artifacts: {}, metadata: {} },
          { task_id: taskId, run_id: runId, step_sequence: 2, step_name: 'b', findings: {}, artifacts: {}, metadata: {} },
        ],
      });

      const steps = await getProgressSteps(taskId, runId);

      expect(steps).toHaveLength(2);
      expect(steps[0].step_name).toBe('a');
      expect(steps[1].step_name).toBe('b');

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('AND run_id = $2');
      expect(params).toEqual([taskId, runId]);
    });

    it('不指定 runId 时应查询所有运行的步骤', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await getProgressSteps(taskId);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).not.toContain('AND run_id');
      expect(params).toEqual([taskId]);
    });

    it('空结果应返回空数组', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const steps = await getProgressSteps(taskId, runId);
      expect(steps).toEqual([]);
    });

    it('应正确解析字符串类型的 JSON 字段', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          findings: '{"score":0.9}',
          artifacts: '{"pr":"#123"}',
          metadata: '{"env":"prod"}',
        }],
      });

      const steps = await getProgressSteps(taskId);

      expect(steps[0].findings).toEqual({ score: 0.9 });
      expect(steps[0].artifacts).toEqual({ pr: '#123' });
      expect(steps[0].metadata).toEqual({ env: 'prod' });
    });

    it('对象类型的 JSON 字段应保持不变', async () => {
      const findingsObj = { result: 'ok' };
      const artifactsObj = { file: 'x.js' };
      const metadataObj = { note: 'test' };

      mockPool.query.mockResolvedValueOnce({
        rows: [{
          findings: findingsObj,
          artifacts: artifactsObj,
          metadata: metadataObj,
        }],
      });

      const steps = await getProgressSteps(taskId);
      expect(steps[0].findings).toEqual(findingsObj);
      expect(steps[0].artifacts).toEqual(artifactsObj);
      expect(steps[0].metadata).toEqual(metadataObj);
    });

    it('数据库查询失败时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('query timeout'));

      await expect(getProgressSteps(taskId)).rejects.toThrow('query timeout');
    });

    it('SQL 应包含 ORDER BY step_sequence ASC', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await getProgressSteps(taskId);

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('ORDER BY step_sequence ASC');
    });
  });

  describe('updateProgressStep', () => {
    it('应成功更新允许的字段并返回 true', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      const result = await updateProgressStep(100, {
        status: 'completed',
        output_summary: '完成',
        confidence_score: 0.88,
      });

      expect(result).toBe(true);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('UPDATE progress_ledger');
      expect(sql).toContain('status = $1');
      expect(sql).toContain('output_summary = $2');
      expect(sql).toContain('confidence_score = $3');
      expect(sql).toContain('WHERE id = $4');
      expect(params).toEqual(['completed', '完成', 0.88, 100]);
    });

    it('没有有效字段时应返回 false', async () => {
      const result = await updateProgressStep(100, { invalid_field: 'test' });
      expect(result).toBe(false);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('空 updates 对象应返回 false', async () => {
      const result = await updateProgressStep(100, {});
      expect(result).toBe(false);
    });

    it('记录不存在时（rowCount=0）应返回 false', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

      const result = await updateProgressStep(99999, { status: 'completed' });
      expect(result).toBe(false);
    });

    it('应将 findings 字段 JSON.stringify', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      await updateProgressStep(100, {
        findings: { key: 'val' },
      });

      const params = mockPool.query.mock.calls[0][1];
      expect(params[0]).toBe(JSON.stringify({ key: 'val' }));
    });

    it('应过滤掉不允许的字段，仅更新白名单字段', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      await updateProgressStep(100, {
        status: 'failed',
        not_allowed: 'should_be_filtered',
        error_code: 'ERR_001',
      });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('status = $1');
      expect(sql).toContain('error_code = $2');
      expect(sql).not.toContain('not_allowed');
      expect(params).toEqual(['failed', 'ERR_001', 100]);
    });

    it('数据库查询失败时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('update failed'));

      await expect(
        updateProgressStep(100, { status: 'completed' })
      ).rejects.toThrow('update failed');
    });

    it('应能更新所有允许的字段', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      await updateProgressStep(100, {
        status: 'failed',
        completed_at: new Date('2026-01-01'),
        duration_ms: 5000,
        output_summary: '输出',
        findings: { x: 1 },
        error_code: 'E1',
        error_message: '错误信息',
        retry_count: 3,
        confidence_score: 0.5,
      });

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('status');
      expect(sql).toContain('completed_at');
      expect(sql).toContain('duration_ms');
      expect(sql).toContain('output_summary');
      expect(sql).toContain('findings');
      expect(sql).toContain('error_code');
      expect(sql).toContain('error_message');
      expect(sql).toContain('retry_count');
      expect(sql).toContain('confidence_score');
      expect(sql).toContain('updated_at = NOW()');
    });
  });
});
