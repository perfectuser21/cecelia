import express from 'express';
import request from 'supertest';
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';

const RUN_A = `scope-a-${process.pid}`;
const RUN_B = `scope-b-${process.pid}`;
const RUN_LEGACY = `scope-legacy-${process.pid}`;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

const CHECKS = [
  { check_key: 'S3-c1', kind: 'FR', name: '权限三项已开启' },
  { check_key: 'S8-c4', kind: 'Invariant', name: '红线4：禁止假编号' },
];
/** gp_id 按进程取唯一：复盘闭环闸看「同 gp 上一轮」，共用固定值会撞上库里别的单 */
const GP_ID = `scope-gp-${process.pid}`;
/** 建单单头：租户白名单（A16②）对所有建单生效 */
const HEAD = { tenant_account: 'acc-verify-01' };

async function cleanup() {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = ANY($1)', [[RUN_A, RUN_B, RUN_LEGACY]]);
}

describe('A1/A3 格号作用域', () => {
  beforeAll(cleanup);
  afterAll(async () => { await cleanup(); await pool.end(); });

  it('A1 同 gp 两轮 run 用同一批格号建单，第二轮不再 23505', async () => {
    const app = makeApp();
    for (const run_key of [RUN_A, RUN_B]) {
      const res = await request(app).post('/api/brain/acceptance/runs')
        .send({ run_key, title: `两轮 ${run_key}`, gp_id: GP_ID, checks: CHECKS, detail: HEAD });
      expect(res.status).toBe(201);
      expect(res.body.checks.map((c) => c.check_key)).toEqual(['S3-c1', 'S8-c4']);
      // 开下一轮前先把这一轮的复盘标成已闭环：建单期闸（A15①）要求同 gp 上一轮
      // detail.review_closed_at 非空。这里直接写库而不走 review-closed 端点——
      // 本用例验的是格号作用域，不该顺带把复盘闭环的主体/前置闸也搬进来。
      await pool.query(
        `UPDATE acceptance_runs
            SET detail = COALESCE(detail,'{}'::jsonb) || jsonb_build_object('review_closed_at', now()::text)
          WHERE run_key = $1`,
        [run_key]
      );
    }
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM acceptance_checks c
       JOIN acceptance_runs r ON r.id = c.run_id
       WHERE r.run_key = $1 AND c.check_key = 'S3-c1'`, [RUN_A]
    );
    expect(rows[0].n).toBe(1);
  });

  it('A1 格号必须匹配 ^S\\d+-c[1-4]$，旧流水号格式被拒', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/brain/acceptance/runs')
      .send({ run_key: `${RUN_A}-bad`, title: 'bad', checks: [{ check_key: 'foo:001', kind: 'FR', name: 'x' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/check_key/);
  });

  it('A1 缺 check_key 直接 400，不回落到流水号', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/brain/acceptance/runs')
      .send({ run_key: `${RUN_A}-nokey`, title: 'nokey', checks: [{ kind: 'FR', name: 'x' }] });
    expect(res.status).toBe(400);
  });

  it('A3 向 run A 提交 S3-c1 后，run B 的 S3-c1 仍为 NULL（psql 直查不经 API）', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/brain/acceptance/results')
      .send({ run_key: RUN_A, results: [{ check_key: 'S3-c1', result: '通过' }] });
    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      `SELECT r.run_key, c.result FROM acceptance_checks c
       JOIN acceptance_runs r ON r.id = c.run_id
       WHERE c.check_key = 'S3-c1' AND r.run_key = ANY($1) ORDER BY r.run_key`,
      [[RUN_A, RUN_B]]
    );
    expect(rows.find((r) => r.run_key === RUN_A).result).toBe('通过');
    expect(rows.find((r) => r.run_key === RUN_B).result).toBeNull();
  });

  it('缺 run_key 的提交直接 400（不允许无作用域写）', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/brain/acceptance/results')
      .send({ results: [{ check_key: 'S3-c1', result: '通过' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/run_key/);
  });

  it('run_key 不存在 → 404，不静默写空', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/brain/acceptance/results')
      .send({ run_key: `${RUN_A}-nonexistent`, results: [{ check_key: 'S3-c1', result: '通过' }] });
    expect(res.status).toBe(404);
  });

  it('A1 的格号校验只管建单：存量 {run_key}:{NNN} 格号的历史 run 仍可提交（migration 392 明确不回填这 21 行）', async () => {
    // 直接建库模拟 392 之前落库的历史行——不经建单端点，因为新建单已拒收该格式
    const { rows: runRows } = await pool.query(
      `INSERT INTO acceptance_runs (run_key, title, gp_id) VALUES ($1, '历史单', '7790f728') RETURNING id`,
      [RUN_LEGACY]
    );
    await pool.query(
      `INSERT INTO acceptance_checks (run_id, check_key, kind, name) VALUES ($1, $2, 'FR', '历史格')`,
      [runRows[0].id, `${RUN_LEGACY}:001`]
    );
    const app = makeApp();
    const res = await request(app).post('/api/brain/acceptance/results')
      .send({ run_key: RUN_LEGACY, results: [{ check_key: `${RUN_LEGACY}:001`, result: '通过' }] });
    expect(res.status).toBe(200);
    const { rows } = await pool.query(
      `SELECT c.result FROM acceptance_checks c JOIN acceptance_runs r ON r.id = c.run_id WHERE r.run_key = $1`,
      [RUN_LEGACY]
    );
    expect(rows[0].result).toBe('通过');
  });
});
