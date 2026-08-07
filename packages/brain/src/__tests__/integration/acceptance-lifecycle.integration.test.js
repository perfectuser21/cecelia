import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';

const RUN_KEY = `t10-life-itest-${process.pid}`;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

async function seed() {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, status) VALUES ($1,'作废测试','in_review')`,
    [RUN_KEY]
  );
}

afterAll(async () => {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  await pool.end();
});

describe('A10③ 显式作废端点', () => {
  beforeEach(seed);

  it('作废后 status=abandoned 且三项留痕非空', async () => {
    const res = await request(makeApp())
      .patch(`/api/brain/acceptance/runs/${RUN_KEY}/abandon`)
      .send({ reason: '测试机被别的任务占用，本轮作废重开', by: 'alex' });
    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      'SELECT status, detail FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]
    );
    expect(rows[0].status).toBe('abandoned');
    expect(rows[0].detail.abandoned_reason).toBe('测试机被别的任务占用，本轮作废重开');
    expect(rows[0].detail.abandoned_by).toBe('alex');
    expect(rows[0].detail.abandoned_at).toBeTruthy();
  });

  it('缺 reason 或 by → 400，且不改状态', async () => {
    for (const body of [{ by: 'alex' }, { reason: 'x' }, {}]) {
      const res = await request(makeApp())
        .patch(`/api/brain/acceptance/runs/${RUN_KEY}/abandon`).send(body);
      expect(res.status).toBe(400);
    }
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('in_review');
  });

  it('不存在的 run → 404', async () => {
    const res = await request(makeApp())
      .patch(`/api/brain/acceptance/runs/t10-no-such-run-${process.pid}/abandon`)
      .send({ reason: 'x', by: 'alex' });
    expect(res.status).toBe(404);
  });

  it('A10④ 反二义：不存在「status 是活跃态而 detail 标了终态旗标」的行', async () => {
    await request(makeApp()).patch(`/api/brain/acceptance/runs/${RUN_KEY}/abandon`)
      .send({ reason: '反二义检查', by: 'alex' });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM acceptance_runs
        WHERE status IN ('pending','in_review')
          AND (detail ? 'abandoned_at' OR detail ? 'stale_at' OR detail ? 'expired_at')`
    );
    expect(rows[0].n).toBe(0);
  });
});
