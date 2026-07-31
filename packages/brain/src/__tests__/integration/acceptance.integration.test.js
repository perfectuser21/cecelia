import express from 'express';
import request from 'supertest';
import { describe, expect, it, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter, createAcceptancePublicRouter } from '../../routes/acceptance.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  app.use(createAcceptancePublicRouter({ pool }));
  return app;
}

const RUN_KEY = `itest-run-${process.pid}`;

describe('acceptance 全链 integration', () => {
  afterAll(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    await pool.end();
  });

  it('建单 → pending 可见 → 回写 results → pass_rate/status 更新', async () => {
    const app = makeApp();

    const create = await request(app).post('/api/brain/acceptance/runs').send({
      run_key: RUN_KEY,
      title: 'integration 测试单',
      gp_id: 'customer_smart_acquisition',
      checks: [
        { kind: 'FR', name: 'step1' },
        { kind: 'FR', name: 'step2' },
        { kind: 'Invariant', name: '不向未授权账号发消息' },
      ],
    });
    expect(create.status).toBe(201);
    expect(create.body.checks).toHaveLength(3);

    const again = await request(app).post('/api/brain/acceptance/runs').send({
      run_key: RUN_KEY, title: '重复', checks: [{ kind: 'FR', name: 'x' }],
    });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);

    const pending = await request(app).get('/acceptance/pending');
    expect(pending.status).toBe(200);
    const mine = pending.body.runs.find((r) => r.run_key === RUN_KEY);
    expect(mine.checks).toHaveLength(3);

    const results = await request(app).post('/acceptance/results').send({
      results: [
        { check_key: `${RUN_KEY}:001`, result: '通过' },
        { check_key: `${RUN_KEY}:002`, result: '不通过', note: '挂了' },
        { check_key: `${RUN_KEY}:003`, result: '通过' },
      ],
    });
    expect(results.status).toBe(200);
    const updated = results.body.runs.find((r) => r.run_key === RUN_KEY);
    expect(updated.status).toBe('failed');
    expect(Number(updated.pass_rate)).toBeCloseTo(2 / 3, 2);

    const { rows } = await pool.query('SELECT status, pass_rate FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('failed');
  });

  it('并发场景：同一 run_key 两次插入未终态驳回任务，第二次必须撞唯一索引', async () => {
    const runKey = `${RUN_KEY}-dedup`;
    await pool.query(
      `INSERT INTO tasks (title, task_type, status, payload)
       VALUES ('probe-1', 'dev', 'queued', $1::jsonb)`,
      [JSON.stringify({ acceptance_run_key: runKey })]
    );
    await expect(
      pool.query(
        `INSERT INTO tasks (title, task_type, status, payload)
         VALUES ('probe-2', 'dev', 'queued', $1::jsonb)`,
        [JSON.stringify({ acceptance_run_key: runKey })]
      )
    ).rejects.toMatchObject({ code: '23505' });
    await pool.query(`DELETE FROM tasks WHERE payload->>'acceptance_run_key' = $1`, [runKey]);
  });

  it('并发提交同一 run 不同 check_key：行锁保证最终 pass_rate 基于完整数据', async () => {
    const runKey = `${RUN_KEY}-race`;
    const app = makeApp();
    await request(app).post('/api/brain/acceptance/runs').send({
      run_key: runKey, title: 'race 测试单',
      checks: [{ kind: 'FR', name: 'a' }, { kind: 'FR', name: 'b' }],
    });
    const [r1, r2] = await Promise.all([
      request(app).post('/acceptance/results').send({ results: [{ check_key: `${runKey}:001`, result: '通过' }] }),
      request(app).post('/acceptance/results').send({ results: [{ check_key: `${runKey}:002`, result: '通过' }] }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const final = await request(app).get(`/api/brain/acceptance/runs/${runKey}`);
    expect(final.body.run.status).toBe('passed');
    expect(Number(final.body.run.pass_rate)).toBe(1);
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [runKey]);
  });
});
