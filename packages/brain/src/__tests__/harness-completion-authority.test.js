/**
 * 收账权收归 — 四 completed 入口统一 finalize 外部真相核验（决策 dc18d43d/c3f473eb）。
 *
 * harness_initiative(skill-relay) 的 completed 请求被 finalize 拒绝时：
 * - callback-processor → newStatus 降级 in_progress（UPDATE status 参数不是 completed）
 * - PATCH /tasks/:id → 200 accepted:false 且 UPDATE 无 status 子句
 * - POST /harness/complete → 200 accepted:false 且无 status='completed' 的 UPDATE
 * finalize 放行（allow:true）或非 harness（applies:false）→ 原路径照旧 completed。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── finalize mock（vi.hoisted 保证 source 加载时拿到同一 spy）──
const { finalizeMock } = vi.hoisted(() => ({ finalizeMock: vi.fn() }));

// ===== callback-processor 直测（mock 全部下游依赖）=====
describe('收账权收归 — callback-processor', () => {
  const mockClient = { query: vi.fn(), release: vi.fn() };
  const mockPool = { query: vi.fn(), connect: vi.fn() };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [] });
    mockClient.release.mockReset();
    mockPool.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(mockClient);
    finalizeMock.mockReset();

    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.doMock('../lib/harness-finalize.js', () => ({ finalizeHarnessTask: finalizeMock }));
    vi.doMock('../thalamus.js', () => ({
      processEvent: vi.fn().mockResolvedValue({ level: 'normal', actions: [{ type: 'fallback_to_tick' }] }),
      executeDecision: vi.fn().mockResolvedValue(null),
      EVENT_TYPES: { TASK_COMPLETED: 'task_completed', TASK_FAILED: 'task_failed' },
    }));
    vi.doMock('../decision-executor.js', () => ({ executeDecision: vi.fn().mockResolvedValue(null) }));
    vi.doMock('../embedding-service.js', () => ({ generateTaskEmbeddingAsync: vi.fn().mockResolvedValue(null) }));
    vi.doMock('../events/taskEvents.js', () => ({ publishTaskCompleted: vi.fn(), publishTaskFailed: vi.fn() }));
    vi.doMock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(null) }));
    vi.doMock('../circuit-breaker.js', () => ({ recordSuccess: vi.fn().mockResolvedValue(null), recordFailure: vi.fn().mockResolvedValue(null) }));
    vi.doMock('../notifier.js', () => ({ notifyTaskCompleted: vi.fn().mockResolvedValue(null) }));
    vi.doMock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(null) }));
    vi.doMock('../quarantine.js', () => ({ handleTaskFailure: vi.fn().mockResolvedValue({ quarantined: false }), classifyFailure: vi.fn().mockReturnValue({ class: 'unknown', confidence: 0.5 }) }));
    vi.doMock('../desire-feedback.js', () => ({ updateDesireFromTask: vi.fn().mockResolvedValue(null) }));
    vi.doMock('../routes/shared.js', () => ({ resolveRelatedFailureMemories: vi.fn().mockResolvedValue(null) }));
    vi.doMock('../executor.js', () => ({ removeActiveProcess: vi.fn(), setBillingPause: vi.fn() }));
    vi.doMock('../progress-ledger.js', () => ({ recordProgressStep: vi.fn().mockResolvedValue(null) }));
    vi.doMock('../code-review-trigger.js', () => ({ checkAndCreateCodeReviewTrigger: vi.fn().mockResolvedValue(null) }));
  });

  function findUpdateCall() {
    return mockClient.query.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('UPDATE tasks'));
  }

  it('harness relay completed + finalize 拒 → UPDATE status 参数为 in_progress（非 completed）', async () => {
    // terminalCheck SELECT 返回 harness relay 任务
    mockPool.query.mockImplementation(async (sql) => {
      if (/FROM tasks WHERE id/.test(sql)) return { rows: [{ failure_class: null, task_type: 'harness_initiative', orchestrator: 'skill-relay' }] };
      return { rows: [] };
    });
    finalizeMock.mockResolvedValue({ applies: true, allow: false, reason: 'pr_not_merged' });

    const { processExecutionCallback } = await import('../callback-processor.js');
    await processExecutionCallback(
      { task_id: 't-relay-1', run_id: 'r1', status: 'AI Done', result: { verdict: 'PASS' } },
      mockPool
    );

    expect(finalizeMock).toHaveBeenCalledWith('t-relay-1', { pool: mockPool });
    const upd = findUpdateCall();
    expect(upd, 'UPDATE tasks 应执行').toBeDefined();
    // params[1] = $2 = newStatus，降级后应为 in_progress
    expect(upd[1][1]).toBe('in_progress');
  });

  it('非 harness（applies:false）completed → UPDATE status 参数照旧 completed', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (/FROM tasks WHERE id/.test(sql)) return { rows: [{ failure_class: null, task_type: 'dev', orchestrator: null }] };
      return { rows: [] };
    });
    finalizeMock.mockResolvedValue({ applies: false });

    const { processExecutionCallback } = await import('../callback-processor.js');
    await processExecutionCallback(
      { task_id: 't-dev-1', run_id: 'r2', status: 'AI Done', result: { ok: true }, pr_url: 'https://github.com/test/repo/pull/9' },
      mockPool
    );

    const upd = findUpdateCall();
    expect(upd[1][1]).toBe('completed');
  });

  it('harness relay completed + finalize 放行 → UPDATE status 参数 completed', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (/FROM tasks WHERE id/.test(sql)) return { rows: [{ failure_class: null, task_type: 'harness_initiative', orchestrator: 'skill-relay' }] };
      return { rows: [] };
    });
    finalizeMock.mockResolvedValue({ applies: true, allow: true, prUrl: 'https://x/pr/1' });

    const { processExecutionCallback } = await import('../callback-processor.js');
    await processExecutionCallback(
      { task_id: 't-relay-2', run_id: 'r3', status: 'AI Done', result: { verdict: 'PASS' }, pr_url: 'https://x/pr/1' },
      mockPool
    );

    const upd = findUpdateCall();
    expect(upd[1][1]).toBe('completed');
  });
});

// ===== PATCH /tasks/:id（supertest）=====
describe('收账权收归 — PATCH /tasks/:id', () => {
  const mockQuery = vi.fn();
  let app;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    finalizeMock.mockReset();
    vi.doMock('../db.js', () => ({ default: { query: (...a) => mockQuery(...a) } }));
    vi.doMock('../lib/harness-finalize.js', () => ({ finalizeHarnessTask: finalizeMock }));
    app = express();
    app.use(express.json());
    const { default: router } = await import('../routes/tasks.js');
    app.use('/api/brain', router);
  });

  it('harness relay completed + finalize 拒 → 200 accepted:false 且 UPDATE 无 status 子句', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't1', status: 'in_progress', task_type: 'harness_initiative', orchestrator: 'skill-relay' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ status: 'in_progress', updated_at: 'x' }] }); // UPDATE
    finalizeMock.mockResolvedValue({ applies: true, allow: false, reason: 'pr_not_merged' });

    const res = await request(app).patch('/api/brain/tasks/t1').send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(false);
    expect(res.body.reason).toBe('pr_not_merged');
    const upd = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(upd[0]).not.toMatch(/status = \$/);
    expect(upd[0]).not.toMatch(/status_history/);
  });

  it('harness relay completed + finalize 放行 → UPDATE 含 status 子句（原路径 completed）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't2', status: 'in_progress', task_type: 'harness_initiative', orchestrator: 'skill-relay' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });
    finalizeMock.mockResolvedValue({ applies: true, allow: true });

    const res = await request(app).patch('/api/brain/tasks/t2').send({ status: 'completed' });

    expect(res.status).toBe(200);
    const upd = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(upd[0]).toMatch(/status = \$/);
    expect(upd[0]).toMatch(/status_history/);
  });

  it('非 harness completed → 不调 finalize，原路径 status 子句', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't3', status: 'in_progress', task_type: 'dev', orchestrator: null }] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(app).patch('/api/brain/tasks/t3').send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(finalizeMock).not.toHaveBeenCalled();
    const upd = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(upd[0]).toMatch(/status = \$/);
  });
});

// ===== PATCH /task/:id（task-tasks.js，supertest）=====
describe('收账权收归 — PATCH /task/:id（task-tasks.js）', () => {
  const mockQuery = vi.fn();
  let app;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    finalizeMock.mockReset();
    vi.doMock('../db.js', () => ({ default: { query: (...a) => mockQuery(...a) } }));
    vi.doMock('../lib/harness-finalize.js', () => ({ finalizeHarnessTask: finalizeMock }));
    app = express();
    app.use(express.json());
    const { default: router } = await import('../routes/task-tasks.js');
    app.use('/', router);
  });

  it('harness relay completed + finalize 拒 → 200 accepted:false 且 UPDATE 无 status/completed_at（不落 400）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'in_progress', task_type: 'harness_initiative', orchestrator: 'skill-relay' }] }) // 状态机 SELECT
      .mockResolvedValueOnce({ rows: [{ id: 'tt1', status: 'in_progress' }] }); // UPDATE RETURNING *
    finalizeMock.mockResolvedValue({ applies: true, allow: false, reason: 'pr_not_merged' });

    const res = await request(app).patch('/tt1').send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(false);
    expect(res.body.reason).toBe('pr_not_merged');
    const upd = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(upd, 'UPDATE 应仍执行（updated_at 兜底），不落 400').toBeDefined();
    expect(upd[0]).not.toMatch(/status = \$/);
    expect(upd[0]).not.toMatch(/completed_at/);
    expect(upd[0]).toMatch(/updated_at = NOW\(\)/);
  });

  it('harness relay completed + finalize 放行 → 原路径写 status/completed_at', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'in_progress', task_type: 'harness_initiative', orchestrator: 'skill-relay' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tt2', status: 'completed' }] });
    finalizeMock.mockResolvedValue({ applies: true, allow: true });

    const res = await request(app).patch('/tt2').send({ status: 'completed' });

    expect(res.status).toBe(200);
    const upd = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(upd[0]).toMatch(/status = \$/);
    expect(upd[0]).toMatch(/completed_at/);
  });

  it('非 harness completed → 不调 finalize，原路径 status 子句', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'in_progress', task_type: 'dev', orchestrator: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tt3', status: 'completed' }] });

    const res = await request(app).patch('/tt3').send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(finalizeMock).not.toHaveBeenCalled();
    const upd = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(upd[0]).toMatch(/status = \$/);
  });
});

// ===== POST /harness/complete（supertest）=====
describe('收账权收归 — POST /harness/complete', () => {
  const mockQuery = vi.fn();
  let app;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] });
    finalizeMock.mockReset();
    vi.doMock('../db.js', () => ({ default: { query: (...a) => mockQuery(...a) } }));
    vi.doMock('../lib/harness-finalize.js', () => ({ finalizeHarnessTask: finalizeMock }));
    app = express();
    app.use(express.json());
    const { default: router } = await import('../routes/harness.js');
    app.use('/api/brain/harness', router);
  });

  it('finalize 拒 → 200 accepted:false 且无 status=completed 的 UPDATE', async () => {
    finalizeMock.mockResolvedValue({ applies: true, allow: false, reason: 'pr_not_found' });

    const res = await request(app).post('/api/brain/harness/complete').send({ initiative_id: 'init-1', pr_url: 'https://x/pr/1' });

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(false);
    expect(res.body.reason).toBe('pr_not_found');
    const completedUpd = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql) && /status\s*=\s*'completed'/.test(sql));
    expect(completedUpd, "被拒时不应有 status='completed' 的 UPDATE").toBeUndefined();
  });

  it('finalize 放行 → 原路径 status=completed 的 UPDATE 照跑', async () => {
    finalizeMock.mockResolvedValue({ applies: true, allow: true });

    const res = await request(app).post('/api/brain/harness/complete').send({ initiative_id: 'init-2', pr_url: 'https://x/pr/2' });

    expect(res.status).toBe(200);
    const completedUpd = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql) && /status\s*=\s*'completed'/.test(sql));
    expect(completedUpd, "放行时应有 status='completed' 的 UPDATE").toBeDefined();
  });
});
