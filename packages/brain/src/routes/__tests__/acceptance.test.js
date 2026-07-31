import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAcceptanceInternalRouter } from '../acceptance.js';

function makeApp(pool) {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

function makeClient(scripts) {
  const query = vi.fn(async (sql, params) => scripts(sql, params) ?? { rows: [] });
  return { query, release: vi.fn() };
}

function makePool(client) {
  return { connect: vi.fn(async () => client), query: vi.fn() };
}

const RUN_ROW = { id: 'run-uuid-1', run_key: 'r1', title: 'T', status: 'pending' };

describe('POST /api/brain/acceptance/runs', () => {
  it('建新单：201，checks 生成 check_key 序号', async () => {
    const inserted = [];
    const client = makeClient((sql, params) => {
      if (sql.includes('SELECT * FROM acceptance_runs WHERE run_key')) return { rows: [] };
      if (sql.includes('INSERT INTO acceptance_runs')) return { rows: [RUN_ROW] };
      if (sql.includes('INSERT INTO acceptance_checks')) {
        inserted.push(params[1]);
        return { rows: [{ id: `c-${inserted.length}`, check_key: params[1], kind: params[2], name: params[3] }] };
      }
    });
    const res = await request(makeApp(makePool(client)))
      .post('/api/brain/acceptance/runs')
      .send({ run_key: 'r1', title: 'T', checks: [
        { kind: 'FR', name: 'step1' },
        { kind: 'NFR', name: 'latency' },
      ] });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(inserted).toEqual(['r1:001', 'r1:002']);
  });

  it('重复 run_key：200 返回现有单，不覆盖', async () => {
    const client = makeClient((sql) => {
      if (sql.includes('SELECT * FROM acceptance_runs WHERE run_key')) return { rows: [RUN_ROW] };
      if (sql.includes('SELECT * FROM acceptance_checks WHERE run_id')) return { rows: [{ check_key: 'r1:001' }] };
    });
    const res = await request(makeApp(makePool(client)))
      .post('/api/brain/acceptance/runs')
      .send({ run_key: 'r1', title: 'T', checks: [{ kind: 'FR', name: 'x' }] });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
  });

  it('并发撞车：INSERT 抛 23505 → 200 返回已存在的单', async () => {
    let runSelects = 0;
    const client = makeClient((sql) => {
      if (sql.includes('SELECT * FROM acceptance_runs WHERE run_key')) {
        runSelects += 1;
        return runSelects === 1 ? { rows: [] } : { rows: [RUN_ROW] };
      }
      if (sql.includes('INSERT INTO acceptance_runs')) {
        throw Object.assign(new Error('dup'), { code: '23505' });
      }
      if (sql.includes('SELECT * FROM acceptance_checks WHERE run_id')) {
        return { rows: [{ check_key: 'r1:001' }] };
      }
    });
    const res = await request(makeApp(makePool(client)))
      .post('/api/brain/acceptance/runs')
      .send({ run_key: 'r1', title: 'T', checks: [{ kind: 'FR', name: 'x' }] });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.checks).toHaveLength(1);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('缺 run_key/title → 400', async () => {
    const res = await request(makeApp(makePool(makeClient(() => undefined))))
      .post('/api/brain/acceptance/runs').send({ title: 'T', checks: [{ kind: 'FR', name: 'x' }] });
    expect(res.status).toBe(400);
  });

  it('checks 空数组 → 400', async () => {
    const res = await request(makeApp(makePool(makeClient(() => undefined))))
      .post('/api/brain/acceptance/runs').send({ run_key: 'r1', title: 'T', checks: [] });
    expect(res.status).toBe(400);
  });

  it('kind 非法 → 400', async () => {
    const res = await request(makeApp(makePool(makeClient(() => undefined))))
      .post('/api/brain/acceptance/runs').send({ run_key: 'r1', title: 'T', checks: [{ kind: 'XX', name: 'x' }] });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/brain/acceptance/runs/:run_key', () => {
  it('存在 → 200 带 checks；不存在 → 404', async () => {
    const client = makeClient((sql) => {
      if (sql.includes('SELECT * FROM acceptance_runs WHERE run_key')) return { rows: [RUN_ROW] };
      if (sql.includes('SELECT * FROM acceptance_checks WHERE run_id')) return { rows: [{ check_key: 'r1:001' }] };
    });
    const ok = await request(makeApp(makePool(client))).get('/api/brain/acceptance/runs/r1');
    expect(ok.status).toBe(200);
    expect(ok.body.checks).toHaveLength(1);

    const miss = makeClient(() => ({ rows: [] }));
    const nf = await request(makeApp(makePool(miss))).get('/api/brain/acceptance/runs/none');
    expect(nf.status).toBe(404);
  });
});

describe('POST /api/brain/acceptance/catalog（目录快照上载）', () => {
  it('合法 catalog → 200 upsert 单行', async () => {
    const upserts = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes('INSERT INTO acceptance_catalog')) { upserts.push(params); return { rows: [{ updated_at: 'now' }] }; }
        return { rows: [] };
      }),
      connect: vi.fn(),
    };
    const res = await request(makeApp(pool))
      .post('/api/brain/acceptance/catalog')
      .send({ catalog: { golden_paths: [{ id: 'g1' }], apps: [] } });
    expect(res.status).toBe(200);
    expect(res.body.golden_paths).toBe(1);
    expect(upserts).toHaveLength(1);
  });

  it('缺 catalog / golden_paths 非数组 → 400', async () => {
    const pool = { query: vi.fn(), connect: vi.fn() };
    const r1 = await request(makeApp(pool)).post('/api/brain/acceptance/catalog').send({});
    expect(r1.status).toBe(400);
    const r2 = await request(makeApp(pool)).post('/api/brain/acceptance/catalog').send({ catalog: { golden_paths: 'x' } });
    expect(r2.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('POST /api/brain/acceptance/results（内网版）', () => {
  it('提交子集判定项：200，返回更新后的 run', async () => {
    const client = makeClient((sql) => {
      if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:001', run_id: 'run-uuid-1' }] };
      }
      if (sql.includes('UPDATE acceptance_checks SET result')) return { rows: [] };
      if (sql.includes('SELECT COUNT(*)::int AS total')) {
        return { rows: [{ total: 2, pass: 1, fail: 0, pending: 1 }] };
      }
      if (sql.includes('SELECT status, title, gp_id, run_key FROM acceptance_runs')) {
        return { rows: [{ status: 'pending', title: 'T', gp_id: 'gp1', run_key: 'r1' }] };
      }
      if (sql.includes('UPDATE acceptance_runs SET pass_rate')) {
        return { rows: [{ run_key: 'r1', pass_rate: 0.5, status: 'in_review' }] };
      }
      return { rows: [] };
    });
    const res = await request(makeApp(makePool(client)))
      .post('/api/brain/acceptance/results')
      .send({ results: [{ check_key: 'r1:001', result: '通过', submitted_by: 'alice@zenjoymedia.media' }] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.runs[0].status).toBe('in_review');
  });

  it('未知 check_key：400', async () => {
    const client = makeClient((sql) => {
      if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) return { rows: [] };
      return { rows: [] };
    });
    const res = await request(makeApp(makePool(client)))
      .post('/api/brain/acceptance/results')
      .send({ results: [{ check_key: 'ghost:001', result: '通过' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown check_key');
  });
});

describe('GET /api/brain/acceptance/pending（内网版）', () => {
  it('返回团队共享的待验收清单（pending/in_review），附判定项', async () => {
    const pool = {
      connect: vi.fn(),
      query: vi.fn(async (sql) => {
        if (sql.includes("status IN ('pending','in_review')")) {
          return { rows: [{ id: 'run-1', run_key: 'r1', status: 'in_review' }] };
        }
        if (sql.includes('WHERE run_id = ANY')) {
          return { rows: [{ run_id: 'run-1', check_key: 'r1:001' }] };
        }
        return { rows: [] };
      }),
    };
    const res = await request(makeApp(pool)).get('/api/brain/acceptance/pending');
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].checks).toHaveLength(1);
  });
});
