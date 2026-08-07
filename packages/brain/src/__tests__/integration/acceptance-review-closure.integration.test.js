import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';

const RUN_KEY = `t11-review-itest-${process.pid}`;
/** 与 vitest.config.js 的 ACCEPTANCE_OWNER_IDENTITY 同值 */
const OWNER = 'alex';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

/** 两个员工各提交过人列，发起人是 initiator */
async function seed({ adjudicatedHoursAgo = 1 } = {}) {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  const detail = {
    created_by: 'initiator',
    adjudicated_at: new Date(Date.now() - adjudicatedHoursAgo * 3600_000).toISOString(),
  };
  const { rows } = await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, status, detail)
     VALUES ($1,'复盘闭环','adjudicated',$2::jsonb) RETURNING id`,
    [RUN_KEY, JSON.stringify(detail)]
  );
  for (const [key, staff] of [['S3-c1', 'staff-a'], ['S8-c4', 'staff-b']]) {
    await pool.query(
      `INSERT INTO acceptance_checks (run_id, check_key, kind, name, result, submitted_by)
       VALUES ($1,$2,'FR',$2,'通过',$3)`,
      [rows[0].id, key, staff]
    );
  }
}

const ack = (who) => request(makeApp())
  .post(`/api/brain/acceptance/runs/${RUN_KEY}/review-ack`).set('X-Staff-Identity', who).send({});
const close = (who) => request(makeApp())
  .patch(`/api/brain/acceptance/runs/${RUN_KEY}/review-closed`).set('X-Staff-Identity', who).send({});

afterAll(async () => {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  await pool.end();
});

describe('A15 复盘闭环', () => {
  beforeEach(() => seed());

  it('A15② 员工身份打 review-closed → 403', async () => {
    const res = await close('staff-a');
    expect(res.status).toBe(403);
  });

  it('A15③ 未 ack 且未满 24h → 403', async () => {
    const res = await close('initiator');
    expect(res.status).toBe(403);
    expect(res.body.pending_acks.sort()).toEqual(['staff-a', 'staff-b']);
  });

  it('A15③ 全员 ack 后发起人 → 200 且留痕两项', async () => {
    expect((await ack('staff-a')).status).toBe(200);
    expect((await ack('staff-b')).status).toBe(200);
    const res = await close('initiator');
    expect(res.status).toBe(200);

    const { rows } = await pool.query('SELECT detail FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].detail.review_closed_by).toBe('initiator');
    expect(rows[0].detail.review_closed_at).toBeTruthy();
    expect(rows[0].detail.review_acks.map((a) => a.by).sort()).toEqual(['staff-a', 'staff-b']);
  });

  it('A15⑤ 零 ack 但 adjudicated_at 回拨 25h → 发起人打 review-closed 必须 200（防死锁）', async () => {
    await seed({ adjudicatedHoursAgo: 25 });
    const res = await close('initiator');
    expect(res.status).toBe(200);
  });

  it('主理人身份任何时候都能关（发起人不在时不锁死）', async () => {
    const res = await close(OWNER);
    expect(res.status).toBe(200);
  });

  it('review-ack 重复打不产生重复条目', async () => {
    await ack('staff-a');
    await ack('staff-a');
    const { rows } = await pool.query('SELECT detail FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].detail.review_acks).toHaveLength(1);
  });

  it('非本 run 人列提交人打 review-ack → 403', async () => {
    const res = await ack('staff-x');
    expect(res.status).toBe(403);
  });

  it('缺 X-Staff-Identity → 401', async () => {
    const res = await request(makeApp())
      .patch(`/api/brain/acceptance/runs/${RUN_KEY}/review-closed`).send({});
    expect(res.status).toBe(401);
  });
});
