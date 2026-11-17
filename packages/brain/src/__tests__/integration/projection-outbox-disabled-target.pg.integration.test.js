import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { runProjectionOutbox } from '../../projection/outbox.js';

// 独立 scratch/test 库、随机 schema；只使用原迁移的两张表，不触发真实投影。
describe('projection outbox 目标开关真实 PostgreSQL', () => {
  const schema = `outbox_${randomUUID().replaceAll('-', '')}`;
  const database = process.env.DB_NAME || 'cecelia_test';
  const pool = new pg.Pool({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    database, user: process.env.DB_USER || 'cecelia', password: process.env.DB_PASSWORD,
    options: `-c search_path=${schema}`, max: 4,
  });
  let created = false;

  beforeAll(async () => {
    if (!/^cecelia_(scratch|test)$/.test(database)) throw new Error('只允许独立 scratch/test 数据库');
    const identity = (await pool.query('SELECT current_database() AS database, inet_server_port() AS port')).rows[0];
    expect(identity).toEqual({ database, port: Number(process.env.DB_PORT || 5432) });
    if (process.env.OUTBOX_TEST_PGDATA) {
      expect((await pool.query('SHOW data_directory')).rows[0].data_directory).toBe(process.env.OUTBOX_TEST_PGDATA);
    }
    await pool.query(`CREATE SCHEMA ${schema}`);
    created = true;
    const migration = readFileSync(new URL('../../../migrations/395_workbench_projection.sql', import.meta.url), 'utf8');
    for (const table of ['projection_targets', 'projection_outbox']) {
      const ddl = migration.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
      expect(ddl).toBeTruthy();
      await pool.query(ddl);
    }
  });
  beforeEach(async () => { await pool.query('TRUNCATE projection_targets, projection_outbox'); });
  afterAll(async () => {
    try { if (created) await pool.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await pool.end(); }
  });

  async function seed(target, { status = 'pending', type = 'tasks', attempts = 0, age = 0, due = true, stale = true } = {}) {
    return (await pool.query(`INSERT INTO projection_outbox
      (target,entity_type,entity_id,idempotency_key,status,attempts,created_at,updated_at,available_at,leased_at,last_error)
      VALUES ($1,$2,$3,$4,$5,$6,NOW()-$7*INTERVAL '1 minute',NOW()-INTERVAL '1 day',
        NOW()+$8*INTERVAL '1 minute',CASE WHEN $5::varchar='processing' THEN NOW()-$9*INTERVAL '1 minute' ELSE NULL END,'原始错误') RETURNING *`,
    [target, type, randomUUID(), randomUUID(), status, attempts, age, due ? -1 : 60, stale ? 11 : 1])).rows[0];
  }
  const target = (name, enabled) => pool.query('INSERT INTO projection_targets(target,enabled) VALUES($1,$2)', [name, enabled]);

  it('明确关闭目标在认领前排除 pending、failed、超时 processing，整行和重试计数不变', async () => {
    await target('notion', false);
    const before = [];
    for (const status of ['pending', 'failed', 'processing']) before.push(await seed('notion', { status, attempts: 3 }));
    const adapter = vi.fn(() => { throw new Error('关闭目标不应调用 adapter'); });
    expect(await runProjectionOutbox(pool, { adapter })).toEqual({ processed: 0, done: 0, failed: 0, deferred: 0 });
    expect(adapter).not.toHaveBeenCalled();
    const after = (await pool.query('SELECT * FROM projection_outbox ORDER BY id')).rows;
    expect(after).toEqual(before.sort((a, b) => a.id.localeCompare(b.id)));
    expect(await runProjectionOutbox(pool, { adapter })).toEqual({ processed: 0, done: 0, failed: 0, deferred: 0 });
    await target('enabled-target', true);
    const enabled = await seed('enabled-target');
    expect(await runProjectionOutbox(pool, { adapter: async () => ({}), limit: 1 }))
      .toEqual({ processed: 1, done: 1, failed: 0, deferred: 0 });
    expect((await pool.query("SELECT * FROM projection_outbox WHERE target='notion' ORDER BY id")).rows).toEqual(before);
    expect((await pool.query('SELECT status FROM projection_outbox WHERE id=$1', [enabled.id])).rows[0].status).toBe('done');
  });

  it('开关重新启用后继续处理原行；无 target 配置和未知 target 仍按原默认处理', async () => {
    await target('notion', false);
    const paused = await seed('notion');
    await pool.query("UPDATE projection_targets SET enabled=true WHERE target='notion'");
    const missing = await seed('missing-config');
    const unknown = await seed('unknown-target');
    const seen = [];
    const summary = await runProjectionOutbox(pool, { adapter: async (_pool, event) => {
      seen.push(event.id);
      return event.target === 'unknown-target' ? { skipped: true, reason: 'unsupported_target' } : {};
    } });
    expect(summary).toEqual({ processed: 3, done: 3, failed: 0, deferred: 0 });
    expect(seen.sort()).toEqual([paused.id, missing.id, unknown.id].sort());
    expect((await pool.query('SELECT status,attempts,leased_at FROM projection_outbox')).rows)
      .toEqual(Array.from({ length: 3 }, () => ({ status: 'done', attempts: 1, leased_at: null })));
  });

  it('开启目标保持项目优先、同类型最旧优先、limit 和真实 SKIP LOCKED', async () => {
    await target('notion', true);
    const task = await seed('notion', { age: 100 });
    const locked = await seed('notion', { type: 'projects', age: 20 });
    const next = await seed('notion', { type: 'projects', age: 10 });
    const newest = await seed('notion', { type: 'projects', age: 1 });
    const locker = await pool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM projection_outbox WHERE id=$1 FOR UPDATE', [locked.id]);
      const seen = [];
      const adapter = async (_pool, event) => { seen.push(event.id); return {}; };
      expect(await runProjectionOutbox(pool, { adapter, limit: 1 })).toMatchObject({ processed: 1, done: 1 });
      expect(seen).toEqual([next.id]);
      expect(await runProjectionOutbox(pool, { adapter, limit: 1 })).toMatchObject({ processed: 1, done: 1 });
      expect(seen).toEqual([next.id, newest.id]);
      await locker.query('ROLLBACK');
      await runProjectionOutbox(pool, { adapter, limit: 1 });
      expect(seen).toEqual([next.id, newest.id, locked.id]);
      expect((await pool.query('SELECT status FROM projection_outbox WHERE id=$1', [task.id])).rows[0].status).toBe('pending');
    } finally { await locker.query('ROLLBACK'); locker.release(); }
  });

  it('开启目标回收旧 lease，保留新 lease/未到期行；保留延期、重试与 dead 判定', async () => {
    await target('notion', true);
    const stale = await seed('notion', { status: 'processing', attempts: 1 });
    const fresh = await seed('notion', { status: 'processing', stale: false });
    const future = await seed('notion', { status: 'failed', due: false });
    const retry = await seed('notion', { status: 'failed', attempts: 2 });
    const dead = await seed('notion', { status: 'failed', attempts: 4 });
    const deferred = await seed('notion', { attempts: 2 });
    const gone = await seed('notion');
    const summary = await runProjectionOutbox(pool, { adapter: async (_pool, event) => {
      if ([retry.id, dead.id].includes(event.id)) throw new Error('重试错误');
      if (event.id === deferred.id) return { skipped: true, reason: 'not_configured' };
      if (event.id === gone.id) return { skipped: true, reason: 'entity_not_found' };
      return {};
    } });
    expect(summary).toEqual({ processed: 5, done: 2, failed: 2, deferred: 1 });
    const rows = (await pool.query('SELECT *,available_at>NOW() AS delayed FROM projection_outbox')).rows;
    const row = id => rows.find(item => item.id === id);
    expect(row(stale.id)).toMatchObject({ status: 'done', attempts: 2, leased_at: null });
    expect(row(retry.id)).toMatchObject({ status: 'failed', attempts: 3, last_error: '重试错误', delayed: true, leased_at: null });
    expect(row(dead.id)).toMatchObject({ status: 'dead', attempts: 5, last_error: '重试错误', delayed: true, leased_at: null });
    expect(row(deferred.id)).toMatchObject({ status: 'pending', attempts: 2, last_error: 'not_configured', delayed: true, leased_at: null });
    expect(row(gone.id)).toMatchObject({ status: 'done', attempts: 1, leased_at: null });
    for (const unchanged of [fresh, future]) {
      const { delayed: _delayed, ...saved } = row(unchanged.id);
      expect(saved).toEqual(unchanged);
    }
  });
});
