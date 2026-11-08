/** 真实 PostgreSQL 临时表：检查 Codex 槽位的任务身份与去重。 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';

const boundary = vi.hoisted(() => ({ client: null }));
vi.mock('../../db.js', () => ({ default: {
  query: (...args) => {
    if (!boundary.client) throw new Error('必须使用本人隔离 PostgreSQL 会话');
    return boundary.client.query(...args);
  },
} }));
vi.mock('../../executor.js', () => ({
  MAX_SEATS: 12, PHYSICAL_CAPACITY: 12,
  checkServerResources: () => ({}), getActiveProcessCount: () => 0,
  getEffectiveMaxSeats: () => 12, getBudgetCap: () => ({}), getTokenPressure: async () => ({}),
}));

it('动态 Codex 与原生任务各计一次，其他执行器及已完成任务不占槽', async () => {
  const client = new pg.Client(privatePgConfig());
  try {
    await client.connect();
    await verifyPrivatePg(client);
    await client.query('CREATE TEMP TABLE tasks (status text, task_type text, payload jsonb)');
    await client.query(`INSERT INTO tasks(status,task_type,payload) VALUES
      ('in_progress','codex_dev','{}'),
      ('in_progress','dev','{"executor":"codex"}'),
      ('in_progress','codex_dev','{"executor":"codex"}'),
      ('in_progress','dev','{"executor":"grok"}'),
      ('completed','dev','{"executor":"codex"}')`);
    boundary.client = client;
    const { countCodexInProgress } = await import('../../slot-allocator.js');
    expect(await countCodexInProgress()).toBe(3);
  } finally {
    boundary.client = null;
    await client.end();
  }
});

it('同一 runner 新 claim 接手后，旧 claim 无法回滚任务或改变设备锁', async () => {
  const first = new pg.Client(privatePgConfig()), second = new pg.Client(privatePgConfig());
  const schema = `codex_claim_${randomUUID().replaceAll('-', '')}`;
  let firstConnected = false, secondConnected = false, owned = false;
  try {
    await first.connect(); firstConnected = true;
    await verifyPrivatePg(first);
    await second.connect(); secondConnected = true;
    await verifyPrivatePg(second);
    await first.query(`CREATE SCHEMA "${schema}"`); owned = true;
    await first.query(`CREATE TABLE "${schema}".tasks (id text PRIMARY KEY, status text, claimed_by text, claimed_at timestamptz, updated_at timestamptz)`);
    await first.query(`CREATE TABLE "${schema}".device_locks (device_name text PRIMARY KEY, locked_by text, locked_at timestamptz, expires_at timestamptz)`);
    await first.query(`CREATE TABLE "${schema}".task_leases (task_id text, released_at timestamptz, lease_until timestamptz)`);
    await second.query(`SET search_path TO "${schema}"`);
    await first.query(`INSERT INTO "${schema}".tasks VALUES ('t', 'in_progress', 'runner', '2026-11-07 06:00:00.123456+00', NOW())`);
    await first.query(`INSERT INTO "${schema}".device_locks VALUES ('phone', 't', NOW(), NOW() + interval '30 minutes')`);
    const old = await first.query(`SELECT claimed_at::text AS stamp FROM "${schema}".tasks WHERE id='t'`);
    await second.query(`UPDATE "${schema}".tasks SET claimed_at='2026-11-07 06:00:01.123456+00' WHERE id='t'`);
    const { acquireDeviceLock } = await import('../../device-lock-helpers.js');
    expect((await acquireDeviceLock('t', 'phone', 30, second)).result).toBe('acquired');
    const stale = await first.query(`UPDATE "${schema}".tasks
      SET status='queued', claimed_by=NULL, claimed_at=NULL, updated_at=NOW()
      WHERE id=$1 AND status='in_progress' AND claimed_by=$2 AND claimed_at=$3::timestamptz`,
    ['t', 'runner', old.rows[0].stamp]);
    expect(stale.rowCount).toBe(0);
    const task = await second.query(`SELECT status, claimed_by, claimed_at::text AS stamp FROM "${schema}".tasks WHERE id='t'`);
    expect(task.rows[0]).toMatchObject({ status: 'in_progress', claimed_by: 'runner' });
    expect(task.rows[0].stamp).not.toBe(old.rows[0].stamp);
    const lock = await second.query(`SELECT locked_by FROM "${schema}".device_locks WHERE device_name='phone'`);
    expect(lock.rows[0].locked_by).toBe('t');
  } finally {
    if (owned) await first.query(`DROP SCHEMA "${schema}" CASCADE`);
    if (secondConnected) await second.end();
    if (firstConnected) await first.end();
  }
});
