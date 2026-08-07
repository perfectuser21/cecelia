import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';

const RUN_KEY = `t13-freeze-itest-${process.pid}`;
const BE = 'a'.repeat(40);
const FE = 'b'.repeat(40);
const SPEC = 'c'.repeat(64);
const HEAD = {
  tenant_account: 'acc-verify-01',
  backend_sha: BE, backend_sha_src2: BE,
  frontend_sha: FE, frontend_sha_src2: FE,
  spec_sha: SPEC,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

const create = (detail) => request(makeApp()).post('/api/brain/acceptance/runs').send({
  run_key: RUN_KEY, title: '版本戳', version: '2.1.19',
  checks: [{ check_key: 'S3-c1', kind: 'FR', name: 'x' }],
  detail: { ...HEAD, ...detail },
});

const submit = (shas) => request(makeApp()).post('/api/brain/acceptance/results').send({
  run_key: RUN_KEY, results: [{ check_key: 'S3-c1', result: '通过', submitted_by: 'staff-a' }], ...shas,
});

afterAll(async () => {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  await pool.end();
});

describe('A9 版本戳落库与冻结锁', () => {
  beforeEach(async () => { await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]); });

  it('A9 六项版本标识落库且非空，两组 sha 各自组内相等且为 40 位', async () => {
    expect((await create({})).status).toBe(201);
    const { rows } = await pool.query(
      'SELECT version, detail FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]
    );
    const d = rows[0].detail;
    expect(rows[0].version).toBe('2.1.19');
    for (const k of ['backend_sha', 'backend_sha_src2', 'frontend_sha', 'frontend_sha_src2', 'spec_sha']) {
      expect(d[k]).toBeTruthy();
    }
    expect(d.backend_sha).toBe(d.backend_sha_src2);
    expect(d.frontend_sha).toBe(d.frontend_sha_src2);
    expect(d.backend_sha).toHaveLength(40);
    expect(d.frontend_sha).toHaveLength(40);
  });

  it('backend 双源不等 → 拒绝建单且无新行', async () => {
    const res = await create({ backend_sha_src2: 'd'.repeat(40) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sha_source_mismatch');
    const { rows } = await pool.query('SELECT 1 FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows).toHaveLength(0);
  });

  it('frontend 双源不等 → 同样拒绝', async () => {
    expect((await create({ frontend_sha_src2: 'e'.repeat(40) })).status).toBe(400);
  });

  it('sha 不是 40 位 → 拒绝建单', async () => {
    expect((await create({ backend_sha: 'abc', backend_sha_src2: 'abc' })).status).toBe(400);
  });

  it('spec_sha 缺失 → 拒绝建单（规程版本对不上，冻结锁无从判起）', async () => {
    const res = await create({ spec_sha: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('spec_sha_required');
  });

  it('sha 未变 → 人列提交正常 200', async () => {
    await create({});
    expect((await submit({ backend_sha: BE, frontend_sha: FE, spec_sha: SPEC })).status).toBe(200);
  });

  it('staging 重新部署（backend_sha 变）→ 提交 409 且 run 转 stale', async () => {
    await create({});
    const res = await submit({ backend_sha: 'f'.repeat(40), frontend_sha: FE, spec_sha: SPEC });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('run_frozen_version_changed');
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('stale');
  });

  it('规程改版（spec_sha 变）→ 同样 409 且转 stale', async () => {
    await create({});
    const res = await submit({ backend_sha: BE, frontend_sha: FE, spec_sha: 'f'.repeat(64) });
    expect(res.status).toBe(409);
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('stale');
  });

  it('冻结拦下时那一格判定不落库（拒收整批，不是先写再报错）', async () => {
    await create({});
    await submit({ backend_sha: 'f'.repeat(40), frontend_sha: FE, spec_sha: SPEC });
    const { rows } = await pool.query(
      `SELECT c.result FROM acceptance_checks c JOIN acceptance_runs r ON r.id = c.run_id
        WHERE r.run_key = $1`, [RUN_KEY]
    );
    expect(rows[0].result).toBeNull();
  });

  it('run 有版本戳但提交不带 sha → 400（不静默跳过冻结锁）', async () => {
    await create({});
    const res = await submit({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sha_required_for_freeze_check');
  });

  it('stale run 永远达不到 human_complete（不是活跃 run）', async () => {
    await create({});
    await submit({ backend_sha: 'f'.repeat(40), frontend_sha: FE, spec_sha: SPEC });
    await submit({ backend_sha: BE, frontend_sha: FE, spec_sha: SPEC });
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('stale');
  });
});
