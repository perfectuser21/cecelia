/**
 * oom-vs-api-disconnect.test.js
 *
 * 回归测试：callback-processor 层对 OOM（exit=137）的 skipCount 行为
 *
 * OOM 根因是资源配置，首次重试即可解决，不应累积 failure_count 触发 quarantine。
 * failure_class='docker_oom_killed' 由 docker-executor.js 设定并经 callback_queue 传递。
 *
 * Learning ID: 2f561d31-8de7-4b76-89c7-6b04674c805a
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock 所有外部依赖 ──────────────────────────────────────────────────────

const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
};
const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  connect: vi.fn().mockResolvedValue(mockClient),
};
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({ level: 'normal', actions: [] }),
  EVENT_TYPES: { TASK_COMPLETED: 'task_completed', TASK_FAILED: 'task_failed' },
}));
vi.mock('../decision-executor.js', () => ({ executeDecision: vi.fn().mockResolvedValue(null) }));
vi.mock('../embedding-service.js', () => ({ generateTaskEmbeddingAsync: vi.fn().mockResolvedValue(null) }));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(null) }));
vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(null) }));
vi.mock('../desire-feedback.js', () => ({ updateDesireFromTask: vi.fn().mockResolvedValue(null) }));
vi.mock('../routes/shared.js', () => ({ resolveRelatedFailureMemories: vi.fn().mockResolvedValue(null) }));
vi.mock('../executor.js', () => ({ removeActiveProcess: vi.fn(), setBillingPause: vi.fn() }));
vi.mock('../progress-ledger.js', () => ({ recordProgressStep: vi.fn().mockResolvedValue(null) }));
vi.mock('../code-review-trigger.js', () => ({
  checkAndCreateCodeReviewTrigger: vi.fn().mockResolvedValue(null),
}));
vi.mock('../notifier.js', () => ({ notifyTaskCompleted: vi.fn().mockResolvedValue(null) }));

// circuit-breaker spy
const mockRecordFailure = vi.fn().mockResolvedValue(null);
const mockRecordSuccess = vi.fn().mockResolvedValue(null);
vi.mock('../circuit-breaker.js', () => ({
  recordSuccess: (...args) => mockRecordSuccess(...args),
  recordFailure: (...args) => mockRecordFailure(...args),
}));

// quarantine spy - 保留真实 classifyFailure，mock handleTaskFailure
const mockHandleTaskFailure = vi.fn().mockResolvedValue({ quarantined: false });
vi.mock('../quarantine.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    handleTaskFailure: (...args) => mockHandleTaskFailure(...args),
  };
});

// ─────────────────────────────────────────────────────────────────────────────

describe('OOM killed（exit=137）→ callback-processor skipCount=true', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
    mockClient.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(mockClient);
    mockHandleTaskFailure.mockResolvedValue({ quarantined: false });
    mockRecordFailure.mockResolvedValue(null);
    mockRecordSuccess.mockResolvedValue(null);
  });

  it('failure_class=docker_oom_killed 时，handleTaskFailure 以 skipCount=true 调用', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    await processExecutionCallback(
      {
        task_id: 'oom-test-task-001',
        run_id: 'run-oom-1',
        status: 'AI Failed',
        result: null,
        exit_code: 137,
        failure_class: 'docker_oom_killed',
      },
      mockPool
    );

    expect(mockHandleTaskFailure).toHaveBeenCalledWith(
      'oom-test-task-001',
      expect.objectContaining({ skipCount: true })
    );
  });

  it('exit_code=137（无 failure_class）时，handleTaskFailure 以 skipCount=true 调用', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    await processExecutionCallback(
      {
        task_id: 'oom-test-task-002',
        run_id: 'run-oom-2',
        status: 'AI Failed',
        result: null,
        exit_code: 137,
      },
      mockPool
    );

    expect(mockHandleTaskFailure).toHaveBeenCalledWith(
      'oom-test-task-002',
      expect.objectContaining({ skipCount: true })
    );
  });

  it('OOM 时不调用 circuit-breaker recordFailure（不归因于 cecelia-run）', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    await processExecutionCallback(
      {
        task_id: 'oom-test-task-003',
        run_id: 'run-oom-3',
        status: 'AI Failed',
        result: null,
        exit_code: 137,
        failure_class: 'docker_oom_killed',
      },
      mockPool
    );

    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it('普通失败（exit_code=1）应以 skipCount=false 调用 handleTaskFailure', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    await processExecutionCallback(
      {
        task_id: 'normal-fail-task-001',
        run_id: 'run-normal-1',
        status: 'AI Failed',
        result: { error: 'TypeError: Cannot read property' },
        exit_code: 1,
      },
      mockPool
    );

    expect(mockHandleTaskFailure).toHaveBeenCalledWith(
      'normal-fail-task-001',
      expect.objectContaining({ skipCount: false })
    );
  });

  it('OOM 与普通失败 skipCount 行为差异：OOM=true，普通=false', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    // OOM 失败
    await processExecutionCallback(
      {
        task_id: 'diff-test-oom',
        run_id: 'run-diff-oom',
        status: 'AI Failed',
        result: null,
        exit_code: 137,
        failure_class: 'docker_oom_killed',
      },
      mockPool
    );
    const oomCall = mockHandleTaskFailure.mock.calls[0];
    expect(oomCall[1].skipCount).toBe(true);

    // 重置
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
    mockClient.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(mockClient);
    mockHandleTaskFailure.mockResolvedValue({ quarantined: false });

    // 普通失败
    await processExecutionCallback(
      {
        task_id: 'diff-test-normal',
        run_id: 'run-diff-normal',
        status: 'AI Failed',
        result: { error: 'Test failed: assertion error' },
        exit_code: 1,
      },
      mockPool
    );
    const normalCall = mockHandleTaskFailure.mock.calls[0];
    expect(normalCall[1].skipCount).toBe(false);
  });
});
