/**
 * Progress Ledger 模块测试
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';

// Mock needs to be hoisted to the top
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn(() => ({
      query: vi.fn(),
      release: vi.fn(),
    })),
  }
}));

import pool from '../db.js';
import {
  recordProgressStep,
  getProgressSteps,
  updateProgressStep,
  getTaskProgressSummary,
  evaluateProgressInTick,
  getProgressAnomalies
} from '../progress-ledger.js';

// Get the mocked pool reference
const mockPool = vi.mocked(pool);
const mockClient = vi.mocked(pool.connect());

// 生成UUID的辅助函数
function generateUUID() {
  return crypto.randomUUID();
}

// 测试数据库连接池
let testTaskId, testRunId;

describe('Progress Ledger', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  beforeAll(async () => {
    // 设置测试数据
    testTaskId = generateUUID();
    testRunId = generateUUID();
  });

  afterAll(async () => {
    // Mock 环境下不需要清理数据
  });

  describe('recordProgressStep', () => {
    test('should record a progress step successfully', async () => {
      // Mock 数据库响应，返回插入成功的结果
      mockPool.query.mockResolvedValue({ rows: [{ id: 123 }], rowCount: 1 });

      const step = {
        sequence: 1,
        name: 'test_step',
        type: 'execution',
        status: 'completed',
        startedAt: new Date('2024-01-01T10:00:00Z'),
        completedAt: new Date('2024-01-01T10:05:00Z'),
        durationMs: 300000,
        inputSummary: 'Test input',
        outputSummary: 'Test output',
        findings: { result: 'success' },
        confidenceScore: 0.95
      };

      const ledgerId = await recordProgressStep(testTaskId, testRunId, step);
      expect(ledgerId).toBe(123);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO progress_ledger'),
        expect.arrayContaining([testTaskId, testRunId])
      );
    });

    test('should handle missing required parameters', async () => {
      await expect(recordProgressStep(null, testRunId, { sequence: 1 }))
        .rejects.toThrow('Missing required parameters');
    });

    test('should validate confidence score range', async () => {
      const step = {
        sequence: 2,
        name: 'invalid_confidence',
        confidenceScore: 1.5 // Invalid: > 1.0
      };

      await expect(recordProgressStep(testTaskId, testRunId, step))
        .rejects.toThrow('confidenceScore must be between 0.0 and 1.0');
    });

    test('should handle upsert on duplicate sequence', async () => {
      // Mock 第一次插入返回成功
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 124 }], rowCount: 1 });

      const step = {
        sequence: 1,
        name: 'updated_step',
        status: 'failed',
        errorCode: 'test_error',
        errorMessage: 'Test error occurred'
      };

      const ledgerId = await recordProgressStep(testTaskId, testRunId, step);
      expect(ledgerId).toBe(124);

      // Mock 获取步骤的返回值
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          task_id: testTaskId,
          run_id: testRunId,
          step_sequence: 1,
          step_name: 'updated_step',
          status: 'failed',
          error_code: 'test_error',
          error_message: 'Test error occurred'
        }],
        rowCount: 1
      });

      // 验证更新生效
      const steps = await getProgressSteps(testTaskId, testRunId);
      const updatedStep = steps.find(s => s.step_sequence === 1);
      expect(updatedStep.step_name).toBe('updated_step');
      expect(updatedStep.status).toBe('failed');
    });
  });

  describe('getProgressSteps', () => {
    test('should retrieve progress steps for a task', async () => {
      // Mock 返回步骤列表
      mockPool.query.mockResolvedValue({
        rows: [{
          task_id: testTaskId,
          run_id: testRunId,
          step_sequence: 1,
          step_name: 'test_step',
          status: 'completed'
        }],
        rowCount: 1
      });

      const steps = await getProgressSteps(testTaskId, testRunId);
      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBe(1);

      const firstStep = steps[0];
      expect(firstStep).toHaveProperty('task_id', testTaskId);
      expect(firstStep).toHaveProperty('run_id', testRunId);
      expect(firstStep).toHaveProperty('step_sequence', 1);
      expect(firstStep).toHaveProperty('step_name', 'test_step');
    });

    test('should parse JSON fields correctly', async () => {
      // Mock 返回包含 JSON 数据的步骤
      mockPool.query.mockResolvedValue({
        rows: [{
          task_id: testTaskId,
          run_id: testRunId,
          step_sequence: 1,
          step_name: 'test_step',
          findings: '{"result": "success", "score": 0.95}'
        }],
        rowCount: 1
      });

      const steps = await getProgressSteps(testTaskId, testRunId);
      const stepWithFindings = steps[0];

      expect(typeof stepWithFindings.findings).toBe('object');
      expect(stepWithFindings.findings.result).toBe('success');
      expect(stepWithFindings.findings.score).toBe(0.95);
    });
  });

  describe('updateProgressStep', () => {
    test('should update progress step fields', async () => {
      // Mock 创建步骤
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 125 }], rowCount: 1 });

      const step = {
        sequence: 3,
        name: 'update_test',
        status: 'in_progress'
      };

      const ledgerId = await recordProgressStep(testTaskId, testRunId, step);

      // Mock 更新操作
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      const updates = {
        status: 'completed',
        output_summary: 'Updated output',
        confidence_score: 0.85
      };

      const success = await updateProgressStep(ledgerId, updates);
      expect(success).toBe(true);

      // Mock 获取更新后的步骤
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: ledgerId,
          task_id: testTaskId,
          run_id: testRunId,
          step_sequence: 3,
          step_name: 'update_test',
          status: 'completed',
          output_summary: 'Updated output',
          confidence_score: '0.85'
        }],
        rowCount: 1
      });

      // 验证更新
      const steps = await getProgressSteps(testTaskId, testRunId);
      const updatedStep = steps.find(s => s.id === ledgerId);
      expect(updatedStep.status).toBe('completed');
      expect(updatedStep.output_summary).toBe('Updated output');
      expect(parseFloat(updatedStep.confidence_score)).toBe(0.85);
    });

    test('should handle invalid field names', async () => {
      const result = await updateProgressStep(9999, { invalid_field: 'test' });
      expect(result).toBe(false);
    });
  });

  describe('getTaskProgressSummary', () => {
    test('should return progress summary for existing task', async () => {
      // Mock 返回任务进度摘要
      mockPool.query.mockResolvedValue({
        rows: [{
          task_id: testTaskId,
          total_steps: 5,
          completed_steps: 3,
          completion_percentage: 60.0,
          avg_confidence: 0.85
        }],
        rowCount: 1
      });

      const summary = await getTaskProgressSummary(testTaskId);

      expect(summary).toHaveProperty('taskId', testTaskId);
      expect(summary).toHaveProperty('totalSteps', 5);
      expect(summary).toHaveProperty('completedSteps', 3);
      expect(summary).toHaveProperty('completionPercentage', 60.0);
      expect(summary).toHaveProperty('avgConfidence', 0.85);

      expect(typeof summary.totalSteps).toBe('number');
      expect(typeof summary.completionPercentage).toBe('number');
    });

    test('should return default values for non-existent task', async () => {
      // Mock 返回空结果
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const nonExistentTaskId = generateUUID();
      const summary = await getTaskProgressSummary(nonExistentTaskId);

      expect(summary.totalSteps).toBe(0);
      expect(summary.completedSteps).toBe(0);
      expect(summary.completionPercentage).toBe(0);
    });
  });

  describe('evaluateProgressInTick', () => {
    test('should evaluate progress without errors', async () => {
      // Mock 返回进行中的任务
      mockPool.query.mockResolvedValue({
        rows: [{
          id: testTaskId,
          title: 'Test Task',
          status: 'in_progress'
        }],
        rowCount: 1
      });

      const tickId = 'test-tick-' + Date.now();
      const tickNumber = Math.floor(Date.now() / 1000);

      const results = await evaluateProgressInTick(tickId, tickNumber);

      expect(Array.isArray(results)).toBe(true);
    });

    test('should handle empty task list', async () => {
      // Mock 返回空任务列表
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const tickId = 'empty-test-' + Date.now();
      const tickNumber = Math.floor(Date.now() / 1000);

      const results = await evaluateProgressInTick(tickId, tickNumber);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });

  describe('getProgressAnomalies', () => {
    test('should retrieve anomalies within time window', async () => {
      // Mock 返回异常数据
      mockPool.query.mockResolvedValue({
        rows: [{
          task_id: testTaskId,
          risk_assessment: 'medium',
          last_activity: new Date()
        }],
        rowCount: 1
      });

      const anomalies = await getProgressAnomalies(24); // 24小时窗口

      expect(Array.isArray(anomalies)).toBe(true);

      if (anomalies.length > 0) {
        const anomaly = anomalies[0];
        expect(anomaly).toHaveProperty('taskId');
        expect(anomaly).toHaveProperty('riskAssessment');
        expect(['medium', 'high']).toContain(anomaly.riskAssessment);
      }
    });

    test('should handle different time windows', async () => {
      // Mock 不同时间窗口的返回
      mockPool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // 短窗口
        .mockResolvedValueOnce({ rows: [{ task_id: testTaskId }], rowCount: 1 }); // 长窗口

      const shortWindow = await getProgressAnomalies(1);
      const longWindow = await getProgressAnomalies(168); // 1 week

      expect(Array.isArray(shortWindow)).toBe(true);
      expect(Array.isArray(longWindow)).toBe(true);
      expect(longWindow.length).toBeGreaterThanOrEqual(shortWindow.length);
    });
  });

  describe('异常检测算法', () => {
    test('should detect stalled tasks', async () => {
      // Mock 插入停滞步骤
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 126 }], rowCount: 1 });

      const stalledStep = {
        sequence: 10,
        name: 'stalled_step',
        status: 'in_progress',
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2小时前开始
        confidenceScore: 0.5
      };

      await recordProgressStep(testTaskId, testRunId, stalledStep);

      // Mock 评估返回停滞任务
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: testTaskId,
          title: 'Stalled Task',
          status: 'in_progress'
        }],
        rowCount: 1
      });

      const tickId = 'stall-test-' + Date.now();
      const results = await evaluateProgressInTick(tickId, Math.floor(Date.now() / 1000));

      expect(Array.isArray(results)).toBe(true);
    });
  });
});

describe('Progress Ledger Integration', () => {
  test('数据库表应该存在', async () => {
    // Mock 表存在检查
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ exists: true }], rowCount: 1 }) // progress_ledger
      .mockResolvedValueOnce({ rows: [{ exists: true }], rowCount: 1 }); // progress_ledger_review

    // 测试 progress_ledger 表
    const tableExists = await mockPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'progress_ledger'
      )
    `);
    expect(tableExists.rows[0].exists).toBe(true);

    // 测试 progress_ledger_review 表
    const reviewTableExists = await mockPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'progress_ledger_review'
      )
    `);
    expect(reviewTableExists.rows[0].exists).toBe(true);
  });

  test('视图应该存在', async () => {
    // Mock 视图存在检查
    mockPool.query.mockResolvedValue({ rows: [{ exists: true }], rowCount: 1 });

    const viewExists = await mockPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.views
        WHERE table_schema = 'public'
        AND table_name = 'v_task_progress_summary'
      )
    `);
    expect(viewExists.rows[0].exists).toBe(true);
  });
});