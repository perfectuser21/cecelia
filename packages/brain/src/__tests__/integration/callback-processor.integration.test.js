/**
 * callback-processor 集成测试
 *
 * 覆盖路径：
 *   Path 1: 状态映射链路 — AI Done/Failed/Quota Exhausted → 正确的 newStatus
 *   Path 2: Dev 任务无 PR → completed_no_pr 状态转换
 *   Path 3: terminal_failure_guard — pipeline_terminal_failure 拒绝覆盖为 completed
 *   Path 4: task_id 缺失抛异常
 *   Path 5: 失败任务分类 — transient auth error 跳过熔断计数
 *
 * 测试策略：
 *   - mock pool（db.js）和所有外部依赖（thalamus/quarantine/event-bus等）
 *   - pool.connect() 返回带 BEGIN/COMMIT 的 mock client（支持事务）
 *   - 只验证 callback-processor 内部的核心决策逻辑
 *
 * 关联模块：callback-processor.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock DB pool（支持事务：pool.query + pool.connect + client）─────────────
const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
};
const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  connect: vi.fn().mockResolvedValue(mockClient),
};
vi.mock('../../db.js', () => ({ default: mockPool }));

// ─── Mock thalamus（不测调度决策）────────────────────────────────────────────
vi.mock('../../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({
    level: 'normal',
    actions: [{ type: 'fallback_to_tick' }],
  }),
  executeDecision: vi.fn().mockResolvedValue(null),
  EVENT_TYPES: {
    TASK_COMPLETED: 'task_completed',
    TASK_FAILED: 'task_failed',
  },
}));

// ─── Mock decision-executor（不测决策执行）──────────────────────────────────
vi.mock('../../decision-executor.js', () => ({
  executeDecision: vi.fn().mockResolvedValue(null),
}));

// ─── Mock embedding（不测向量化）────────────────────────────────────────────
vi.mock('../../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn().mockResolvedValue(null),
}));

// ─── Mock task events（不测 WebSocket 推送）─────────────────────────────────
vi.mock('../../events/taskEvents.js', () => ({
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));

// ─── Mock event-bus（不测事件系统）──────────────────────────────────────────
vi.mock('../../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(null),
}));

// ─── Mock circuit-breaker（不测熔断）────────────────────────────────────────
vi.mock('../../circuit-breaker.js', () => ({
  recordSuccess: vi.fn().mockResolvedValue(null),
  recordFailure: vi.fn().mockResolvedValue(null),
}));

// ─── Mock notifier（不测通知）───────────────────────────────────────────────
vi.mock('../../notifier.js', () => ({
  notifyTaskCompleted: vi.fn().mockResolvedValue(null),
}));

// ─── Mock alerting（不测告警）───────────────────────────────────────────────
vi.mock('../../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(null),
}));

// ─── Mock quarantine（不测隔离逻辑）─────────────────────────────────────────
vi.mock('../../quarantine.js', () => ({
  handleTaskFailure: vi.fn().mockResolvedValue({ quarantined: false }),
  classifyFailure: vi.fn().mockReturnValue({ class: 'unknown', confidence: 0.5 }),
}));

// ─── Mock desire-feedback（不测欲望系统）────────────────────────────────────
vi.mock('../../desire-feedback.js', () => ({
  updateDesireFromTask: vi.fn().mockResolvedValue(null),
}));

// ─── Mock routes/shared（不测记忆关闭）──────────────────────────────────────
vi.mock('../../routes/shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn().mockResolvedValue(null),
}));

// ─── Mock dynamic imports（executor/progress-ledger）────────────────────────
vi.mock('../../executor.js', () => ({
  removeActiveProcess: vi.fn(),
  setBillingPause: vi.fn(),
}));

vi.mock('../../progress-ledger.js', () => ({
  recordProgressStep: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../code-review-trigger.js', () => ({
  checkAndCreateCodeReviewTrigger: vi.fn().mockResolvedValue(null),
}));

// ─────────────────────────────────────────────────────────────────────────────

describe('callback-processor 集成测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 mock：pool.query 返回空，pool.connect 返回 mock client
    mockPool.query.mockResolvedValue({ rows: [] });
    mockClient.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Path 1: 状态映射 ─────────────────────────────────────────────────────

  describe('Path 1: 状态映射链路', () => {
    it('AI Done → newStatus = completed', async () => {
      const { processExecutionCallback } = await import('../../callback-processor.js');

      // 非 dev 任务，避免触发 completed_no_pr 检查
      mockPool.query.mockResolvedValue({ rows: [{ task_type: 'explore', payload: {} }] });

      const result = await processExecutionCallback({
        task_id: 'task-001',
        run_id: 'run-001',
        status: 'AI Done',
        result: { result: '探索完成' },
        pr_url: 'https://github.com/test/repo/pull/1',
        duration_ms: 5000,
      }, mockPool);

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('completed');
    });

    it('AI Failed → newStatus = failed', async () => {
      const { processExecutionCallback } = await import('../../callback-processor.js');

      const result = await processExecutionCallback({
        task_id: 'task-002',
        run_id: 'run-002',
        status: 'AI Failed',
        result: { result: 'CI 未通过' },
        duration_ms: 3000,
      }, mockPool);

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('failed');
    });

    it('AI Quota Exhausted → newStatus = quota_exhausted', async () => {
      const { processExecutionCallback } = await import('../../callback-processor.js');

      const result = await processExecutionCallback({
        task_id: 'task-003',
        run_id: 'run-003',
        status: 'AI Quota Exhausted',
        result: null,
        duration_ms: 1000,
      }, mockPool);

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('quota_exhausted');
    });

    it('未知 status → newStatus = in_progress（不终止任务）', async () => {
      const { processExecutionCallback } = await import('../../callback-processor.js');

      const result = await processExecutionCallback({
        task_id: 'task-004',
        run_id: 'run-004',
        status: 'AI Checkpoint',
        result: { progress: 50 },
        duration_ms: 2000,
      }, mockPool);

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('in_progress');
    });
  });

  // ─── Path 2: Dev 任务无 PR → completed_no_pr ──────────────────────────────

  describe('Path 2: dev 任务无 PR 状态转换', () => {
    it('dev 任务 AI Done 且无 pr_url → completed_no_pr', async () => {
      const { processExecutionCallback } = await import('../../callback-processor.js');

      // 第一次 pool.query：terminal check 返回无 failure_class
      // 第二次 pool.query：dev check 返回 task_type = dev（普通dev任务，无harness_mode）
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ task_type: 'dev', payload: {} }] }) // completed_no_pr check
        .mockResolvedValueOnce({ rows: [{ failure_class: null }] })            // terminal check
        .mockResolvedValue({ rows: [] });

      const result = await processExecutionCallback({
        task_id: 'task-005',
        run_id: 'run-005',
        status: 'AI Done',
        result: { result: '代码写完了' },
        // pr_url 为 undefined — 无 PR
        duration_ms: 8000,
      }, mockPool);

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('completed_no_pr');
    });

    it('dev 任务有 pr_url → 保持 completed（不降级）', async () => {
      const { processExecutionCallback } = await import('../../callback-processor.js');

      mockPool.query.mockResolvedValue({ rows: [{ failure_class: null }] });

      const result = await processExecutionCallback({
        task_id: 'task-006',
        run_id: 'run-006',
        status: 'AI Done',
        result: { result: '成功' },
        pr_url: 'https://github.com/test/repo/pull/42',
        duration_ms: 6000,
      }, mockPool);

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('completed');
    });

    it('harness_mode=true 的 dev 任务无 PR → 保持 completed（harness 不降级）', async () => {
      const { processExecutionCallback } = await import('../../callback-processor.js');

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ task_type: 'dev', payload: { harness_mode: true } }] }) // dev check
        .mockResolvedValueOnce({ rows: [{ failure_class: null }] })                                 // terminal check
        .mockResolvedValue({ rows: [] });

      const result = await processExecutionCallback({
        task_id: 'task-007',
        run_id: 'run-007',
        status: 'AI Done',
        result: null,
        // pr_url 缺失（harness 模式下允许）
        duration_ms: 4000,
      }, mockPool);

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('completed');
    });
  });

  // ─── Path 3: terminal failure guard ──────────────────────────────────────

  describe('Path 3: terminal_failure_guard', () => {
    it('pipeline_terminal_failure 时拒绝覆盖为 completed，返回 skipped', async () => {
      const { processExecutionCallback } = await import('../../callback-processor.js');

      // pr_url 存在（跳过 completed_no_pr 检查），terminal check 返回 pipeline_terminal_failure
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ failure_class: 'pipeline_terminal_failure' }] }) // terminal check
        .mockResolvedValue({ rows: [] });

      const result = await processExecutionCallback({
        task_id: 'task-008',
        run_id: 'run-008',
        status: 'AI Done',
        result: { result: '尝试恢复' },
        pr_url: 'https://github.com/test/repo/pull/99',
        duration_ms: 3000,
      }, mockPool);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('terminal_failure_guard');
    });
  });

  // ─── Path 4: task_id 缺失 ─────────────────────────────────────────────────

  describe('Path 4: 输入校验', () => {
    it('task_id 缺失时抛出 Error', async () => {
      const { processExecutionCallback } = await import('../../callback-processor.js');

      await expect(processExecutionCallback({
        run_id: 'run-009',
        status: 'AI Done',
        result: {},
      }, mockPool)).rejects.toThrow('task_id is required');
    });
  });

  // ─── Path 5: 失败分类 — auth 错误跳过熔断 ─────────────────────────────────

  describe('Path 5: 失败分类与熔断逻辑', () => {
    it('auth 错误不触发熔断计数（transient=true）', async () => {
      const { processExecutionCallback } = await import('../../callback-processor.js');
      const { classifyFailure } = await import('../../quarantine.js');
      const { recordFailure } = await import('../../circuit-breaker.js');

      // 将 classifyFailure mock 返回 auth 错误
      classifyFailure.mockReturnValueOnce({ class: 'auth', confidence: 0.9 });

      mockPool.query.mockResolvedValue({ rows: [{ task_type: 'dev', payload: {} }] });

      await processExecutionCallback({
        task_id: 'task-010',
        run_id: 'run-010',
        status: 'AI Failed',
        result: 'Failed to authenticate. API Error: 401',
        duration_ms: 1000,
      }, mockPool);

      // auth 错误 → 不调用 circuit-breaker.recordFailure
      expect(recordFailure).not.toHaveBeenCalled();
    });
  });
});
