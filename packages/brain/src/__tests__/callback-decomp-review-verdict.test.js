/** 真实 callback 和 review-gate；数据库为有状态替身，禁止其它外部副作用。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callbackPoolResponse, mockClient, mockPool, mockReqRes, callbackRouter, nativeFetch } from './helpers/callback-atomic-fixture.js';
import { recordRunFromCallback } from '../lib/task-run.js';
import { recordProgressStep } from '../progress-ledger.js';
import { publishTaskCompleted } from '../events/taskEvents.js';
import { emit as emitEvent } from '../event-bus.js';
import express from 'express';
import { createRequire } from 'node:module';
const bridge = createRequire(import.meta.url)('../../scripts/codex-bridge/codex-bridge.cjs');

const planAdjustment = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../progress-reviewer.js', () => ({ executePlanAdjustment: planAdjustment }));

describe('拆解审核回执必须有明确 verdict', () => {
  let state;
  beforeEach(() => {
    vi.clearAllMocks();
    state = { review: null, project: 'pending_review' };
    mockClient.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('decomp_reviews') || String(sql).includes('UPDATE projects')) return mockPool.query(sql, params);
      return { rows: [], rowCount: sql.includes('UPDATE tasks') || sql.includes('INSERT INTO decision_log') ? 1 : null };
    });
    mockPool.query.mockImplementation(async (sql, params) => {
      const text = String(sql);
      if (text.includes('SELECT task_id, status FROM task_runs')) return { rows: [{ task_id: 'decomp-task', status: 'success' }] };
      if (text.includes('SELECT task_type, payload FROM tasks')) {
        return { rows: [{ task_type: 'decomp_review', payload: { review_scope: 'plan_adjustment' } }] };
      }
      if (text.includes('SELECT id, entity_type, entity_id FROM decomp_reviews')) {
        return { rows: [{ id: 'review-1', entity_type: 'project', entity_id: 'project-1' }] };
      }
      if (text.includes('UPDATE decomp_reviews SET verdict')) { state.review = params[0]; return { rows: [], rowCount: 1 }; }
      if (text.includes("UPDATE projects SET status = 'active'")) { state.project = 'active'; return { rows: [], rowCount: 1 }; }
      if (text.includes("UPDATE projects SET status = 'blocked'")) { state.project = 'blocked'; return { rows: [], rowCount: 1 }; }
      return callbackPoolResponse(sql, params);
    });
  });

  it.each([null, {}, { verdict: 'garbage', findings: { plan_adjustment: { x: 1 } } }, { result: { verdict: 'REVIEWED' } }])(
    '缺失或非法结论 %j 不得批准、激活或调整计划', async result => {
      const response = await mockReqRes('POST', '/execution-callback', {
        task_id: 'decomp-task', run_id: 'owned-run', status: 'AI Done', result,
      });
      expect(response.statusCode).toBe(422);
      expect(response.body).toMatchObject({ success: false, code: 'DECOMP_REVIEW_VERDICT_INVALID' });
      expect(mockPool.connect).not.toHaveBeenCalled();
      expect(recordRunFromCallback).not.toHaveBeenCalled();
      expect(mockPool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO callback_queue'))).toBe(true);
      expect(state).toEqual({ review: null, project: 'pending_review' });
      expect(planAdjustment).not.toHaveBeenCalled();
    }, 10000,
  );

  it('队列未返回记录身份时不声称已持久入队', async () => {
    const previous = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementation(async (sql, params) => String(sql).includes('INSERT INTO callback_queue')
      ? { rows: [], rowCount: 1 } : previous(sql, params));
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'run-no-queue-id', status: 'AI Done', result: {},
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).toMatchObject({ success: false, queued: false });
  });

  it('没有 run_id 的旧审核回执必须保留待核', async () => {
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', status: 'AI Done', result: { verdict: 'approved' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.body.code).toBe('DECOMP_REVIEW_RUN_ID_MISSING');
    expect(recordRunFromCallback).not.toHaveBeenCalled();
    expect(state.project).toBe('pending_review');
  });

  it('带 postdeploy_check 的审核回执不进入另一条不处理审核的完成通道', async () => {
    const previous = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementation(async (sql, params) => String(sql).includes('SELECT task_type, payload FROM tasks')
      ? { rows: [{ task_type: 'decomp_review', payload: { postdeploy_check: { command: 'verify' } } }] }
      : previous(sql, params));
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'run-postdeploy', status: 'AI Done', result: { verdict: 'approved' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.body.code).toBe('DECOMP_REVIEW_POSTDEPLOY_UNSUPPORTED');
    expect(recordRunFromCallback).not.toHaveBeenCalled();
    expect(state.project).toBe('pending_review');
  });

  it('事务中任务 payload 并发变更为 postdeploy 时回滚而不是绕过门禁', async () => {
    const previous = mockClient.query.getMockImplementation();
    mockClient.query.mockImplementation(async (sql, params) => String(sql).includes('UPDATE tasks')
      ? { rows: [{ task_type: 'decomp_review', payload: { postdeploy_check: { command: 'verify' } } }], rowCount: 1 }
      : previous(sql, params));
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'run-race', status: 'AI Done', result: { verdict: 'approved' },
    });
    expect(response.statusCode).toBe(500);
    expect(mockClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(state.project).toBe('pending_review');
    expect(recordRunFromCallback).not.toHaveBeenCalled();
  });

  it('明确 approved 才写入审核并激活项目', async () => {
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'owned-run', status: 'AI Done', result: { verdict: 'approved' },
    });
    expect(response.statusCode).toBe(200);
    expect(state).toEqual({ review: 'approved', project: 'active' });
    expect(recordRunFromCallback).toHaveBeenCalledWith(expect.any(Object), { pool: mockPool, requireTaskOwner: true });
  }, 10000);

  it('嵌套显式大写结论按真实结论处理，不被当作默认批准', async () => {
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'owned-run', status: 'AI Done', result: { result: { verdict: 'REJECTED' } },
    });
    expect(response.statusCode).toBe(200);
    expect(state).toEqual({ review: 'rejected', project: 'blocked' });
  }, 10000);

  it('明确 rejected 时不能执行 findings 中的计划调整', async () => {
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'owned-run', status: 'AI Done',
      result: { verdict: 'rejected', findings: { plan_adjustment: { x: 1 } } },
    });
    expect(response.statusCode).toBe(200);
    expect(state).toEqual({ review: 'rejected', project: 'blocked' });
    expect(planAdjustment).not.toHaveBeenCalled();
  }, 10000);

  it('明确 needs_revision 时保留结论和待处理状态，不执行计划调整', async () => {
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'owned-run', status: 'AI Done',
      result: { verdict: 'needs_revision', findings: { plan_adjustment: { x: 1 } } },
    });
    expect(response.statusCode).toBe(200);
    expect(state).toEqual({ review: 'needs_revision', project: 'pending_review' });
    expect(planAdjustment).not.toHaveBeenCalled();
  }, 10000);

  it('明确 approved 且授权调整范围时仍执行计划调整', async () => {
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'owned-run', status: 'AI Done',
      result: { verdict: 'approved', findings: { plan_adjustment: { x: 1 } } },
    });
    expect(response.statusCode).toBe(200);
    expect(state).toEqual({ review: 'approved', project: 'active' });
    expect(planAdjustment).toHaveBeenCalledOnce();
  }, 10000);

  it('批准后计划调整失败时回滚任务与审核事务', async () => {
    planAdjustment.mockRejectedValueOnce(new Error('plan write failed'));
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'adjustment-error', status: 'AI Done',
      result: { verdict: 'approved', findings: { plan_adjustment: { x: 1 } } },
    });
    expect(response.statusCode).toBe(500);
    expect(mockClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(mockClient.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(recordRunFromCallback).not.toHaveBeenCalled();
  }, 10000);

  it('任务类型读取故障时不写回执和 completed，由上游重试', async () => {
    const previousQuery = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('SELECT task_type, payload FROM tasks')) throw new Error('task type read unavailable');
      return previousQuery(sql, params);
    });
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'read-failure', status: 'AI Done', result: {},
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).toMatchObject({ success: false, code: 'TASK_COMPLETION_GUARD_UNAVAILABLE' });
    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(recordRunFromCallback).not.toHaveBeenCalled();
    expect(mockPool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO callback_queue'))).toBe(true);
    expect(state).toEqual({ review: null, project: 'pending_review' });
  }, 10000);

  it('有效结论写审核时数据库故障，回滚任务完成并允许重试', async () => {
    const previousPoolQuery = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('FROM decomp_reviews WHERE task_id')) throw new Error('review write database unavailable');
      return previousPoolQuery(sql, params);
    });
    const previousClientQuery = mockClient.query.getMockImplementation();
    mockClient.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('FROM decomp_reviews WHERE task_id')) throw new Error('review write database unavailable');
      return previousClientQuery(sql, params);
    });
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'review-db-error', status: 'AI Done', result: { verdict: 'approved' },
    });
    expect(response.statusCode).toBe(500);
    expect(mockClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(mockClient.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(recordRunFromCallback).not.toHaveBeenCalled();
    const release = mockPool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE callback_queue') && !String(sql).includes('processed_at'));
    expect(release?.[1]).toEqual(['owned-queue']);
    expect(state).toEqual({ review: null, project: 'pending_review' });
  }, 10000);

  it('run 留痕未真实落库时回执保持待重试', async () => {
    const previous = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementation(async (sql, params) => String(sql).includes('SELECT task_id, status FROM task_runs')
      ? { rows: [] } : previous(sql, params));
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'run-ledger-failure', status: 'AI Done', result: { verdict: 'approved' },
    });
    expect(response.statusCode).toBe(500);
    expect(mockPool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE callback_queue') && String(sql).includes('processed_at = NOW()'))).toBe(false);
  });

  it('事务提交失败时进度账必须使用同一事务客户端', async () => {
    const previousClientQuery = mockClient.query.getMockImplementation();
    mockClient.query.mockImplementation(async (sql, params) => {
      if (sql === 'COMMIT') throw new Error('commit failed');
      return previousClientQuery(sql, params);
    });
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'commit-error', status: 'AI Done', result: { verdict: 'approved' },
    });
    expect(response.statusCode).toBe(500);
    expect(mockClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(recordProgressStep).toHaveBeenCalledWith('decomp-task', 'commit-error', expect.any(Object), mockClient);
    expect(recordRunFromCallback).not.toHaveBeenCalled();
  }, 10000);

  it('提交后宕机重放同任务同 run：补写 run 而不重复审核', async () => {
    const previousQuery = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementation(async (sql, params) => {
      const text = String(sql);
      if (text.includes("trigger = 'execution-callback'") && text.includes('SELECT id, llm_output_json')) return { rows: [{ id: 'committed-log', callback_task_id: 'decomp-task' }] };
      if (text.includes('SELECT status FROM tasks')) return { rows: [{ status: 'completed' }] };
      if (text.includes('SELECT task_id FROM task_runs')) return { rows: [] };
      return previousQuery(sql, params);
    });
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'replay-run', status: 'AI Done', result: { verdict: 'approved' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ success: true, duplicate: true });
    expect(recordRunFromCallback).toHaveBeenCalledOnce();
    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(state).toEqual({ review: null, project: 'pending_review' });
    const dedup = mockPool.query.mock.calls.find(([sql]) => String(sql).includes('SELECT id, llm_output_json'));
    expect(dedup?.[1]).toEqual(['replay-run', 'AI Done']);
  }, 10000);

  it('历史幂等记录没有任务归属时禁止猜测补写 run', async () => {
    const previousQuery = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('SELECT id, llm_output_json')) return { rows: [{ id: 'legacy-log', callback_task_id: null }] };
      return previousQuery(sql, params);
    });
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'legacy-run', status: 'AI Done', result: { verdict: 'approved' },
    });
    expect(response.statusCode).toBe(409);
    expect(recordRunFromCallback).not.toHaveBeenCalled();
  }, 10000);

  it('重放 run 已属于其他任务时禁止补写该 run', async () => {
    const previousQuery = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementation(async (sql, params) => {
      const text = String(sql);
      if (text.includes("trigger = 'execution-callback'") && text.includes('SELECT id, llm_output_json')) return { rows: [{ id: 'committed-log', callback_task_id: 'decomp-task' }] };
      if (text.includes('SELECT status FROM tasks')) return { rows: [{ status: 'completed' }] };
      if (text.includes('SELECT task_id FROM task_runs')) return { rows: [{ task_id: 'other-task' }] };
      return previousQuery(sql, params);
    });
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'foreign-run', status: 'AI Done', result: { verdict: 'approved' },
    });
    expect(response.statusCode).toBe(409);
    expect(recordRunFromCallback).not.toHaveBeenCalled();
  }, 10000);

  it('审核回执幂等账不可读时保留队列租约重试，不伪装已处理', async () => {
    const previousQuery = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('SELECT id, llm_output_json')) throw new Error('idempotency database unavailable');
      return previousQuery(sql, params);
    });
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'dedup-read-error', status: 'AI Done', result: { verdict: 'approved' },
    });
    expect(response.statusCode).toBe(500);
    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(recordRunFromCallback).not.toHaveBeenCalled();
    const release = mockPool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE callback_queue') && !String(sql).includes('processed_at'));
    expect(release?.[1]).toEqual(['owned-queue']);
  }, 10000);

  it('找不到关联审核时不完成任务，也不执行计划调整', async () => {
    const previousPoolQuery = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('FROM decomp_reviews WHERE task_id')) return { rows: [] };
      return previousPoolQuery(sql, params);
    });
    const previousClientQuery = mockClient.query.getMockImplementation();
    mockClient.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('FROM decomp_reviews WHERE task_id')) return { rows: [] };
      return previousClientQuery(sql, params);
    });
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'review-missing', status: 'AI Done',
      result: { verdict: 'approved', findings: { plan_adjustment: { x: 1 } } },
    });
    expect(response.statusCode).toBe(500);
    expect(mockClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(mockClient.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(planAdjustment).not.toHaveBeenCalled();
    expect(state).toEqual({ review: null, project: 'pending_review' });
  }, 10000);

  it('一个任务关联多条审核时不猜测批准对象，回滚并保留待核', async () => {
    const previousPoolQuery = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('FROM decomp_reviews WHERE task_id')) return { rows: [
        { id: 'review-1', entity_type: 'project', entity_id: 'project-1' },
        { id: 'review-2', entity_type: 'project', entity_id: 'project-2' },
      ] };
      return previousPoolQuery(sql, params);
    });
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'duplicate-review', status: 'AI Done', result: { verdict: 'approved' },
    });
    expect(response.statusCode).toBe(500);
    expect(mockClient.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(mockClient.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(state).toEqual({ review: null, project: 'pending_review' });
    expect(planAdjustment).not.toHaveBeenCalled();
  }, 10000);

  it.runIf(process.env.DECOMP_REVIEW_PG_TEST === '1')('隔离 PostgreSQL 中缺失结论保留待审，明确批准才激活', async () => {
    const { Client } = await import('pg');
    const { userInfo } = await import('node:os');
    const client = new Client({ host: '127.0.0.1', port: 5432, database: 'cecelia_scratch', user: userInfo().username });
    await client.connect();
    try {
      const identity = await client.query('SELECT current_database() AS db, inet_server_addr()::text AS host');
      expect(identity.rows[0]).toEqual({ db: 'cecelia_scratch', host: '127.0.0.1/32' });
      await client.query('CREATE TEMP TABLE projects (id text PRIMARY KEY, status text NOT NULL)');
      await client.query('CREATE TEMP TABLE decomp_reviews (id text PRIMARY KEY, task_id text, entity_type text, entity_id text, verdict text, findings jsonb, reviewed_at timestamptz)');
      await client.query('CREATE TEMP TABLE tasks (id text PRIMARY KEY, task_type text, status text, payload jsonb, result jsonb, completed_at timestamptz, quota_exhausted_at timestamptz, pr_url text, pr_status text, error_message text, blocked_detail jsonb, updated_at timestamptz, claimed_by text, claimed_at timestamptz)');
      await client.query('CREATE TEMP TABLE decision_log (trigger text, input_summary text, llm_output_json jsonb, action_result_json jsonb, status text)');
      await client.query("INSERT INTO projects VALUES ('project-1', 'pending_review')");
      await client.query("INSERT INTO decomp_reviews (id, task_id, entity_type, entity_id) VALUES ('review-1', 'decomp-task', 'project', 'project-1')");
      await client.query("INSERT INTO tasks (id, task_type, status, payload) VALUES ('decomp-task', 'decomp_review', 'in_progress', '{\"current_run_id\":\"approved-run\"}')");
      mockPool.query.mockImplementation(async (sql, params) => {
        const text = String(sql);
        if (text.includes('SELECT task_id, status FROM task_runs')) return { rows: [{ task_id: 'decomp-task', status: 'success' }] };
        if (text.includes('SELECT task_type, payload FROM tasks')) {
          return client.query(sql, params);
        }
        return callbackPoolResponse(sql, params);
      });
      mockClient.query.mockImplementation((sql, params) => client.query(sql, params));
      const invalid = await mockReqRes('POST', '/execution-callback', { task_id: 'decomp-task', run_id: 'missing-run', status: 'AI Done', result: {} });
      expect(invalid.statusCode).toBe(422);
      expect((await client.query('SELECT verdict FROM decomp_reviews')).rows[0].verdict).toBeNull();
      expect((await client.query('SELECT status FROM projects')).rows[0].status).toBe('pending_review');
      expect((await client.query('SELECT status FROM tasks')).rows[0].status).toBe('in_progress');
      await client.query("INSERT INTO decomp_reviews (id, task_id, entity_type, entity_id) VALUES ('review-2', 'decomp-task', 'project', 'project-1')");
      const ambiguous = await mockReqRes('POST', '/execution-callback', { task_id: 'decomp-task', run_id: 'approved-run', status: 'AI Done', result: { verdict: 'approved' } });
      expect(ambiguous.statusCode).toBe(500);
      expect((await client.query('SELECT count(*)::int AS n FROM decomp_reviews WHERE verdict IS NOT NULL')).rows[0].n).toBe(0);
      expect((await client.query('SELECT status FROM projects')).rows[0].status).toBe('pending_review');
      expect((await client.query('SELECT status FROM tasks')).rows[0].status).toBe('in_progress');
      expect((await client.query('SELECT count(*)::int AS n FROM decision_log')).rows[0].n).toBe(0);
      await client.query("DELETE FROM decomp_reviews WHERE id = 'review-2'");
      await client.query("ALTER TABLE projects ADD CONSTRAINT reject_activation CHECK (status <> 'active')");
      const failed = await mockReqRes('POST', '/execution-callback', { task_id: 'decomp-task', run_id: 'approved-run', status: 'AI Done', result: { verdict: 'approved' } });
      expect(failed.statusCode).toBe(500);
      expect((await client.query('SELECT verdict FROM decomp_reviews')).rows[0].verdict).toBeNull();
      expect((await client.query('SELECT status FROM projects')).rows[0].status).toBe('pending_review');
      expect((await client.query('SELECT status FROM tasks')).rows[0].status).toBe('in_progress');
      expect((await client.query('SELECT count(*)::int AS n FROM decision_log')).rows[0].n).toBe(0);
      expect(recordRunFromCallback).not.toHaveBeenCalled();
      await client.query('ALTER TABLE projects DROP CONSTRAINT reject_activation');
      const success = await mockReqRes('POST', '/execution-callback', { task_id: 'decomp-task', run_id: 'approved-run', status: 'AI Done', result: { verdict: 'approved' } });
      expect(success.statusCode).toBe(200);
      expect((await client.query('SELECT verdict FROM decomp_reviews')).rows[0].verdict).toBe('approved');
      expect((await client.query('SELECT status FROM projects')).rows[0].status).toBe('active');
      expect((await client.query('SELECT status FROM tasks')).rows[0].status).toBe('completed');
      expect((await client.query('SELECT count(*)::int AS n FROM decision_log')).rows[0].n).toBe(1);
      expect(recordRunFromCallback).toHaveBeenCalledOnce();
    } finally { await client.end(); }
  }, 15000);
});

describe('队列消费的拆解审核回执', () => {
  it('缺少审核结论时不允许将任务标记完成', async () => {
    const { processExecutionCallback } = await import('../callback-processor.js');
    vi.clearAllMocks();
    mockPool.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes("payload->>'failure_class' AS failure_class")) return { rows: [{ task_type: 'decomp_review' }] };
      return callbackPoolResponse(sql, params);
    });
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });
    await expect(processExecutionCallback({ task_id: 'decomp-task', run_id: 'run', status: 'AI Done', result: {} }, mockPool)).rejects.toThrow(/verdict/i);
    expect(mockClient.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks'))).toBe(false);
  });
});

describe('HTTP 门禁故障后的持久化恢复', () => {
  it.runIf(process.env.DECOMP_REVIEW_PG_TEST === '1')('类型读取故障返回 503 后，worker 从真实队列恢复审核', async () => {
    const { Client } = await import('pg');
    const { userInfo } = await import('node:os');
    const { pollAndProcess } = await import('../callback-worker.js');
    const pg = new Client({ host: '127.0.0.1', port: 5432, database: 'cecelia_scratch', user: userInfo().username });
    await pg.connect();
    try {
      await pg.query('CREATE TEMP TABLE projects (id text PRIMARY KEY, status text NOT NULL)');
      await pg.query('CREATE TEMP TABLE decomp_reviews (id text PRIMARY KEY, task_id uuid, entity_type text, entity_id text, verdict text, findings jsonb, reviewed_at timestamptz)');
      await pg.query('CREATE TEMP TABLE tasks (id uuid PRIMARY KEY, task_type text, status text, payload jsonb, result jsonb, completed_at timestamptz, quota_exhausted_at timestamptz, pr_url text, pr_status text, error_message text, blocked_detail jsonb, updated_at timestamptz, claimed_by text, claimed_at timestamptz)');
      await pg.query('CREATE TEMP TABLE decision_log (trigger text, input_summary text, llm_output_json jsonb, action_result_json jsonb, status text)');
      await pg.query('CREATE TEMP TABLE callback_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, run_id text, status text, result_json jsonb, checkpoint_id text, duration_ms int, attempt int, exit_code int, stderr_tail text, failure_class text, claimed_at timestamptz, claimed_by text, created_at timestamptz DEFAULT now(), retry_count int, processed_at timestamptz)');
      const taskId = '00000000-0000-4000-8000-000000000001';
      await pg.query("INSERT INTO projects VALUES ('project-1','pending_review')");
      await pg.query("INSERT INTO decomp_reviews (id,task_id,entity_type,entity_id) VALUES ('r',$1,'project','project-1')", [taskId]);
      await pg.query("INSERT INTO tasks (id,task_type,status,payload) VALUES ($1,'decomp_review','in_progress','{\"current_run_id\":\"run-1\"}')", [taskId]);
      mockClient.query.mockImplementation((sql, params) => pg.query(sql, params));
      mockPool.query.mockImplementation(async (sql, params) => {
        const text = String(sql);
        if (text.includes('SELECT task_type, payload FROM tasks')) throw new Error('injected type read outage');
        if (text.includes('SELECT task_id, status FROM task_runs')) return { rows: [{ task_id: taskId, status: 'success' }] };
        if (text.includes('INSERT INTO callback_queue') || text.includes("payload->>'failure_class' AS failure_class")) return pg.query(sql, params);
        return callbackPoolResponse(sql, params);
      });
      const response = await mockReqRes('POST', '/execution-callback', { task_id: taskId, run_id: 'run-1', status: 'AI Done', result: { verdict: 'approved' } });
      expect(response.statusCode).toBe(503);
      expect((await pg.query('SELECT count(*)::int AS n FROM callback_queue WHERE processed_at IS NULL')).rows[0].n).toBe(1);
      expect((await pg.query('SELECT status FROM tasks')).rows[0].status).toBe('in_progress');
      await pg.query("UPDATE callback_queue SET claimed_at=now()-interval '6 minutes'");
      await pollAndProcess();
      expect((await pg.query('SELECT status FROM projects')).rows[0].status).toBe('active');
      expect((await pg.query('SELECT status FROM tasks')).rows[0].status).toBe('completed');
      expect((await pg.query('SELECT processed_at IS NOT NULL AS done FROM callback_queue')).rows[0].done).toBe(true);
    } finally { await pg.end(); }
  }, 15000);
});

describe('真实队列数据库事务', () => {
  it.runIf(process.env.DECOMP_REVIEW_PG_TEST === '1')('坏回执不激活、延后重试且不饿死后续有效回执', async () => {
    const { Client } = await import('pg');
    const { userInfo } = await import('node:os');
    const { pollAndProcess } = await import('../callback-worker.js');
    const pg = new Client({ host: '127.0.0.1', port: 5432, database: 'cecelia_scratch', user: userInfo().username });
    await pg.connect();
    try {
      await pg.query('CREATE TEMP TABLE projects (id text PRIMARY KEY, status text NOT NULL)');
      await pg.query('CREATE TEMP TABLE decomp_reviews (id text PRIMARY KEY, task_id text, entity_type text, entity_id text, verdict text, findings jsonb, reviewed_at timestamptz)');
      await pg.query('CREATE TEMP TABLE tasks (id text PRIMARY KEY, task_type text, status text, payload jsonb, result jsonb, completed_at timestamptz, quota_exhausted_at timestamptz, pr_url text, pr_status text, error_message text, blocked_detail jsonb, updated_at timestamptz, claimed_by text, claimed_at timestamptz)');
      await pg.query('CREATE TEMP TABLE decision_log (trigger text, input_summary text, llm_output_json jsonb, action_result_json jsonb, status text)');
      await pg.query('CREATE TEMP TABLE task_runs (run_id text PRIMARY KEY, task_id text, status text)');
      let failRunWrite = false;
      recordRunFromCallback.mockImplementation(async ({taskId, runId}) => failRunWrite ? null : pg.query("INSERT INTO task_runs VALUES ($1,$2,'success') ON CONFLICT (run_id) DO NOTHING", [runId, taskId]));
      await pg.query('CREATE TEMP TABLE callback_queue (id text PRIMARY KEY, task_id text, run_id text, status text, result_json jsonb, checkpoint_id text, duration_ms int, attempt int, exit_code int, stderr_tail text, failure_class text, claimed_at timestamptz, claimed_by text, created_at timestamptz, retry_count int, processed_at timestamptz)');
      await pg.query("INSERT INTO projects VALUES ('project-1','pending_review')");
      await pg.query("INSERT INTO decomp_reviews (id,task_id,entity_type,entity_id) VALUES ('r','good','project','project-1')");
      await pg.query("INSERT INTO tasks (id,task_type,status,payload) SELECT 'bad-'||n,'decomp_review','in_progress','{}'::jsonb FROM generate_series(1,10) n");
      await pg.query("INSERT INTO tasks (id,task_type,status,payload) VALUES ('good','decomp_review','in_progress','{\"current_run_id\":\"good-run\"}')");
      await pg.query("INSERT INTO callback_queue (id,task_id,run_id,status,result_json,created_at) SELECT 'bad-'||n,'bad-'||n,'run-'||n,'AI Done','{}'::jsonb,now()-interval '1 minute' FROM generate_series(1,10) n");
      await pg.query("INSERT INTO callback_queue (id,task_id,run_id,status,result_json,created_at) VALUES ('good','good','good-run','AI Done','{\"verdict\":\"approved\"}',now())");
      mockClient.query.mockImplementation((sql, params) => pg.query(sql, params));
      mockPool.query.mockImplementation(async (sql, params) => {
        const text = String(sql);
        if (text.includes('SELECT task_id, status FROM task_runs')) return pg.query(sql, params);
        if (text.includes("payload->>'failure_class' AS failure_class")) return pg.query(sql, params);
        return callbackPoolResponse(sql, params);
      });
      await pollAndProcess();
      expect((await pg.query('SELECT count(*)::int AS n FROM callback_queue WHERE processed_at IS NULL AND claimed_at IS NOT NULL AND retry_count = 1')).rows[0].n).toBe(10);
      expect((await pg.query("SELECT status FROM projects WHERE id='project-1'")).rows[0].status).toBe('pending_review');
      await pg.query("ALTER TABLE projects ADD CONSTRAINT no_activation CHECK (status <> 'active')");
      await pollAndProcess();
      expect((await pg.query("SELECT processed_at IS NULL AS pending FROM callback_queue WHERE id='good'")).rows[0].pending).toBe(true);
      expect((await pg.query("SELECT status FROM tasks WHERE id='good'")).rows[0].status).toBe('in_progress');
      expect((await pg.query("SELECT verdict FROM decomp_reviews WHERE id='r'")).rows[0].verdict).toBeNull();
      expect((await pg.query('SELECT count(*)::int AS n FROM decision_log')).rows[0].n).toBe(0);
      await pg.query('ALTER TABLE projects DROP CONSTRAINT no_activation');
      await pg.query("UPDATE callback_queue SET claimed_at = now() - interval '6 minutes' WHERE id = 'good'");
      failRunWrite = true;
      publishTaskCompleted.mockClear();
      await pollAndProcess();
      expect((await pg.query("SELECT status FROM tasks WHERE id='good'")).rows[0].status).toBe('completed');
      expect((await pg.query("SELECT processed_at IS NULL AS pending FROM callback_queue WHERE id='good'")).rows[0].pending).toBe(true);
      expect(publishTaskCompleted).toHaveBeenCalledTimes(1);
      failRunWrite = false;
      await pg.query("UPDATE callback_queue SET claimed_at = now() - interval '6 minutes' WHERE id = 'good'");
      await pollAndProcess();
      expect(publishTaskCompleted).toHaveBeenCalledTimes(1);
      expect((await pg.query("SELECT processed_at IS NOT NULL AS done FROM callback_queue WHERE id='good'")).rows[0].done).toBe(true);
      expect((await pg.query("SELECT status FROM projects WHERE id='project-1'")).rows[0].status).toBe('active');
      expect((await pg.query("SELECT verdict FROM decomp_reviews WHERE id='r'")).rows[0].verdict).toBe('approved');
      expect((await pg.query("SELECT status FROM tasks WHERE id='good'")).rows[0].status).toBe('completed');
      await pg.query("INSERT INTO projects VALUES ('project-rejected','pending_review')");
      await pg.query("INSERT INTO decomp_reviews (id,task_id,entity_type,entity_id) VALUES ('rr','reject','project','project-rejected')");
      await pg.query("INSERT INTO tasks (id,task_type,status,payload) VALUES ('reject','decomp_review','in_progress','{\"current_run_id\":\"reject-run\",\"review_scope\":\"plan_adjustment\"}'), ('missing','decomp_review','in_progress','{\"current_run_id\":\"missing-run\"}')");
      await pg.query("INSERT INTO callback_queue (id,task_id,run_id,status,result_json,created_at) VALUES ('reject','reject','reject-run','AI Done','{\"verdict\":\"rejected\",\"findings\":{\"plan_adjustment\":{\"x\":1}}}',now()), ('missing','missing','missing-run','AI Done','{\"verdict\":\"approved\"}',now())");
      planAdjustment.mockClear();
      await pollAndProcess();
      expect((await pg.query("SELECT status FROM projects WHERE id='project-rejected'")).rows[0].status).toBe('blocked');
      expect(planAdjustment).not.toHaveBeenCalled();
      expect((await pg.query("SELECT status FROM tasks WHERE id='missing'")).rows[0].status).toBe('in_progress');
      expect((await pg.query("SELECT processed_at IS NULL AS pending FROM callback_queue WHERE id='missing'")).rows[0].pending).toBe(true);
      await pg.query("INSERT INTO tasks (id,task_type,status,payload) VALUES ('no-run','decomp_review','in_progress','{}'), ('postdeploy','decomp_review','in_progress','{\"current_run_id\":\"post-run\",\"postdeploy_check\":{\"command\":\"verify\"}}')");
      await pg.query("INSERT INTO callback_queue (id,task_id,run_id,status,result_json,created_at) VALUES ('no-run','no-run',NULL,'AI Done','{\"verdict\":\"approved\"}',now()), ('postdeploy','postdeploy','post-run','AI Done','{\"verdict\":\"approved\"}',now())");
      await pollAndProcess();
      expect((await pg.query("SELECT count(*)::int AS n FROM tasks WHERE id IN ('no-run','postdeploy') AND status='in_progress'")).rows[0].n).toBe(2);
      expect((await pg.query("SELECT count(*)::int AS n FROM callback_queue WHERE id IN ('no-run','postdeploy') AND processed_at IS NULL AND claimed_at IS NOT NULL")).rows[0].n).toBe(2);
      await pg.query("DELETE FROM task_runs WHERE run_id = 'good-run'");
      await pg.query("UPDATE callback_queue SET processed_at = NULL, claimed_at = NULL WHERE id = 'good'");
      await pollAndProcess();
      expect((await pg.query("SELECT count(*)::int AS n FROM decision_log WHERE llm_output_json->>'task_id'='good'")).rows[0].n).toBe(1);
      expect((await pg.query("SELECT task_id, status FROM task_runs WHERE run_id='good-run'")).rows[0]).toEqual({ task_id: 'good', status: 'success' });
      expect((await pg.query("SELECT processed_at IS NOT NULL AS done FROM callback_queue WHERE id='good'")).rows[0].done).toBe(true);
      await pg.query("INSERT INTO tasks (id,task_type,status,payload) SELECT 'stale-'||n,'decomp_review','completed','{}'::jsonb FROM generate_series(1,10) n");
      await pg.query("INSERT INTO callback_queue (id,task_id,run_id,status,result_json,created_at) SELECT 'stale-'||n,'stale-'||n,'stale-run-'||n,'AI Done','{\"verdict\":\"approved\"}'::jsonb,now()-interval '1 minute' FROM generate_series(1,10) n");
      await pg.query("INSERT INTO projects VALUES ('project-last','pending_review')");
      await pg.query("INSERT INTO tasks (id,task_type,status,payload) VALUES ('last','decomp_review','in_progress','{\"current_run_id\":\"last-run\"}')");
      await pg.query("INSERT INTO decomp_reviews (id,task_id,entity_type,entity_id) VALUES ('last-r','last','project','project-last')");
      await pg.query("INSERT INTO callback_queue (id,task_id,run_id,status,result_json,created_at) VALUES ('last','last','last-run','AI Done','{\"verdict\":\"approved\"}',now())");
      await pollAndProcess();
      expect((await pg.query("SELECT count(*)::int AS n FROM callback_queue WHERE id LIKE 'stale-%' AND processed_at IS NULL AND claimed_at IS NOT NULL")).rows[0].n).toBe(10);
      await pollAndProcess();
      expect((await pg.query("SELECT status FROM projects WHERE id='project-last'")).rows[0].status).toBe('active');
      expect((await pg.query("SELECT processed_at IS NOT NULL AS done FROM callback_queue WHERE id='last'")).rows[0].done).toBe(true);
    } finally { await pg.end(); }
  }, 15000);
});

describe('受限数据库连接池', () => {
  it.runIf(process.env.DECOMP_REVIEW_PG_TEST === '1')('两个真实连接下 worker 重放先释放事务连接再恢复 run', async () => {
    const { Pool } = await import('pg');
    const { userInfo } = await import('node:os');
    const { pollAndProcess } = await import('../callback-worker.js');
    const pgPool = new Pool({ host: '127.0.0.1', port: 5432, database: 'cecelia_scratch', user: userInfo().username, max: 2, connectionTimeoutMillis: 1000 });
    let processed = false;
    try {
      recordRunFromCallback.mockResolvedValue({});
      mockPool.connect.mockImplementation(async () => {
        const real = await pgPool.connect();
        return {
          async query(sql) {
            const text = String(sql);
            await real.query('SELECT 1');
            if (text.includes('WITH candidates')) return { rows: [{ id: 'q', task_id: 'decomp-task', run_id: 'run-1', status: 'AI Done', result_json: { verdict: 'approved' } }] };
            if (text.includes('UPDATE callback_queue') && text.includes('processed_at = NOW()')) { processed = true; return { rows: [], rowCount: 1 }; }
            if (text.includes('UPDATE tasks')) return { rows: [], rowCount: 0 };
            if (text.includes('FROM decision_log')) return { rows: [{ '?column?': 1 }] };
            if (text.includes('SELECT status FROM tasks')) return { rows: [{ status: 'completed' }] };
            return { rows: [], rowCount: 1 };
          },
          release() { real.release(); },
        };
      });
      mockPool.query.mockImplementation(async (sql, params) => {
        const text = String(sql);
        if (text.includes("payload->>'failure_class' AS failure_class")) {
          await pgPool.query('SELECT 1');
          return { rows: [{ task_type: 'decomp_review', payload: {} }] };
        }
        if (text.includes('SELECT task_id, status FROM task_runs')) {
          await pgPool.query('SELECT 1');
          return { rows: [{ task_id: 'decomp-task', status: 'success' }] };
        }
        return callbackPoolResponse(sql, params);
      });
      await pollAndProcess();
      expect(processed).toBe(true);
      expect(recordRunFromCallback).toHaveBeenCalled();
    } finally { await pgPool.end(); }
  }, 5000);
});

describe('run 留痕隔离池', () => {
  it.runIf(process.env.DECOMP_REVIEW_PG_TEST === '1')('真实 startRun 和 finishRun 只写调用者提供的 PostgreSQL 池', async () => {
    const { Client } = await import('pg');
    const { userInfo } = await import('node:os');
    const { recordVerifiedDecompRun } = await import('../lib/decomp-review-callback.js');
    const realRun = await vi.importActual('../lib/task-run.js');
    const pg = new Client({ host: '127.0.0.1', port: 5432, database: 'cecelia_scratch', user: userInfo().username });
    await pg.connect();
    try {
      await pg.query('CREATE TEMP TABLE tasks (id text PRIMARY KEY, task_type text, payload jsonb)');
      await pg.query('CREATE TEMP TABLE workflows (id uuid PRIMARY KEY)');
      await pg.query("CREATE TEMP TABLE task_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id text, run_id text UNIQUE, status text, context jsonb, workflow_id uuid, ended_at timestamptz, result jsonb, error_message text, updated_at timestamptz)");
      await pg.query("INSERT INTO tasks VALUES ('isolated-task','decomp_review','{}')");
      const isolatedPool = { query: (sql, params) => pg.query(sql, params) };
      emitEvent.mockClear();
      mockPool.query.mockImplementation(() => { throw new Error('global database must not be used'); });
      recordRunFromCallback.mockImplementation(realRun.recordRunFromCallback);
      await recordVerifiedDecompRun(isolatedPool, { taskId: 'isolated-task', runId: 'isolated-run', status: 'AI Done', result: { verdict: 'approved' } });
      expect((await pg.query('SELECT task_id, status FROM task_runs')).rows).toEqual([{ task_id: 'isolated-task', status: 'success' }]);
      expect(mockPool.query).not.toHaveBeenCalled();
      expect(emitEvent).not.toHaveBeenCalled();
    } finally {
      recordRunFromCallback.mockResolvedValue(undefined);
      await pg.end();
    }
  }, 10000);
});


describe('Bridge 到 HTTP 到真实队列的待核回执', () => {
  it.runIf(process.env.DECOMP_REVIEW_PG_TEST === '1').each([false, true])('无效审核或门禁故障只入队一次（读取故障=%s）', async readFault => {
    const { Client } = await import('pg');
    const { userInfo } = await import('node:os');
    const pg = new Client({ host: '127.0.0.1', port: 5432, database: 'cecelia_scratch', user: userInfo().username });
    await pg.connect();
    let server;
    try {
      await pg.query('CREATE TEMP TABLE tasks (id uuid PRIMARY KEY, task_type text, status text, payload jsonb)');
      await pg.query('CREATE TEMP TABLE callback_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, checkpoint_id text, run_id text, status text, result_json jsonb, stderr_tail text, duration_ms int, attempt int, exit_code int, failure_class text, claimed_at timestamptz, claimed_by text, processed_at timestamptz)');
      const taskId = '00000000-0000-4000-8000-000000000001';
      const runId = '00000000-0000-4000-8000-000000000002';
      await pg.query("INSERT INTO tasks VALUES ($1,'decomp_review','in_progress','{}')", [taskId]);
      mockPool.query.mockImplementation(async (sql, params) => {
        if (String(sql).includes('SELECT task_type, payload FROM tasks') && readFault) throw new Error('injected type read outage');
        if (String(sql).includes('INSERT INTO callback_queue') || String(sql).includes('SELECT task_type, payload FROM tasks')) return pg.query(sql, params);
        return callbackPoolResponse(sql, params);
      });
      const app = express(); app.use(express.json()); app.use('/api/brain', callbackRouter);
      server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      let requests = 0;
      vi.stubGlobal('fetch', (url, options) => {
        requests++;
        return nativeFetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, options);
      });
      const result = await bridge.callbackBrain(taskId, null, 'completed', 'no-verdict', 10, runId);
      expect(result).toMatchObject({ outcome: 'unconfirmed', reason: 'queued_pending', pending: true });
      expect(requests).toBe(1);
      expect((await pg.query('SELECT count(*)::int AS n FROM callback_queue WHERE processed_at IS NULL')).rows[0].n).toBe(1);
      expect((await pg.query('SELECT status FROM tasks')).rows[0].status).toBe('in_progress');
      expect(recordRunFromCallback).not.toHaveBeenCalled();
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      await pg.end();
    }
  }, 30000);
});

describe('shared invocation 已入队回执恢复', () => {
  it.runIf(process.env.DECOMP_REVIEW_PG_TEST === '1')('真实 sender 遇已入队 503 不阻断任务，worker 最终完成', async () => {
    const vm = await import('node:vm');
    const crypto = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const { Client } = await import('pg');
    const { userInfo } = await import('node:os');
    const { pollAndProcess } = await import('../callback-worker.js');
    const pg = new Client({ host: '127.0.0.1', port: 5432, database: 'cecelia_scratch', user: userInfo().username });
    await pg.connect();
    let server;
    try {
      await pg.query('CREATE TEMP TABLE tasks (id uuid PRIMARY KEY, task_type text, status text, payload jsonb, result jsonb, completed_at timestamptz, quota_exhausted_at timestamptz, pr_url text, pr_status text, error_message text, blocked_detail jsonb, blocked_at timestamptz, blocked_reason text, updated_at timestamptz, claimed_by text, claimed_at timestamptz)');
      await pg.query('CREATE TEMP TABLE decision_log (trigger text, input_summary text, llm_output_json jsonb, action_result_json jsonb, status text)');
      await pg.query('CREATE TEMP TABLE callback_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, run_id text, status text, result_json jsonb, checkpoint_id text, duration_ms int, attempt int, exit_code int, stderr_tail text, failure_class text, claimed_at timestamptz, claimed_by text, created_at timestamptz DEFAULT now(), retry_count int, processed_at timestamptz)');
      const taskId = '00000000-0000-4000-8000-000000000011';
      const runId = '00000000-0000-4000-8000-000000000012';
      await pg.query("INSERT INTO tasks (id,task_type,status,payload) VALUES ($1,'research','in_progress',jsonb_build_object('current_run_id',$2::text))", [taskId, runId]);
      let failTypeRead = true;
      mockClient.query.mockImplementation((sql, params) => pg.query(sql, params));
      mockPool.query.mockImplementation(async (sql, params) => {
        const text = String(sql);
        if (text.includes('SELECT task_type, payload FROM tasks') && failTypeRead) { failTypeRead = false; throw new Error('type read outage'); }
        if (text.includes('INSERT INTO callback_queue') || text.includes("payload->>'failure_class' AS failure_class") || text.includes("UPDATE tasks SET status='blocked'")) return pg.query(sql, params);
        return callbackPoolResponse(sql, params);
      });
      const app = express(); app.use(express.json()); app.use('/api/brain', callbackRouter);
      server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
      const expression = readFileSync(new URL('../executor.js', import.meta.url), 'utf8').match(/async function triggerCodexBridge\([^]*?^\}/m)[0];
      const activeProcesses = new Map(); const finish = vi.fn(async () => {});
      const fn = vm.runInNewContext(`(${expression})`, {
        assertExternalExecutionAllowed(){}, generateRunId:()=>runId, console, process:{env:{}}, AbortSignal, JSON, activeProcesses, crypto,
        internalServiceHeaders:headers=>({...headers,'X-Internal-Token':'owned-callback-token'}),
        prepareInvocationDispatch:async()=>({already:false,envelope:{}}), updateTaskRunInfo:async()=>({success:true}), selectBestBridge:async()=> 'http://fixed-bridge', selectCodexAccounts:async()=>[],
        createInvocationActivityExecutor:()=> 'worker', runInvocationActivities:async()=>({receipt:{ok:true}}),
        withLegacyExecution:async(_identity,operation)=>operation(), pool:mockPool, finishInvocationRun:finish,
        fetch:(url,options)=>nativeFetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`,options),
      });
      await fn({id:taskId,task_type:'research',payload:{invocation:{}}});
      await activeProcesses.get(taskId).invocationController;
      expect((await pg.query('SELECT status, blocked_detail FROM tasks WHERE id=$1',[taskId])).rows[0]).toEqual({status:'in_progress',blocked_detail:null});
      expect(finish).not.toHaveBeenCalled();
      expect((await pg.query('SELECT count(*)::int n FROM callback_queue WHERE processed_at IS NULL')).rows[0].n).toBe(1);
      await pg.query("UPDATE callback_queue SET claimed_at=now()-interval '6 minutes'");
      await pollAndProcess();
      expect((await pg.query('SELECT status FROM tasks WHERE id=$1',[taskId])).rows[0].status).toBe('completed');
      expect((await pg.query('SELECT processed_at IS NOT NULL done FROM callback_queue')).rows[0].done).toBe(true);
    } finally { if (server) await new Promise(resolve=>server.close(resolve)); await pg.end(); }
  }, 15000);
});
