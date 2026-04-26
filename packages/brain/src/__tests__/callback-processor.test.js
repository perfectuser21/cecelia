/**
 * callback-processor.test.js
 *
 * 验证 callback-processor.js 的 WHERE 守卫逻辑：
 * - guard 必须使用白名单 IN ('in_progress', 'queued', 'dispatched')
 * - 修复根因：cecelia-run.sh 抢跑 update-task 把 status 改为 completed，
 *   导致 WHERE status='in_progress' 严格守卫失效，agent result 从未写入 tasks.result
 *   （harness_evaluate 84% verdict=null 根因）
 *
 * TDD 红绿流程：
 *   修复前 → FAIL（WHERE status = 'in_progress' 单一匹配）
 *   修复后 → PASS（WHERE status IN ('in_progress', 'queued', 'dispatched')）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB pool（支持事务：pool.query + pool.connect + client）─────────────
const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
};
const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  connect: vi.fn().mockResolvedValue(mockClient),
};
vi.mock('../db.js', () => ({ default: mockPool }));

// ─── Mock thalamus──────────────────────────────────────────────────────────
vi.mock('../thalamus.js', () => ({
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

// ─── Mock decision-executor───────────────────────────────────────────────
vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn().mockResolvedValue(null),
}));

// ─── Mock embedding──────────────────────────────────────────────────────
vi.mock('../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn().mockResolvedValue(null),
}));

// ─── Mock task events────────────────────────────────────────────────────
vi.mock('../events/taskEvents.js', () => ({
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));

// ─── Mock event-bus──────────────────────────────────────────────────────
vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(null),
}));

// ─── Mock circuit-breaker───────────────────────────────────────────────
vi.mock('../circuit-breaker.js', () => ({
  recordSuccess: vi.fn().mockResolvedValue(null),
  recordFailure: vi.fn().mockResolvedValue(null),
}));

// ─── Mock notifier──────────────────────────────────────────────────────
vi.mock('../notifier.js', () => ({
  notifyTaskCompleted: vi.fn().mockResolvedValue(null),
}));

// ─── Mock alerting──────────────────────────────────────────────────────
vi.mock('../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(null),
}));

// ─── Mock quarantine────────────────────────────────────────────────────
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn().mockResolvedValue({ quarantined: false }),
  classifyFailure: vi.fn().mockReturnValue({ class: 'unknown', confidence: 0.5 }),
}));

// ─── Mock desire-feedback───────────────────────────────────────────────
vi.mock('../desire-feedback.js', () => ({
  updateDesireFromTask: vi.fn().mockResolvedValue(null),
}));

// ─── Mock routes/shared────────────────────────────────────────────────
vi.mock('../routes/shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn().mockResolvedValue(null),
}));

// ─── Mock dynamic imports──────────────────────────────────────────────
vi.mock('../executor.js', () => ({
  removeActiveProcess: vi.fn(),
  setBillingPause: vi.fn(),
}));

vi.mock('../progress-ledger.js', () => ({
  recordProgressStep: vi.fn().mockResolvedValue(null),
}));

vi.mock('../code-review-trigger.js', () => ({
  checkAndCreateCodeReviewTrigger: vi.fn().mockResolvedValue(null),
}));

// ─────────────────────────────────────────────────────────────────────────────

describe('callback-processor — WHERE 守卫白名单（harness_evaluate 84% verdict 修复）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
    mockClient.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(mockClient);
  });

  /**
   * 核心测试：UPDATE tasks WHERE 子句必须使用白名单
   *
   * 修复前（FAIL）：WHERE id = $1 AND status = 'in_progress'
   * 修复后（PASS）：WHERE id = $1 AND status IN ('in_progress', 'queued', 'dispatched')
   *
   * 根因：cecelia-run.sh 抢跑把 status 改为 completed，
   * 导致严格 'in_progress' 守卫失效，result 从未写入（84% verdict=null）
   */
  it('UPDATE tasks WHERE 子句必须使用白名单，包含 queued/dispatched 状态', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    await processExecutionCallback(
      {
        task_id: 'test-verdict-whitelist-1',
        run_id: 'run-verdict-1',
        status: 'AI Done',
        result: { verdict: 'PASS', summary: 'All contract items passed' },
        duration_ms: 5000,
        iterations: 3,
      },
      mockPool
    );

    const clientCalls = mockClient.query.mock.calls;
    const updateCall = clientCalls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks')
    );
    expect(updateCall, 'UPDATE tasks SQL 应被执行').toBeDefined();

    const sql = updateCall[0];
    // 修复后：WHERE 子句必须包含白名单（IN 语法），不能是单一 'in_progress'
    expect(sql, "WHERE 必须包含 status IN (").toContain("status IN (");
    expect(sql, "白名单必须包含 'in_progress'").toContain("'in_progress'");
    expect(sql, "白名单必须包含 'queued'").toContain("'queued'");
    expect(sql, "白名单必须包含 'dispatched'").toContain("'dispatched'");
    // 不应再是严格的单一 status = 'in_progress' 匹配
    expect(sql, "不应使用严格的 AND status = 'in_progress'").not.toMatch(/AND status = 'in_progress'/);
  });

  it('harness_evaluate 收到 result callback 时，BEGIN/UPDATE/COMMIT 事务链路完整', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');

    await processExecutionCallback(
      {
        task_id: 'test-harness-eval-verdict',
        run_id: 'run-harness-1',
        status: 'AI Done',
        result: JSON.stringify({ verdict: 'PASS', summary: 'All contract items passed' }),
        duration_ms: 8000,
        iterations: 5,
      },
      mockPool
    );

    const clientCalls = mockClient.query.mock.calls;

    // BEGIN 事务开始
    expect(clientCalls[0][0]).toBe('BEGIN');

    // UPDATE tasks 被执行
    const updateCall = clientCalls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks')
    );
    expect(updateCall, 'UPDATE tasks 应被执行').toBeDefined();

    // COMMIT 事务完成
    const commitCalls = clientCalls.filter(
      c => typeof c[0] === 'string' && c[0] === 'COMMIT'
    );
    expect(commitCalls.length, 'COMMIT 应被调用至少一次').toBeGreaterThanOrEqual(1);

    // client 被释放
    expect(mockClient.release, 'client.release 应被调用').toHaveBeenCalled();
  });
});

/**
 * docker-executor 把 callback_queue.status 写为 'success'/'failed'/'timeout'，
 * 旧版 callback-processor 只识别 'AI Done'/'AI Failed'/'AI Quota Exhausted'，
 * 命中 else 分支后 newStatus 落到 'in_progress' → 跑成功的容器任务卡住，
 * 60min 后 tick 误判超时，三次后 quarantine。修于本次。
 */
describe('callback-processor — docker contract status mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
    mockClient.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(mockClient);
  });

  function findUpdateCall() {
    return mockClient.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks')
    );
  }

  it("status='success'（docker exit 0）→ newStatus=completed", async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');
    await processExecutionCallback(
      { task_id: 'docker-ok-1', run_id: 'r1', status: 'success', result: { ok: true }, duration_ms: 47000 },
      mockPool
    );
    const update = findUpdateCall();
    expect(update, 'UPDATE tasks 应被执行').toBeDefined();
    expect(update[1][1], "newStatus must map success → completed").toBe('completed');
  });

  it("status='failed'（docker exit !=0）→ newStatus=failed", async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');
    await processExecutionCallback(
      { task_id: 'docker-fail-1', run_id: 'r2', status: 'failed', result: { error: 'boom' }, exit_code: 137 },
      mockPool
    );
    const update = findUpdateCall();
    expect(update[1][1]).toBe('failed');
  });

  it("status='timeout'（docker SIGKILL）→ newStatus=failed", async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');
    await processExecutionCallback(
      { task_id: 'docker-timeout-1', run_id: 'r3', status: 'timeout', result: { timed_out: true } },
      mockPool
    );
    const update = findUpdateCall();
    expect(update[1][1]).toBe('failed');
  });

  it("bridge 协议 'AI Done' 仍然映射到 completed（向后兼容）", async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');
    await processExecutionCallback(
      { task_id: 'bridge-ok-1', run_id: 'r4', status: 'AI Done', result: { verdict: 'DONE' } },
      mockPool
    );
    const update = findUpdateCall();
    expect(update[1][1]).toBe('completed');
  });
});
