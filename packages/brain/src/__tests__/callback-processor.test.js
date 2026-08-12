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
import { processExecutionCallback } from '../callback-processor.js';

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

import { processEvent as thalamusProcessEvent } from '../thalamus.js';
import { executeDecision as executeThalamusDecision } from '../decision-executor.js';
import { recordFailure as recordCircuitFailure } from '../circuit-breaker.js';
import { handleTaskFailure, classifyFailure } from '../quarantine.js';

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
    expect(sql).toContain("payload->>'current_run_id' = $14::text");
    expect(sql).not.toContain("payload->>'current_run_id' IS NULL");
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
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPool.connect.mockResolvedValue(mockClient);
  });

  function findUpdateCall() {
    return mockClient.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks')
    );
  }

  function findDecisionLogCall() {
    return mockClient.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO decision_log')
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

  it("status='success'（docker exit 0）→ decision_log.status='success'（不得为 failed）", async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');
    await processExecutionCallback(
      { task_id: 'docker-ok-2', run_id: 'r1b', status: 'success', result: { ok: true } },
      mockPool
    );
    const decisionCall = findDecisionLogCall();
    expect(decisionCall, 'decision_log INSERT 应被执行').toBeDefined();
    expect(decisionCall[1][4], "docker 'success' 回调 decision_log.status 必须是 'success' 而非 'failed'").toBe('success');
  });

  it("status='AI Done'（bridge 协议）→ decision_log.status='success'", async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');
    await processExecutionCallback(
      { task_id: 'bridge-ok-2', run_id: 'r4b', status: 'AI Done', result: { verdict: 'DONE' } },
      mockPool
    );
    const decisionCall = findDecisionLogCall();
    expect(decisionCall, 'decision_log INSERT 应被执行').toBeDefined();
    expect(decisionCall[1][4], "'AI Done' 回调 decision_log.status 必须是 'success'").toBe('success');
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

  it("status='failed'（docker exit !=0）→ decision_log.status='failed'", async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');
    await processExecutionCallback(
      { task_id: 'docker-fail-2', run_id: 'r2b', status: 'failed', result: { error: 'boom' }, exit_code: 137 },
      mockPool
    );
    const decisionCall = findDecisionLogCall();
    expect(decisionCall, 'decision_log INSERT 应被执行').toBeDefined();
    expect(decisionCall[1][4]).toBe('failed');
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

describe('C1/C3: 回调写库协议(updated_at + terminal 清 claim + applied)', () => {
  beforeEach(() => {
    mockClient.query.mockReset();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  function findMainUpdate() {
    return mockClient.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && /UPDATE tasks/.test(c[0]) && /status = \$2/.test(c[0])
    );
  }

  it('completed 回调:UPDATE 必须刷 updated_at 且 terminal 参数为 true(清 claim)', async () => {
    await processExecutionCallback(
      { task_id: '11111111-1111-1111-1111-111111111111', run_id: 'r-1', status: 'AI Done', result: { ok: 1 } },
      mockPool
    );
    const call = findMainUpdate();
    expect(call).toBeTruthy();
    expect(call[0]).toMatch(/updated_at = NOW\(\)/);
    expect(call[0]).toMatch(/claimed_by = CASE WHEN \$13::boolean THEN NULL ELSE claimed_by END/);
    expect(call[0]).toMatch(/claimed_at = CASE WHEN \$13::boolean THEN NULL ELSE claimed_at END/);
    expect(call[1][12]).toBe(true);
  });

  it('quota_exhausted 回调:非 terminal,claim 参数为 false 不清', async () => {
    await processExecutionCallback(
      { task_id: '11111111-1111-1111-1111-111111111111', run_id: 'r-2', status: 'AI Quota Exhausted', result: {} },
      mockPool
    );
    const call = findMainUpdate();
    expect(call).toBeTruthy();
    expect(call[1][12]).toBe(false);
  });

  it('rowCount=0(迟到回调被 WHERE 守卫拦下)返回 applied:false', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const ret = await processExecutionCallback(
      { task_id: '11111111-1111-1111-1111-111111111111', run_id: 'r-3', status: 'AI Done', result: {} },
      mockPool
    );
    expect(ret && ret.applied).toBe(false);
  });

  it('rowCount=1 正常落地返回 applied:true', async () => {
    const ret = await processExecutionCallback(
      { task_id: '11111111-1111-1111-1111-111111111111', run_id: 'r-4', status: 'AI Done', result: {} },
      mockPool
    );
    expect(ret && ret.applied).toBe(true);
  });
});

describe('P0 回归：重复回调、隔离终态与熔断边界', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    handleTaskFailure.mockResolvedValue({ quarantined: false, failure_count: 1 });
    classifyFailure.mockReturnValue({ class: 'unknown', confidence: 0.5 });
  });

  it('UPDATE 未应用的重复回调必须立即结束，不能再次计数、隔离或触发重试', async () => {
    mockClient.query.mockImplementation(async (sql) => ({
      rows: [],
      rowCount: typeof sql === 'string' && sql.includes('UPDATE tasks') ? 0 : 1,
    }));

    const result = await processExecutionCallback({
      task_id: '11111111-1111-4111-8111-111111111111',
      run_id: '22222222-2222-4222-8222-222222222222',
      status: 'AI Failed',
      result: { error: 'duplicate callback' },
      iterations: 1,
    }, mockPool);

    expect(result).toMatchObject({ applied: false, duplicate: true });
    expect(recordCircuitFailure).not.toHaveBeenCalled();
    expect(handleTaskFailure).not.toHaveBeenCalled();
    expect(thalamusProcessEvent).not.toHaveBeenCalled();
    expect(executeThalamusDecision).not.toHaveBeenCalled();
  });

  it('任务进入 quarantine 后不得再把 TASK_FAILED 交给 Thalamus 复活', async () => {
    handleTaskFailure.mockResolvedValueOnce({ quarantined: true, failure_count: 3, result: { reason: 'repeated_failure' } });

    await processExecutionCallback({
      task_id: '33333333-3333-4333-8333-333333333333',
      run_id: '44444444-4444-4444-8444-444444444444',
      status: 'AI Failed',
      result: { error: 'persistent task error' },
      iterations: 1,
    }, mockPool);

    expect(thalamusProcessEvent).not.toHaveBeenCalled();
    expect(executeThalamusDecision).not.toHaveBeenCalled();
  });

  it('Thalamus retry_count 使用数据库持久化 failure_count，不使用 Bridge attempt', async () => {
    handleTaskFailure.mockResolvedValueOnce({ quarantined: false, failure_count: 2 });

    await processExecutionCallback({
      task_id: '55555555-5555-4555-8555-555555555555',
      run_id: '66666666-6666-4666-8666-666666666666',
      status: 'AI Failed',
      result: { error: 'second persistent failure' },
      iterations: 1,
    }, mockPool);

    expect(thalamusProcessEvent).toHaveBeenCalledWith(expect.objectContaining({ retry_count: 2 }));
  });

  it('task_error 只影响当前任务，不得打开 cecelia-run 全局熔断器', async () => {
    classifyFailure.mockReturnValueOnce({ class: 'task_error', confidence: 1 });

    await processExecutionCallback({
      task_id: '77777777-7777-4777-8777-777777777777',
      run_id: '88888888-8888-4888-8888-888888888888',
      status: 'AI Failed',
      result: { error: 'repository contract violation' },
    }, mockPool);

    expect(recordCircuitFailure).not.toHaveBeenCalledWith('cecelia-run');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5c11 回归：callback-processor 路径的串行解锁
// 背景：processor 是 cecelia-run DB 直写消费者，历史上完全没有 serialUnlockNext 调用，
//       导致 T2 完成后 T3 不自动解锁（2026-07-10 活性合同事故）。
// ─────────────────────────────────────────────────────────────────────────────
describe('5c11 回归: callback-processor 路径串行解锁', () => {
  const seqTaskId = 'seq-task-1';
  const nextTaskId = 'seq-task-2';
  const projectId = 'proj-serial-regression';

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    // 默认：事务内操作返回 rowCount=1
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('processor 路径：seq=N dev task 完成 → blocked seq=N+1 task 被解锁并注入 prev_task_result', async () => {
    const prUrl = 'https://github.com/org/repo/pull/42';
    const resultSummary = 'Feature Y implemented via processor path';

    // pool.query 用于事务外查询（串行解锁、KR rollup 等）
    mockPool.query.mockImplementation((sql, params) => {
      // serialUnlockNext: 查当前 task 信息
      if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('task_type') &&
          sql.includes('project_id') && params?.[0] === seqTaskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'dev',
            project_id: projectId,
            goal_id: 'goal-001',
            title: 'Seq Task 1',
            payload: { sequence_order: 1 },
          }]
        });
      }
      // serialUnlockNext: 查 blocked 下一 task
      if (typeof sql === 'string' && sql.includes("payload->>'sequence_order'") && sql.includes('blocked')) {
        return Promise.resolve({
          rows: [{ id: nextTaskId, title: 'Seq Task 2', payload: { sequence_order: 2, depends_on_prev: 'true' } }]
        });
      }
      // serialUnlockNext: UPDATE blocked → queued
      if (typeof sql === 'string' && sql.includes('UPDATE tasks') && sql.includes("status = 'queued'") &&
          sql.includes('blocked_at = NULL')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      // writeReviewResult: 查 task_type（non-review task → 跳过）
      if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('task_type') &&
          sql.includes('payload') && params?.[0] === seqTaskId) {
        return Promise.resolve({ rows: [{ task_type: 'dev', payload: {} }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await processExecutionCallback(
      {
        task_id: seqTaskId,
        run_id: 'run-serial-1',
        status: 'AI Done',
        result: { summary: resultSummary },
        pr_url: prUrl,
      },
      mockPool
    );

    // 断言：pool.query 中有 UPDATE tasks SET status='queued' 针对 nextTaskId
    const unlockCall = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' &&
           c[0].includes('UPDATE tasks') &&
           c[0].includes("status = 'queued'") &&
           c[0].includes('blocked_at = NULL') &&
           c[1]?.[1] === nextTaskId
    );
    expect(unlockCall, '5c11: blocked next task 应被解锁').toBeDefined();

    // 断言：注入的 payload 含 prev_task_result 字段
    const injectedPayload = JSON.parse(unlockCall[1][0]);
    expect(injectedPayload.prev_task_result).toBeDefined();
    expect(injectedPayload.prev_task_result.task_id).toBe(seqTaskId);
    expect(injectedPayload.prev_task_result.summary).toBe(resultSummary);
    expect(injectedPayload.prev_task_result.pr_url).toBe(prUrl);
    expect(injectedPayload.prev_task_result.sequence_order).toBe(1);
  });

  it('processor 路径：独立 task（无 sequence_order）→ 不触发串行解锁', async () => {
    mockPool.query.mockImplementation((sql, params) => {
      if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('task_type') &&
          sql.includes('project_id') && params?.[0] === 'independent-task') {
        return Promise.resolve({
          rows: [{ task_type: 'dev', project_id: projectId, goal_id: null, title: 'Standalone', payload: {} }]
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await processExecutionCallback(
      { task_id: 'independent-task', run_id: 'run-ind-1', status: 'AI Done', result: { summary: 'done' } },
      mockPool
    );

    // 不应有针对 blocked tasks 的解锁查询
    const blockedQuery = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes("payload->>'sequence_order'") && c[0].includes('blocked')
    );
    expect(blockedQuery, '独立 task 不应触发串行解锁查询').toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue A: HTTP authority materialization
// callback body pr_url=null，DB existing_pr_url 有值 → SQL $5 和 lastRunResult.pr_url
// 必须使用权威 URL，tasks.pr_url / payload.last_run_result.pr_url 均非 null
// ─────────────────────────────────────────────────────────────────────────────
describe('processExecutionCallback — HTTP authority materialization（callback pr_url=null, DB 有 existing_pr_url）', () => {
  const CANONICAL_URL = 'https://github.com/perfectuser21/cecelia/pull/4830';

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    // 默认所有 pool.query 返回空（各测试内部覆盖需要的 SQL）
    mockPool.query.mockResolvedValue({ rows: [] });
    // 默认所有 client.query 返回空（各测试内部覆盖 UPDATE）
    mockClient.query.mockImplementation(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return {};
      if (typeof sql === 'string' && /UPDATE\s+tasks/i.test(sql)) {
        return { rowCount: 1, rows: [{ id: 'task-authority-123' }] };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('SQL $5（pr_url 参数）必须为 canonical URL，不得为 null（修复前为 null 因为 callback pr_url=null）', async () => {
    // 配置 pool.query：resolveCanonicalPrUrl / maybeMarkCompletedNoPr 的 SELECT 均返回含 existing_pr_url 的 task
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('payload') && /FROM\s+tasks/i.test(sql) && !sql.includes('failure_class') && !sql.includes('status')) {
        return { rows: [{ task_type: 'dev', pr_url: null, payload: { existing_pr_url: CANONICAL_URL } }] };
      }
      if (typeof sql === 'string' && sql.includes('failure_class')) {
        return { rows: [{ failure_class: null, task_type: 'dev', orchestrator: null }] };
      }
      return { rows: [] };
    });

    const { processExecutionCallback } = await import('../callback-processor.js');
    await processExecutionCallback(
      {
        task_id: 'task-authority-123',
        run_id: 'run-authority-1',
        status: 'AI Done',
        pr_url: null,          // callback 无 URL
        result: { result: 'Fixed the PR' },
        duration_ms: 5000,
        iterations: 3,
      },
      mockPool
    );

    const clientCalls = mockClient.query.mock.calls;
    const updateCall = clientCalls.find(c => typeof c[0] === 'string' && /UPDATE\s+tasks/i.test(c[0]));
    expect(updateCall, 'UPDATE tasks 必须被执行').toBeDefined();

    const params = updateCall[1];
    // 参数顺序: [task_id, newStatus, lastRunResultJson, status, pr_url, ...]
    // $5（index 4）= pr_url 参数
    // 修复前：null（callback pr_url || null）
    // 修复后：CANONICAL_URL（从 DB existing_pr_url 兜底）
    expect(params[4]).toBe(CANONICAL_URL);
  });

  it('lastRunResult.pr_url 必须为 canonical URL（$3 JSON），不得为 null', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('payload') && /FROM\s+tasks/i.test(sql) && !sql.includes('failure_class') && !sql.includes('status')) {
        return { rows: [{ task_type: 'dev', pr_url: null, payload: { existing_pr_url: CANONICAL_URL } }] };
      }
      if (typeof sql === 'string' && sql.includes('failure_class')) {
        return { rows: [{ failure_class: null, task_type: 'dev', orchestrator: null }] };
      }
      return { rows: [] };
    });

    const { processExecutionCallback } = await import('../callback-processor.js');
    await processExecutionCallback(
      {
        task_id: 'task-authority-456',
        run_id: 'run-authority-2',
        status: 'AI Done',
        pr_url: null,
        result: { result: 'PR merged' },
        duration_ms: 3000,
        iterations: 2,
      },
      mockPool
    );

    const clientCalls = mockClient.query.mock.calls;
    const updateCall = clientCalls.find(c => typeof c[0] === 'string' && /UPDATE\s+tasks/i.test(c[0]));
    expect(updateCall).toBeDefined();

    const params = updateCall[1];
    // $3（index 2）= JSON.stringify(lastRunResult)
    // 修复前：lastRunResult.pr_url = null
    // 修复后：lastRunResult.pr_url = CANONICAL_URL
    const lastRunResult = JSON.parse(params[2]);
    expect(lastRunResult.pr_url).toBe(CANONICAL_URL);
  });

  it('status 必须为 completed（不是 completed_no_pr），retry_count 不增长', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('payload') && /FROM\s+tasks/i.test(sql) && !sql.includes('failure_class') && !sql.includes('status')) {
        return { rows: [{ task_type: 'dev', pr_url: null, payload: { existing_pr_url: CANONICAL_URL } }] };
      }
      if (typeof sql === 'string' && sql.includes('failure_class')) {
        return { rows: [{ failure_class: null, task_type: 'dev', orchestrator: null }] };
      }
      return { rows: [] };
    });

    const { processExecutionCallback } = await import('../callback-processor.js');
    const res = await processExecutionCallback(
      {
        task_id: 'task-authority-789',
        run_id: 'run-authority-3',
        status: 'AI Done',
        pr_url: null,
        result: { result: 'Done' },
        duration_ms: 2000,
        iterations: 1,
      },
      mockPool
    );

    // newStatus 应为 completed
    expect(res.newStatus).toBe('completed');

    // UPDATE 参数中 $2（index 1）= newStatus
    const clientCalls = mockClient.query.mock.calls;
    const updateCall = clientCalls.find(c => typeof c[0] === 'string' && /UPDATE\s+tasks/i.test(c[0]));
    const params = updateCall[1];
    expect(params[1]).toBe('completed');
  });
});
