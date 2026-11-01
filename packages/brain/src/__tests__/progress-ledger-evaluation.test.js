/**
 * Progress Ledger 摘要、评估与异常 测试
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
  getTaskProgressSummary,
  evaluateProgressInTick,
  getProgressAnomalies,
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

  describe('getTaskProgressSummary', () => {
    it('有数据时应返回解析后的摘要', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          task_id: taskId,
          run_id: runId,
          total_steps: '10',
          completed_steps: '7',
          failed_steps: '1',
          in_progress_steps: '2',
          completion_percentage: '70.00',
          total_duration_ms: '300000',
          avg_confidence: '0.92',
          first_step_started: new Date('2026-01-01T00:00:00Z'),
          last_step_completed: new Date('2026-01-01T00:05:00Z'),
        }],
      });

      const summary = await getTaskProgressSummary(taskId);

      expect(summary.taskId).toBe(taskId);
      expect(summary.runId).toBe(runId);
      expect(summary.totalSteps).toBe(10);
      expect(summary.completedSteps).toBe(7);
      expect(summary.failedSteps).toBe(1);
      expect(summary.inProgressSteps).toBe(2);
      expect(summary.completionPercentage).toBe(70.0);
      expect(summary.totalDurationMs).toBe(300000);
      expect(summary.avgConfidence).toBe(0.92);
      expect(summary.firstStepStarted).toBeInstanceOf(Date);
      expect(summary.lastStepCompleted).toBeInstanceOf(Date);
    });

    it('无数据时应返回默认摘要', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const summary = await getTaskProgressSummary(taskId);

      expect(summary.taskId).toBe(taskId);
      expect(summary.totalSteps).toBe(0);
      expect(summary.completedSteps).toBe(0);
      expect(summary.completionPercentage).toBe(0);
      expect(summary.totalDurationMs).toBe(0);
      expect(summary.avgConfidence).toBe(1.0);
    });

    it('total_duration_ms 为 null 时应返回 0', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          task_id: taskId,
          run_id: runId,
          total_steps: '3',
          completed_steps: '1',
          failed_steps: '0',
          in_progress_steps: '2',
          completion_percentage: '33.33',
          total_duration_ms: null,
          avg_confidence: '0.80',
          first_step_started: null,
          last_step_completed: null,
        }],
      });

      const summary = await getTaskProgressSummary(taskId);
      expect(summary.totalDurationMs).toBe(0);
    });

    it('应查询 v_task_progress_summary 视图', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await getTaskProgressSummary(taskId);

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('v_task_progress_summary');
      expect(sql).toContain('LIMIT 1');
    });

    it('数据库查询失败时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('视图不存在'));

      await expect(getTaskProgressSummary(taskId)).rejects.toThrow('视图不存在');
    });
  });

  describe('evaluateProgressInTick', () => {
    const tickId = 'tick-001';
    const tickNumber = 100;

    it('无进行中任务时应返回空数组', async () => {
      // 第一次 query: tasksQuery 返回空
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const results = await evaluateProgressInTick(tickId, tickNumber);
      expect(results).toEqual([]);
    });

    it('正常进展的任务应标记为 continue', async () => {
      // tasksQuery 返回正常任务
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          task_id: taskId,
          title: '正常任务',
          task_status: 'in_progress',
          run_id: runId,
          step_sequence: 1,
          step_name: 'build',
          step_status: 'in_progress',
          started_at: new Date(),
          retry_count: 0,
          confidence_score: 0.9,
          step_age_ms: 5 * 60 * 1000, // 5 分钟，正常
        }],
      });
      // reviewQuery INSERT
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const results = await evaluateProgressInTick(tickId, tickNumber);

      expect(results).toHaveLength(1);
      expect(results[0].reviewAction).toBe('continue');
      expect(results[0].riskAssessment).toBe('low');
      expect(results[0].shouldAlert).toBe(false);
      expect(results[0].taskId).toBe(taskId);
      expect(results[0].runId).toBe(runId);
      expect(results[0].stepName).toBe('build');
    });

    it('停滞任务（超过 1 小时）应标记为 escalate + high', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          task_id: taskId,
          title: '停滞任务',
          task_status: 'in_progress',
          run_id: runId,
          step_sequence: 3,
          step_name: 'deploy',
          step_status: 'in_progress',
          started_at: new Date(Date.now() - 2 * 3600 * 1000),
          retry_count: 0,
          confidence_score: 0.8,
          step_age_ms: 2 * 3600 * 1000, // 2 小时
        }],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const results = await evaluateProgressInTick(tickId, tickNumber);

      expect(results).toHaveLength(1);
      expect(results[0].reviewAction).toBe('escalate');
      expect(results[0].riskAssessment).toBe('high');
      expect(results[0].shouldAlert).toBe(true);
      expect(results[0].reviewReason).toContain('deploy');
      expect(results[0].reviewReason).toContain('minutes');
    });

    it.each([
      [3600000, 'continue', 'low', false],
      [3600001, 'escalate', 'high', true],
    ])('执行时长%s毫秒遵守停滞边界，不能落入伪装已覆盖的retry分支', async (age, action, risk, alert) => {
      mockPool.query.mockResolvedValueOnce({ rows: [{
        task_id: taskId, title: '边界任务', task_status: 'in_progress', run_id: runId,
        step_sequence: 1, step_name: 'build', step_status: 'in_progress',
        started_at: new Date(), retry_count: 0, confidence_score: 0.9, step_age_ms: age,
      }] });
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const results = await evaluateProgressInTick(tickId, tickNumber);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ reviewAction: action, riskAssessment: risk, shouldAlert: alert });
    });

    it('重试过多（>=3次）应标记为 pause + high', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          task_id: taskId,
          title: '高重试任务',
          task_status: 'in_progress',
          run_id: runId,
          step_sequence: 2,
          step_name: 'test',
          step_status: 'completed', // 非 in_progress 避免触发 stalled
          started_at: new Date(),
          retry_count: 5,
          confidence_score: 0.8,
          step_age_ms: 10 * 60 * 1000,
        }],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const results = await evaluateProgressInTick(tickId, tickNumber);

      expect(results).toHaveLength(1);
      expect(results[0].reviewAction).toBe('pause');
      expect(results[0].riskAssessment).toBe('high');
      expect(results[0].shouldAlert).toBe(true);
      expect(results[0].reviewReason).toContain('5 times');
    });

    it('低信心分数（<0.5）应标记为 escalate + medium', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          task_id: taskId,
          title: '低信心任务',
          task_status: 'in_progress',
          run_id: runId,
          step_sequence: 1,
          step_name: 'analyze',
          step_status: 'completed',
          started_at: new Date(),
          retry_count: 0,
          confidence_score: 0.3,
          step_age_ms: 5 * 60 * 1000,
        }],
      });
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const results = await evaluateProgressInTick(tickId, tickNumber);

      expect(results).toHaveLength(1);
      expect(results[0].reviewAction).toBe('escalate');
      expect(results[0].riskAssessment).toBe('medium');
      expect(results[0].shouldAlert).toBe(false);
      expect(results[0].reviewReason).toContain('low confidence');
    });

    it('多个任务应各自独立评估', async () => {
      const taskId2 = uuid();
      const runId2 = uuid();

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            task_id: taskId,
            title: '任务A',
            task_status: 'in_progress',
            run_id: runId,
            step_sequence: 1,
            step_name: 'a',
            step_status: 'completed',
            started_at: new Date(),
            retry_count: 0,
            confidence_score: 0.9,
            step_age_ms: 1000,
          },
          {
            task_id: taskId2,
            title: '任务B',
            task_status: 'in_progress',
            run_id: runId2,
            step_sequence: 1,
            step_name: 'b',
            step_status: 'completed',
            started_at: new Date(),
            retry_count: 4,
            confidence_score: 0.8,
            step_age_ms: 2000,
          },
        ],
      });
      // 两次 reviewQuery INSERT
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const results = await evaluateProgressInTick(tickId, tickNumber);

      expect(results).toHaveLength(2);
      expect(results[0].reviewAction).toBe('continue');
      expect(results[1].reviewAction).toBe('pause'); // retry_count >= 3
    });

    it('数据库查询失败时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('connection reset'));

      await expect(
        evaluateProgressInTick(tickId, tickNumber)
      ).rejects.toThrow('connection reset');
    });

    it('reviewQuery INSERT 失败时应抛出异常', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          task_id: taskId,
          title: '测试',
          task_status: 'in_progress',
          run_id: runId,
          step_sequence: 1,
          step_name: 's',
          step_status: 'completed',
          started_at: new Date(),
          retry_count: 0,
          confidence_score: 0.9,
          step_age_ms: 1000,
        }],
      });
      mockPool.query.mockRejectedValueOnce(new Error('INSERT 失败'));

      await expect(
        evaluateProgressInTick(tickId, tickNumber)
      ).rejects.toThrow('INSERT 失败');
    });
  });

  describe('getProgressAnomalies', () => {
    it('有异常时应返回格式化的异常列表', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            task_id: taskId,
            title: '异常任务',
            run_id: runId,
            review_action: 'escalate',
            review_reason: '步骤停滞',
            risk_assessment: 'high',
            evaluated_at: new Date('2026-01-01'),
            step_name: 'build',
            step_status: 'in_progress',
            retry_count: 2,
            confidence_score: '0.65',
          },
        ],
      });

      const anomalies = await getProgressAnomalies(24);

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]).toEqual({
        taskId: taskId,
        taskTitle: '异常任务',
        runId: runId,
        stepName: 'build',
        stepStatus: 'in_progress',
        reviewAction: 'escalate',
        reviewReason: '步骤停滞',
        riskAssessment: 'high',
        retryCount: 2,
        confidenceScore: 0.65,
        evaluatedAt: expect.any(Date),
      });
    });

    it('默认时间窗口应为 1 小时', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await getProgressAnomalies();

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain("'1 hours'");
    });

    it('自定义时间窗口应体现在 SQL 中', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await getProgressAnomalies(48);

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain("'48 hours'");
    });

    it('无异常时应返回空数组', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const anomalies = await getProgressAnomalies(1);
      expect(anomalies).toEqual([]);
    });

    it('SQL 应只查询 medium 和 high 风险', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await getProgressAnomalies(1);

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain("('medium', 'high')");
    });

    it('SQL 应按 risk_assessment DESC 排序', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await getProgressAnomalies(1);

      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).toContain('ORDER BY plr.risk_assessment DESC');
    });

    it('confidence_score 应被 parseFloat 转换', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          task_id: taskId,
          title: 'T',
          run_id: runId,
          review_action: 'retry',
          review_reason: 'slow',
          risk_assessment: 'medium',
          evaluated_at: new Date(),
          step_name: 's',
          step_status: 'in_progress',
          retry_count: 1,
          confidence_score: '0.42',
        }],
      });

      const anomalies = await getProgressAnomalies(1);
      expect(typeof anomalies[0].confidenceScore).toBe('number');
      expect(anomalies[0].confidenceScore).toBe(0.42);
    });

    it('数据库查询失败时应抛出异常', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('表不存在'));

      await expect(getProgressAnomalies(1)).rejects.toThrow('表不存在');
    });

    it('多条异常应全部返回', async () => {
      const taskId2 = uuid();
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            task_id: taskId,
            title: 'A',
            run_id: runId,
            review_action: 'escalate',
            review_reason: 'stalled',
            risk_assessment: 'high',
            evaluated_at: new Date(),
            step_name: 'x',
            step_status: 'in_progress',
            retry_count: 0,
            confidence_score: '0.5',
          },
          {
            task_id: taskId2,
            title: 'B',
            run_id: uuid(),
            review_action: 'retry',
            review_reason: 'slow',
            risk_assessment: 'medium',
            evaluated_at: new Date(),
            step_name: 'y',
            step_status: 'in_progress',
            retry_count: 1,
            confidence_score: '0.6',
          },
        ],
      });

      const anomalies = await getProgressAnomalies(24);
      expect(anomalies).toHaveLength(2);
      expect(anomalies[0].riskAssessment).toBe('high');
      expect(anomalies[1].riskAssessment).toBe('medium');
    });
  });
});
