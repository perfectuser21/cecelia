import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAcceptancePublicRouter, submitAcceptanceResults } from '../acceptance.js';

function makeApp(pool) {
  const app = express();
  app.use(express.json());
  app.use(createAcceptancePublicRouter({ pool }));
  return app;
}

function makeClient(scripts) {
  const query = vi.fn(async (sql, params) => scripts(sql, params) ?? { rows: [] });
  return { query, release: vi.fn() };
}

describe('GET /acceptance/pending', () => {
  it('返回 pending/in_review 的 runs 各带 checks', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (sql.includes('FROM acceptance_runs')) {
          return { rows: [{ id: 'A', run_key: 'r1', status: 'pending' }] };
        }
        if (sql.includes('FROM acceptance_checks')) {
          return { rows: [{ run_id: 'A', check_key: 'r1:001', result: null }] };
        }
        return { rows: [] };
      }),
      connect: vi.fn(),
    };
    const res = await request(makeApp(pool)).get('/acceptance/pending');
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].checks).toHaveLength(1);
  });

  it('查询抛错 → 500 且不泄漏内部信息', async () => {
    const pool = {
      query: vi.fn(async () => { throw new Error('relation "acceptance_runs" does not exist'); }),
      connect: vi.fn(),
    };
    const res = await request(makeApp(pool)).get('/acceptance/pending');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error' });
  });
});

describe('POST /acceptance/results', () => {
  it('result 枚举非法 → 400 整批拒绝', async () => {
    const pool = { query: vi.fn(), connect: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ results: [{ check_key: 'r1:001', result: 'yes' }] });
    expect(res.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('未知 check_key → 400 列出 missing，事务回滚', async () => {
    const client = makeClient((sql) => {
      if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:001', run_id: 'A' }] };
      }
    });
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ results: [
        { check_key: 'r1:001', result: '通过' },
        { check_key: 'r1:999', result: '通过' },
      ] });
    expect(res.status).toBe(400);
    expect(res.body.missing).toEqual(['r1:999']);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('合法批次：落库 + 重算 pass_rate/status（全判有挂 → failed）', async () => {
    const updates = [];
    const client = makeClient((sql, params) => {
      if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:001', run_id: 'A' }, { check_key: 'r1:002', run_id: 'A' }] };
      }
      if (sql.includes('UPDATE acceptance_checks')) { updates.push(params); return { rows: [] }; }
      if (sql.includes('FILTER')) {
        return { rows: [{ total: 2, pass: 1, fail: 1, pending: 0 }] };
      }
      if (sql.includes('UPDATE acceptance_runs')) {
        return { rows: [{ run_key: 'r1', pass_rate: params[0], status: params[1] }] };
      }
    });
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ results: [
        { check_key: 'r1:001', result: '通过' },
        { check_key: 'r1:002', result: '不通过', note: 'step8 挂了' },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.runs[0].status).toBe('failed');
    expect(res.body.runs[0].pass_rate).toBe(0.5);
    expect(updates).toHaveLength(2);
  });

  it('还有未判项 → status=in_review', async () => {
    const client = makeClient((sql, params) => {
      if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:001', run_id: 'A' }] };
      }
      if (sql.includes('UPDATE acceptance_checks')) return { rows: [] };
      if (sql.includes('FILTER')) return { rows: [{ total: 3, pass: 1, fail: 0, pending: 2 }] };
      if (sql.includes('UPDATE acceptance_runs')) {
        return { rows: [{ run_key: 'r1', pass_rate: params[0], status: params[1] }] };
      }
    });
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ results: [{ check_key: 'r1:001', result: '通过' }] });
    expect(res.status).toBe(200);
    expect(res.body.runs[0].status).toBe('in_review');
  });

  it('全部已判但含"无法验证" → status 停在 in_review', async () => {
    const client = makeClient((sql, params) => {
      if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:003', run_id: 'A' }] };
      }
      if (sql.includes('UPDATE acceptance_checks')) return { rows: [] };
      if (sql.includes('FILTER')) return { rows: [{ total: 3, pass: 2, fail: 0, pending: 0 }] };
      if (sql.includes('UPDATE acceptance_runs')) {
        return { rows: [{ run_key: 'r1', pass_rate: params[0], status: params[1] }] };
      }
    });
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ results: [{ check_key: 'r1:003', result: '无法验证' }] });
    expect(res.status).toBe(200);
    expect(res.body.runs[0].status).toBe('in_review');
  });

  it('同批出现重复 check_key → 400，且不占用连接', async () => {
    const pool = { query: vi.fn(), connect: vi.fn() };
    const res = await request(makeApp(pool))
      .post('/acceptance/results')
      .send({ results: [
        { check_key: 'r1:001', result: '通过' },
        { check_key: 'r1:001', result: '不通过' },
      ] });
    expect(res.status).toBe(400);
    expect(res.body.check_key).toBe('r1:001');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('results 空/非数组 → 400', async () => {
    const pool = { query: vi.fn(), connect: vi.fn() };
    const res = await request(makeApp(pool)).post('/acceptance/results').send({ results: [] });
    expect(res.status).toBe(400);
  });
});

describe('验收驳回自动开任务（主理人条件二：转变沿）', () => {
  function rejectionClient({ oldStatus, existingTask = false }) {
    const taskInserts = [];
    const client = makeClient((sql, params) => {
      if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:001', run_id: 'A' }] };
      }
      if (sql.includes('UPDATE acceptance_checks')) return { rows: [] };
      if (sql.includes('SELECT status, title, gp_id, run_key FROM acceptance_runs')) {
        return { rows: [{ status: oldStatus, title: 'T', gp_id: 'gp1', run_key: 'r1' }] };
      }
      if (sql.includes('FILTER')) return { rows: [{ total: 1, pass: 0, fail: 1, pending: 0 }] };
      if (sql.includes('UPDATE acceptance_runs')) {
        return { rows: [{ run_key: 'r1', pass_rate: params[0], status: params[1] }] };
      }
      if (sql.includes("FROM tasks")) return { rows: existingTask ? [{ ok: 1 }] : [] };
      if (sql.includes("result = '不通过'") && sql.includes('SELECT check_key, name')) {
        return { rows: [{ check_key: 'r1:001', name: 'step8', note: '挂了' }] };
      }
      if (sql.includes('INSERT INTO tasks')) { taskInserts.push(params); return { rows: [] }; }
    });
    return { client, taskInserts };
  }

  async function postFail(client) {
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    return request(makeApp(pool)).post('/acceptance/results')
      .send({ results: [{ check_key: 'r1:001', result: '不通过' }] });
  }

  it('in_review → failed 转变沿：自动 INSERT 驳回任务', async () => {
    const { client, taskInserts } = rejectionClient({ oldStatus: 'in_review' });
    const res = await postFail(client);
    expect(res.status).toBe(200);
    expect(taskInserts).toHaveLength(1);
    expect(taskInserts[0][0]).toContain('[验收驳回]');
  });

  it('已是 failed（重复提交）→ 不重复开任务', async () => {
    const { client, taskInserts } = rejectionClient({ oldStatus: 'failed' });
    const res = await postFail(client);
    expect(res.status).toBe(200);
    expect(taskInserts).toHaveLength(0);
  });

  it('转变沿但已有未终态驳回任务 → 查重跳过', async () => {
    const { client, taskInserts } = rejectionClient({ oldStatus: 'in_review', existingTask: true });
    const res = await postFail(client);
    expect(res.status).toBe(200);
    expect(taskInserts).toHaveLength(0);
  });
});

describe('GET /acceptance/catalog（Worker 拉目录）', () => {
  it('已种 → 200 带 catalog+updated_at', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (sql.includes('FROM acceptance_catalog')) {
          return { rows: [{ payload: { golden_paths: [{ id: 'g1' }] }, updated_at: '2026-07-30T00:00:00Z' }] };
        }
        return { rows: [] };
      }),
      connect: vi.fn(),
    };
    const res = await request(makeApp(pool)).get('/acceptance/catalog');
    expect(res.status).toBe(200);
    expect(res.body.catalog.golden_paths).toHaveLength(1);
    expect(res.body.updated_at).toBeTruthy();
  });

  it('未种 → 404', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() };
    const res = await request(makeApp(pool)).get('/acceptance/catalog');
    expect(res.status).toBe(404);
  });
});

describe('submitAcceptanceResults 驳回任务并发去重', () => {
  it('INSERT tasks 撞 23505 时静默忽略，整体仍返回成功', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) {
          return { rows: [{ check_key: 'r1:001', run_id: 'run-1' }] };
        }
        if (sql.includes('UPDATE acceptance_checks SET result')) return { rows: [] };
        if (sql.includes('SELECT COUNT(*)::int AS total')) {
          return { rows: [{ total: 1, pass: 0, fail: 1, pending: 0 }] };
        }
        if (sql.includes('SELECT status, title, gp_id, run_key FROM acceptance_runs')) {
          return { rows: [{ status: 'pending', title: 'T', gp_id: 'gp1', run_key: 'r1' }] };
        }
        if (sql.includes('UPDATE acceptance_runs SET pass_rate')) {
          return { rows: [{ run_key: 'r1', pass_rate: 0, status: 'failed' }] };
        }
        if (sql.includes("SELECT 1 FROM tasks")) return { rows: [] };
        if (sql.includes('SELECT check_key, name, note FROM acceptance_checks')) return { rows: [] };
        if (sql.includes('INSERT INTO tasks')) {
          const err = new Error('duplicate key');
          err.code = '23505';
          throw err;
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const result = await submitAcceptanceResults(pool, [{ check_key: 'r1:001', result: '不通过' }]);
    expect(result.updated).toBe(1);
    expect(result.runs[0].status).toBe('failed');
  });

  it('submitted_by 会被透传进 UPDATE acceptance_checks 参数', async () => {
    const updateCalls = [];
    const client = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) {
          return { rows: [{ check_key: 'r1:001', run_id: 'run-1' }] };
        }
        if (sql.includes('UPDATE acceptance_checks SET result')) {
          updateCalls.push(params);
          return { rows: [] };
        }
        if (sql.includes('SELECT COUNT(*)::int AS total')) {
          return { rows: [{ total: 1, pass: 1, fail: 0, pending: 0 }] };
        }
        if (sql.includes('SELECT status, title, gp_id, run_key FROM acceptance_runs')) {
          return { rows: [{ status: 'pending', title: 'T', gp_id: 'gp1', run_key: 'r1' }] };
        }
        if (sql.includes('UPDATE acceptance_runs SET pass_rate')) {
          return { rows: [{ run_key: 'r1', pass_rate: 1, status: 'passed' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    await submitAcceptanceResults(pool, [
      { check_key: 'r1:001', result: '通过', note: 'ok', submitted_by: 'alice@zenjoymedia.media' },
    ]);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual(['通过', 'ok', 'alice@zenjoymedia.media', 'r1:001']);
  });
});
