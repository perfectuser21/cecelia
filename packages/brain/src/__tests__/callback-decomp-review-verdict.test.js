/** 真实 callback 和 review-gate；数据库为有状态替身，禁止其它外部副作用。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callbackPoolResponse, mockClient, mockPool, mockReqRes } from './helpers/callback-atomic-fixture.js';

const planAdjustment = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../progress-reviewer.js', () => ({ executePlanAdjustment: planAdjustment }));

describe('拆解审核回执必须有明确 verdict', () => {
  let state;
  beforeEach(() => {
    vi.clearAllMocks();
    state = { review: null, project: 'pending_review' };
    mockClient.query.mockImplementation(async sql => ({ rows: [],
      rowCount: sql.includes('UPDATE tasks') || sql.includes('INSERT INTO decision_log') ? 1 : null }));
    mockPool.query.mockImplementation(async (sql, params) => {
      const text = String(sql);
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
      expect(response.statusCode).toBe(200);
      expect(state).toEqual({ review: null, project: 'pending_review' });
      expect(planAdjustment).not.toHaveBeenCalled();
    }, 10000,
  );

  it('明确 approved 才写入审核并激活项目', async () => {
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'owned-run', status: 'AI Done', result: { verdict: 'approved' },
    });
    expect(response.statusCode).toBe(200);
    expect(state).toEqual({ review: 'approved', project: 'active' });
  }, 10000);

  it('嵌套显式大写结论按真实结论处理，不被当作默认批准', async () => {
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'decomp-task', run_id: 'owned-run', status: 'AI Done', result: { result: { verdict: 'REJECTED' } },
    });
    expect(response.statusCode).toBe(200);
    expect(state).toEqual({ review: 'rejected', project: 'blocked' });
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
      await client.query("INSERT INTO projects VALUES ('project-1', 'pending_review')");
      await client.query("INSERT INTO decomp_reviews (id, task_id, entity_type, entity_id) VALUES ('review-1', 'decomp-task', 'project', 'project-1')");
      mockPool.query.mockImplementation(async (sql, params) => {
        const text = String(sql);
        if (text.includes('SELECT task_type, payload FROM tasks')) {
          return { rows: [{ task_type: 'decomp_review', payload: {} }] };
        }
        if (text.includes('decomp_reviews') || text.includes("UPDATE projects SET status = 'active'")) {
          return client.query(sql, params);
        }
        return callbackPoolResponse(sql, params);
      });
      await mockReqRes('POST', '/execution-callback', { task_id: 'decomp-task', run_id: 'missing-run', status: 'AI Done', result: {} });
      expect((await client.query('SELECT verdict FROM decomp_reviews')).rows[0].verdict).toBeNull();
      expect((await client.query('SELECT status FROM projects')).rows[0].status).toBe('pending_review');
      await mockReqRes('POST', '/execution-callback', { task_id: 'decomp-task', run_id: 'approved-run', status: 'AI Done', result: { verdict: 'approved' } });
      expect((await client.query('SELECT verdict FROM decomp_reviews')).rows[0].verdict).toBe('approved');
      expect((await client.query('SELECT status FROM projects')).rows[0].status).toBe('active');
    } finally { await client.end(); }
  }, 15000);
});
