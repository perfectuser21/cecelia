/**
 * callback-authority-propagation.test.js
 *
 * TDD RED → GREEN: 验证 resolvedPrUrl 贯通 callback 生命周期全路径
 *
 * 场景：callback body pr_url=null，但 task.payload.existing_pr_url 有合法 GitHub URL。
 * 修复前：prNumber/$8、publishTaskCompleted.pr_url、serialUnlockNext.pr_url、
 *         promoteRegressionOnHarnessMerged.pr_url 全部得到 null（原始 pr_url）。
 * 修复后：所有路径都使用 resolvedPrUrl（从 DB 兜底的权威 URL）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const CANONICAL_URL = 'https://github.com/perfectuser21/cecelia/pull/4830';
const TASK_ID = 'task-authority-prop-001';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({
    level: 'normal',
    actions: [{ type: 'fallback_to_tick' }],
  }),
  EVENT_TYPES: { TASK_COMPLETED: 'task_completed', TASK_FAILED: 'task_failed' },
}));
vi.mock('../decision-executor.js', () => ({ executeDecision: vi.fn().mockResolvedValue(null) }));
vi.mock('../embedding-service.js', () => ({ generateTaskEmbeddingAsync: vi.fn().mockResolvedValue(null) }));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(null) }));
vi.mock('../circuit-breaker.js', () => ({
  recordSuccess: vi.fn().mockResolvedValue(null),
  recordFailure: vi.fn().mockResolvedValue(null),
}));
vi.mock('../notifier.js', () => ({ notifyTaskCompleted: vi.fn().mockResolvedValue(null) }));
vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(null) }));
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn().mockResolvedValue({ quarantined: false }),
  classifyFailure: vi.fn().mockReturnValue({ class: 'unknown', confidence: 0.5 }),
}));
vi.mock('../desire-feedback.js', () => ({ updateDesireFromTask: vi.fn().mockResolvedValue(null) }));
vi.mock('../routes/shared.js', () => ({ resolveRelatedFailureMemories: vi.fn().mockResolvedValue(null) }));
vi.mock('../executor.js', () => ({ removeActiveProcess: vi.fn(), setBillingPause: vi.fn() }));
vi.mock('../progress-ledger.js', () => ({ recordProgressStep: vi.fn().mockResolvedValue(null) }));
vi.mock('../code-review-trigger.js', () => ({ checkAndCreateCodeReviewTrigger: vi.fn().mockResolvedValue(null) }));
vi.mock('../lib/callback-postprocess.js', () => ({
  serialUnlockNext: vi.fn().mockResolvedValue(null),
  writeReviewResult: vi.fn().mockResolvedValue(null),
  promoteRegressionOnHarnessMerged: vi.fn().mockResolvedValue(null),
}));

import { publishTaskCompleted } from '../events/taskEvents.js';
import { serialUnlockNext, promoteRegressionOnHarnessMerged } from '../lib/callback-postprocess.js';
import { processExecutionCallback } from '../callback-processor.js';

// ── 工厂函数：构造模拟 pool，使 resolveCanonicalPrUrl 能返回 CANONICAL_URL ──
function makePool() {
  const updateParams = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      if (/BEGIN|COMMIT|ROLLBACK/i.test(sql)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(sql)) {
        updateParams.push(params);
        return { rows: [], rowCount: 1 };
      }
      if (/INSERT INTO decision_log/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    updateParams,
    query: vi.fn(async (sql, params) => {
      // resolveCanonicalPrUrl: SELECT pr_url, payload FROM tasks WHERE id = $1
      if (/SELECT pr_url, payload/i.test(sql)) {
        return {
          rows: [{
            pr_url: null,
            payload: { existing_pr_url: CANONICAL_URL },
          }],
        };
      }
      // maybeMarkCompletedNoPr: SELECT task_type, pr_url, payload FROM tasks WHERE id = $1
      if (/SELECT task_type/i.test(sql)) {
        return {
          rows: [{
            task_type: 'dev',
            pr_url: null,
            payload: { existing_pr_url: CANONICAL_URL },
          }],
        };
      }
      // terminal failure guard
      if (/failure_class|orchestrator/i.test(sql)) {
        return { rows: [{ failure_class: null, task_type: 'dev', orchestrator: null }] };
      }
      // retry_count (completed_no_pr path)
      if (/SELECT retry_count/i.test(sql)) return { rows: [{ retry_count: 0 }] };
      return { rows: [] };
    }),
    connect: vi.fn(async () => client),
  };
  return pool;
}

describe('callback-authority-propagation — resolvedPrUrl 贯通全路径', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prNumber($8) 应从 resolvedPrUrl 提取（非 null）', async () => {
    const pool = makePool();
    await processExecutionCallback({
      task_id: TASK_ID,
      run_id: 'run-001',
      status: 'AI Done',
      pr_url: null, // callback body 没有 URL
      result: { result: 'done' },
    }, pool);

    // $8 是 prNumber 参数（UPDATE 中第8个占位符，index 7）
    const updateCall = pool.updateParams[0];
    expect(updateCall).toBeDefined();
    // prNumber = extractPrNumber(resolvedPrUrl) = extractPrNumber('https://github.com/.../pull/4830') = 4830
    expect(updateCall[7]).toBe(4830);
  });

  it('publishTaskCompleted 收到 resolvedPrUrl（非 null）', async () => {
    const pool = makePool();
    await processExecutionCallback({
      task_id: TASK_ID,
      run_id: 'run-002',
      status: 'AI Done',
      pr_url: null,
      result: { result: 'done' },
    }, pool);

    expect(publishTaskCompleted).toHaveBeenCalled();
    const callArgs = vi.mocked(publishTaskCompleted).mock.calls[0];
    // 第三个参数是 { pr_url, duration_ms, iterations }
    expect(callArgs[2].pr_url).toBe(CANONICAL_URL);
  });

  it('serialUnlockNext 收到 resolvedPrUrl 作为 pr_url 参数（非 null）', async () => {
    const pool = makePool();
    await processExecutionCallback({
      task_id: TASK_ID,
      run_id: 'run-003',
      status: 'AI Done',
      pr_url: null,
      result: { result: 'done' },
    }, pool);

    expect(serialUnlockNext).toHaveBeenCalled();
    const callArgs = vi.mocked(serialUnlockNext).mock.calls[0];
    // serialUnlockNext(task_id, result, pr_url, pool) — 第3个参数 pr_url
    expect(callArgs[2]).toBe(CANONICAL_URL);
  });

  it('promoteRegressionOnHarnessMerged 收到 resolvedPrUrl 作为 pr_url 参数（非 null）', async () => {
    const pool = makePool();
    await processExecutionCallback({
      task_id: TASK_ID,
      run_id: 'run-004',
      status: 'AI Done',
      pr_url: null,
      result: { result: 'done' },
    }, pool);

    expect(promoteRegressionOnHarnessMerged).toHaveBeenCalled();
    const callArgs = vi.mocked(promoteRegressionOnHarnessMerged).mock.calls[0];
    // promoteRegressionOnHarnessMerged(task_id, result, pr_url, pool) — 第3个参数 pr_url
    expect(callArgs[2]).toBe(CANONICAL_URL);
  });

  it('非法 explicit URL 不覆盖合法 DB fallback', async () => {
    const pool = makePool();
    await processExecutionCallback({
      task_id: TASK_ID,
      run_id: 'run-005',
      status: 'AI Done',
      pr_url: 'garbage-not-a-url', // 非法显式 URL
      result: { result: 'done' },
    }, pool);

    // resolvedPrUrl 应回退到 DB 的 existing_pr_url
    const updateCall = pool.updateParams[0];
    expect(updateCall).toBeDefined();
    expect(updateCall[4]).toBe(CANONICAL_URL); // $5 是 resolvedPrUrl || null
    expect(updateCall[7]).toBe(4830); // $8 是 prNumber
  });

  it('status=completed，retry_count 不增长', async () => {
    const pool = makePool();
    const result = await processExecutionCallback({
      task_id: TASK_ID,
      run_id: 'run-006',
      status: 'AI Done',
      pr_url: null,
      result: { result: 'done' },
    }, pool);

    // 有 resolvedPrUrl → status 应为 completed，不应触发 completed_no_pr 重排
    expect(result.newStatus).toBe('completed');
    // 不应有 retry_count+1 的 UPDATE
    const retryUpdate = pool.query.mock.calls.find(c =>
      typeof c[0] === 'string' && /retry_count\s*=\s*retry_count\s*\+\s*1/.test(c[0])
    );
    expect(retryUpdate).toBeUndefined();
  });
});
