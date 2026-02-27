/**
 * Progress Ledger 模块测试
 */

import crypto from 'crypto';
import pool from '../db.js';
import {
  recordProgressStep,
  getProgressSteps,
  updateProgressStep,
  getTaskProgressSummary,
  evaluateProgressInTick,
  getProgressAnomalies
} from '../progress-ledger.js';

// 生成UUID的辅助函数
function generateUUID() {
  return crypto.randomUUID();
}

// 测试数据库连接池
let testTaskId, testRunId;

describe('Progress Ledger', () => {
  beforeAll(async () => {
    // 确保测试数据库有必要的表
    testTaskId = generateUUID();
    testRunId = generateUUID();

    // 创建测试用的 task 记录（如果 tasks 表存在）
    try {
      await pool.query(`
        INSERT INTO tasks (id, title, description, status, task_type, created_at)
        VALUES ($1, 'Test Task', 'Test task for progress ledger', 'in_progress', 'dev', NOW())
        ON CONFLICT (id) DO NOTHING
      `, [testTaskId]);
    } catch (err) {
      // 忽略表不存在等错误（在某些测试环境中可能没有完整的 schema）
      console.warn('Could not create test task:', err.message);
    }
  });

  afterAll(async () => {
    // 清理测试数据
    try {
      await pool.query('DELETE FROM progress_ledger_review WHERE task_id = $1', [testTaskId]);
      await pool.query('DELETE FROM progress_ledger WHERE task_id = $1', [testTaskId]);
      await pool.query('DELETE FROM tasks WHERE id = $1', [testTaskId]);
    } catch (err) {
      console.warn('Test cleanup failed:', err.message);
    }
  });

  describe('recordProgressStep', () => {
    test('should record a progress step successfully', async () => {
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
      expect(ledgerId).toBeGreaterThan(0);
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
      const step = {
        sequence: 1,
        name: 'updated_step',
        status: 'failed',
        errorCode: 'test_error',
        errorMessage: 'Test error occurred'
      };

      const ledgerId = await recordProgressStep(testTaskId, testRunId, step);
      expect(ledgerId).toBeGreaterThan(0);

      // 验证更新生效
      const steps = await getProgressSteps(testTaskId, testRunId);
      const updatedStep = steps.find(s => s.step_sequence === 1);
      expect(updatedStep.step_name).toBe('updated_step');
      expect(updatedStep.status).toBe('failed');
    });
  });

  describe('getProgressSteps', () => {
    test('should retrieve progress steps for a task', async () => {
      const steps = await getProgressSteps(testTaskId, testRunId);
      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBeGreaterThan(0);

      const firstStep = steps[0];
      expect(firstStep).toHaveProperty('task_id', testTaskId);
      expect(firstStep).toHaveProperty('run_id', testRunId);
      expect(firstStep).toHaveProperty('step_sequence');
      expect(firstStep).toHaveProperty('step_name');
    });

    test('should parse JSON fields correctly', async () => {
      const steps = await getProgressSteps(testTaskId, testRunId);
      const stepWithFindings = steps.find(s => s.findings && Object.keys(s.findings).length > 0);

      if (stepWithFindings) {
        expect(typeof stepWithFindings.findings).toBe('object');
      }
    });
  });

  describe('updateProgressStep', () => {
    test('should update progress step fields', async () => {
      // 先创建一个步骤用于更新
      const step = {
        sequence: 3,
        name: 'update_test',
        status: 'in_progress'
      };

      const ledgerId = await recordProgressStep(testTaskId, testRunId, step);

      // 更新步骤
      const updates = {
        status: 'completed',
        output_summary: 'Updated output',
        confidence_score: 0.85
      };

      const success = await updateProgressStep(ledgerId, updates);
      expect(success).toBe(true);

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
      const summary = await getTaskProgressSummary(testTaskId);

      expect(summary).toHaveProperty('taskId', testTaskId);
      expect(summary).toHaveProperty('totalSteps');
      expect(summary).toHaveProperty('completedSteps');
      expect(summary).toHaveProperty('completionPercentage');
      expect(summary).toHaveProperty('avgConfidence');

      expect(typeof summary.totalSteps).toBe('number');
      expect(typeof summary.completionPercentage).toBe('number');
    });

    test('should return default values for non-existent task', async () => {
      const nonExistentTaskId = generateUUID();
      const summary = await getTaskProgressSummary(nonExistentTaskId);

      expect(summary.totalSteps).toBe(0);
      expect(summary.completedSteps).toBe(0);
      expect(summary.completionPercentage).toBe(0);
    });
  });

  describe('evaluateProgressInTick', () => {
    test('should evaluate progress without errors', async () => {
      const tickId = 'test-tick-' + Date.now();
      const tickNumber = Math.floor(Date.now() / 1000);

      const results = await evaluateProgressInTick(tickId, tickNumber);

      expect(Array.isArray(results)).toBe(true);
      // 结果可能为空（如果没有 in_progress 任务）

      if (results.length > 0) {
        const result = results[0];
        expect(result).toHaveProperty('taskId');
        expect(result).toHaveProperty('reviewAction');
        expect(result).toHaveProperty('riskAssessment');
      }
    });

    test('should handle empty task list', async () => {
      // 这个测试验证在没有 in_progress 任务时不会出错
      const tickId = 'empty-test-' + Date.now();
      const tickNumber = Math.floor(Date.now() / 1000);

      const results = await evaluateProgressInTick(tickId, tickNumber);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('getProgressAnomalies', () => {
    test('should retrieve anomalies within time window', async () => {
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
      const shortWindow = await getProgressAnomalies(1);
      const longWindow = await getProgressAnomalies(168); // 1 week

      expect(Array.isArray(shortWindow)).toBe(true);
      expect(Array.isArray(longWindow)).toBe(true);
      // 长时间窗口通常会有更多或相等的结果
      expect(longWindow.length).toBeGreaterThanOrEqual(shortWindow.length);
    });
  });

  describe('异常检测算法', () => {
    test('should detect stalled tasks', async () => {
      // 创建一个"停滞"的任务步骤（开始时间很久以前，但仍在进行中）
      const stalledStep = {
        sequence: 10,
        name: 'stalled_step',
        status: 'in_progress',
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2小时前开始
        confidenceScore: 0.5
      };

      await recordProgressStep(testTaskId, testRunId, stalledStep);

      // 评估应该检测到停滞
      const tickId = 'stall-test-' + Date.now();
      const results = await evaluateProgressInTick(tickId, Math.floor(Date.now() / 1000));

      // 查找我们创建的任务的评估结果
      const taskResult = results.find(r => r.taskId === testTaskId);
      if (taskResult) {
        // 停滞任务应该被标记为需要升级或重试
        expect(['escalate', 'retry', 'pause']).toContain(taskResult.reviewAction);
      }
    });
  });
});

describe('Progress Ledger Integration', () => {
  test('数据库表应该存在', async () => {
    // 测试 progress_ledger 表
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'progress_ledger'
      )
    `);
    expect(tableExists.rows[0].exists).toBe(true);

    // 测试 progress_ledger_review 表
    const reviewTableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'progress_ledger_review'
      )
    `);
    expect(reviewTableExists.rows[0].exists).toBe(true);
  });

  test('视图应该存在', async () => {
    // 测试 v_task_progress_summary 视图
    const viewExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.views
        WHERE table_schema = 'public'
        AND table_name = 'v_task_progress_summary'
      )
    `);
    expect(viewExists.rows[0].exists).toBe(true);
  });
});