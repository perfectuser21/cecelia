import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import pg from 'pg';
import express from 'express';
import request from 'supertest';
import { DB_DEFAULTS } from '../../db-config.js';
// Only the connection boundary is replaced: production SQL runs on owned PostgreSQL.
const boundary = vi.hoisted(() => ({ db: null }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => boundary.db.query(...args) } }));
const nativeFetch = globalThis.fetch;
let db, schema, upstream, app, nextId = 0;
const waiting = [];
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 30)); };
const row = async id => (await db.query('SELECT * FROM clips WHERE id=$1', [id])).rows[0];
const submit = async () => request(app).post('/clips').send({ url: `https://douyin.com/owned-${nextId++}` });
beforeAll(async () => {
  if (process.env.POSTGRES_INTEGRATION !== '1' || DB_DEFAULTS.database !== 'cecelia_scratch'
    || !['127.0.0.1', 'localhost'].includes(DB_DEFAULTS.host)
    || (DB_DEFAULTS.port === 5432 && process.env.CI !== 'true')) throw Error('clips requires explicit owned scratch PG');
  db = new pg.Client(DB_DEFAULTS); await db.connect();
  expect((await db.query('SELECT current_database() AS db,current_user AS actor,inet_server_port() AS port')).rows[0])
    .toEqual({ db: 'cecelia_scratch', actor: DB_DEFAULTS.user, port: DB_DEFAULTS.port });
  schema = `clips_${randomUUID().replaceAll('-', '')}`;
  await db.query(`CREATE SCHEMA ${schema}`); await db.query(`SET search_path TO ${schema},pg_catalog`);
  await db.query(await readFile(new URL('../../../../../database/migrations/010-content-clips.sql', import.meta.url), 'utf8'));
  boundary.db = db;
  upstream = createServer((_req, res) => waiting.push(res));
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  vi.stubEnv('CONTENT_SERVICE_PROXY_URL', `http://127.0.0.1:${upstream.address().port}`);
  vi.stubEnv('BRAIN_PUBLIC_URL', 'http://owned.invalid');
  vi.stubEnv('NOTION_API_KEY', ''); vi.stubEnv('CLIPS_WEBHOOK_SECRET', '');
  const { default: router } = await import('../../routes/clips.js');
  app = express().use(express.json()).use('/clips', router);
});
beforeEach(() => { waiting.length = 0; });
afterEach(async () => {
  for (const res of waiting) if (!res.writableEnded) res.end();
  vi.unstubAllGlobals(); await flush();
});
afterAll(async () => {
  if (upstream) { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
  try { if (schema) await db.query(`DROP SCHEMA ${schema} CASCADE`); }
  finally { await db?.end(); vi.unstubAllEnvs(); }
});
const respond = async (index, status) => {
  await vi.waitFor(() => expect(waiting.length).toBeGreaterThan(index));
  waiting[index].writeHead(status).end('owned upstream unavailable');
};
it.each(['submit', 'retry'])('%s HTTP500 persists a failed row and error', async entry => {
  const accepted = await submit(); expect(accepted.status).toBe(201); const id = accepted.body.id;
  if (entry === 'retry') {
    await respond(0, 200); await flush();
    expect((await request(app).post(`/clips/${id}/retry`).send({})).status).toBe(200);
  }
  await respond(entry === 'retry' ? 1 : 0, 500);
  await vi.waitFor(async () => expect((await row(id)).status).toBe('failed'));
  expect((await row(id)).retry_count).toBe(entry === 'retry' ? 1 : 0);
  expect((await row(id)).error_msg).toContain('content-service error 500');
});
it('actual aborted HTTP request persists timeout failure without adding a timeout policy', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', (url, options) => nativeFetch(url, { ...options, signal: controller.signal }));
  const accepted = await submit(); await vi.waitFor(() => expect(waiting.length).toBe(1));
  controller.abort(new DOMException('owned timeout', 'TimeoutError'));
  await vi.waitFor(async () => expect((await row(accepted.body.id)).status).toBe('failed'));
  expect((await row(accepted.body.id)).error_msg).toBe('owned timeout');
});
it('successful callback wins over older request failure', async () => {
  const accepted = await submit(); const id = accepted.body.id;
  expect((await request(app).post(`/clips/${id}/callback`).send({ success: true, title: 'owned success' })).status).toBe(200);
  await respond(0, 500); await flush();
  expect(await row(id)).toMatchObject({ status: 'done', title: 'owned success', error_msg: null });
});
it('new retry owns the row; only its own failure may fail it', async () => {
  const accepted = await submit(); const id = accepted.body.id;
  expect((await request(app).post(`/clips/${id}/retry`).send({})).status).toBe(200);
  await respond(0, 500); await flush();
  expect(await row(id)).toMatchObject({ status: 'pending', retry_count: 1, error_msg: null });
  await respond(1, 500);
  await vi.waitFor(async () => expect((await row(id)).status).toBe('failed'));
  expect((await row(id)).retry_count).toBe(1);
});
it('NULL legacy retry count advances; successful acceptance stays pending for callback', async () => {
  const accepted = await submit(); const id = accepted.body.id;
  await respond(0, 200); await flush();
  await db.query('UPDATE clips SET retry_count=NULL WHERE id=$1', [id]);
  expect((await request(app).post(`/clips/${id}/retry`).send({})).status).toBe(200);
  await respond(1, 200); await flush();
  expect(await row(id)).toMatchObject({ status: 'pending', retry_count: 1, error_msg: null });
});
