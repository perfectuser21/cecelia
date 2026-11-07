import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import pg from 'pg';
import express from 'express';
import request from 'supertest';
import { DB_DEFAULTS } from '../../db-config.js';

const db = vi.hoisted(() => ({ query: null }));
vi.mock('../../db.js', () => ({ default: db }));
const client = new pg.Client(DB_DEFAULTS);
let app;
beforeAll(async () => {
  await client.connect();
  db.query = (...args) => client.query(...args);
  await client.query(`CREATE TEMP TABLE tasks (
    id text PRIMARY KEY, title text, task_type text, status text, pr_url text,
    pr_merged_at timestamp, success_metrics jsonb, completed_at timestamp,
    updated_at timestamp, execution_attempts integer
  )`);
  await client.query("INSERT INTO tasks (id,title,task_type,status) VALUES ('dev','dev','dev','completed_no_pr'), ('data','data','data','completed_no_pr')");
  const { default: router } = await import('../../routes/metrics.js');
  app = express(); app.use(express.json());
  // 测试现场模拟不同的 TCP 对端；不启用 trust proxy，也不把转发头当成来源身份。
  app.use((req, _res, next) => {
    const peer = req.get('x-test-peer-address');
    if (peer) Object.defineProperty(req.socket, 'remoteAddress', { value: peer, configurable: true });
    next();
  });
  app.use(router);
});
afterAll(async () => { await client.end(); });

it('真实 HTTP 和 PG：拒绝伪造 dev 合并，非 dev 保持原行为', async () => {
  const body = { pr_url: 'https://github.com/org/repo/pull/1' };
  expect((await request(app).patch('/tasks/dev/pr-merged').send(body)).status).toBe(409);
  const dev = await client.query("SELECT status, pr_url, pr_merged_at FROM tasks WHERE id='dev'");
  expect(dev.rows[0]).toEqual({ status: 'completed_no_pr', pr_url: null, pr_merged_at: null });
  expect((await request(app).patch('/tasks/data/pr-merged').send(body)).status).toBe(200);
  const data = await client.query("SELECT status, pr_url, pr_merged_at FROM tasks WHERE id='data'");
  expect(data.rows[0]).toMatchObject({ status: 'completed', pr_url: body.pr_url });
  expect(data.rows[0].pr_merged_at).not.toBeNull();
  // 前两次请求已消耗 2 次额度；第 60 次允许，第 61 次拒绝。
  for (let i = 2; i < 60; i++) {
    expect((await request(app).patch('/tasks/dev/pr-merged').send(body)).status).toBe(409);
  }
  expect((await request(app).patch('/tasks/dev/pr-merged').send(body)).status).toBe(429);
  expect((await request(app).patch('/tasks/dev/pr-merged').set('X-Forwarded-For', '192.0.2.2').send(body)).status).toBe(429);
  expect((await request(app).patch('/tasks/dev/pr-merged').set('x-test-peer-address', '127.0.0.2').send(body)).status).toBe(409);
});
