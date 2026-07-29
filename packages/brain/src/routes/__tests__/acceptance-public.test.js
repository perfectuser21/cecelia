import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAcceptancePublicRouter } from '../acceptance.js';

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
