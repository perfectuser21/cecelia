import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
const holder = vi.hoisted(() => ({ query: null }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => holder.query(...args) } }));
vi.mock('../../actions.js', () => ({ createTask: vi.fn() }));
import router from '../../routes/content-pipeline.js';
const pool = new pg.Pool(DB_DEFAULTS);
const app = express(); app.use(express.json()); app.use('/pipelines', router);
const ids = [];
beforeEach(() => { holder.query = (...args) => pool.query(...args); });
afterAll(async () => {
  await pool.query('DELETE FROM tasks WHERE id=ANY($1::uuid[])', [ids]);
  await pool.end();
});
async function seed(status) {
  const id = randomUUID(); ids.push(id);
  await pool.query(`INSERT INTO tasks(id,title,task_type,status) VALUES($1,$2,'content-pipeline',$3)`, [id, `受理-${id}`, status]);
  return id;
}
const run = id => request(app).post(`/pipelines/${id}/run`);
describe('内容管线受理状态与真实PG CAS', () => {
  it.each(['failed', 'in_progress', 'cancelled'])('%s不假称已入队', async status => {
    const id = await seed(status); const res = await run(id);
    expect(res.status).toBe(409); expect(res.body.status).toBe(status);
    expect((await pool.query('SELECT status FROM tasks WHERE id=$1', [id])).rows[0].status).toBe(status);
  });
  it.each(['completed', 'queued'])('%s实际入队才接受', async status => {
    const id = await seed(status); const res = await run(id);
    expect(res.status).toBe(202); expect(res.body.status).toBe('queued');
    expect((await pool.query('SELECT status FROM tasks WHERE id=$1', [id])).rows[0].status).toBe('queued');
  });
  it('读取completed后被其他执行者改成in_progress，不覆盖领取且返回冲突', async () => {
    const id = await seed('completed');
    holder.query = async (sql, params) => {
      if (/UPDATE tasks SET status = 'queued'/.test(sql)) {
        await pool.query("UPDATE tasks SET status='in_progress',claimed_by='competing-owner' WHERE id=$1", [id]);
      }
      return pool.query(sql, params);
    };
    const res = await run(id); expect(res.status).toBe(409);
    expect((await pool.query('SELECT status,claimed_by FROM tasks WHERE id=$1', [id])).rows[0])
      .toEqual({ status: 'in_progress', claimed_by: 'competing-owner' });
  });
});
