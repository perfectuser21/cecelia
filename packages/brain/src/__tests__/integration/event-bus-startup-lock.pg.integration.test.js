import { expect, it, vi } from 'vitest';
import { privateFixtureDatabase } from '../fixtures/private-fixture-db.js';

const mocked = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mocked }));
import { ensureEventsTable } from '../../event-bus.js';

const table = `CREATE TABLE cecelia_events (
  id SERIAL PRIMARY KEY, event_type VARCHAR(50) NOT NULL,
  source VARCHAR(50) NOT NULL, payload JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW()
)`;
const index = 'CREATE INDEX idx_cecelia_events_type_time ON cecelia_events(event_type,created_at DESC)';

async function fixture(setup, check) {
  const f = await privateFixtureDatabase('eventbusstartup', setup);
  try {
    await f.client.query("SET lock_timeout='250ms'");
    mocked.query.mockReset().mockImplementation(f.client.query.bind(f.client));
    await check(f);
  } finally { await f.close(); }
}

it('已就绪的索引在真实RowExclusive维护锁下直接读回，不申请DDL锁', async () => {
  await fixture(async db => { await db.query(table); await db.query(index); }, async f => {
    const locker = await f.createPool(1).connect();
    try {
      await locker.query('BEGIN');
      await locker.query('LOCK TABLE cecelia_events IN ROW EXCLUSIVE MODE');
      await ensureEventsTable();
      expect(mocked.query.mock.calls).toHaveLength(1);
      expect(mocked.query.mock.calls[0][0]).toContain('pg_index');
      expect((await locker.query('SELECT 1 AS lock_still_held')).rows[0].lock_still_held).toBe(1);
    } finally { await locker.query('ROLLBACK'); locker.release(); }
  });
});

it.each(['empty', 'missing-index'])('保留scratch初始化并读回实际ready：%s', async state => {
  await fixture(async db => { if (state === 'missing-index') await db.query(table); }, async f => {
    await ensureEventsTable();
    const { rows } = await f.client.query(`SELECT i.indisvalid,i.indisready,i.indrelid='cecelia_events'::regclass AS target
      FROM pg_index i WHERE i.indexrelid='idx_cecelia_events_type_time'::regclass`);
    expect(rows).toEqual([{ indisvalid: true, indisready: true, target: true }]);
  });
});

it('同名索引属于其他表不能被IF NOT EXISTS掩盖成就绪', async () => {
  await fixture(async db => {
    await db.query(table); await db.query('CREATE TABLE other_events(event_type text,created_at timestamptz)');
    await db.query('CREATE INDEX idx_cecelia_events_type_time ON other_events(event_type,created_at DESC)');
  }, async () => { await expect(ensureEventsTable()).rejects.toThrow('EVENTS_SCHEMA_NOT_READY'); });
});

it('真实失败的concurrent索引indisvalid=false，必须拒绝假就绪', async () => {
  await fixture(async db => {
    await db.query(table);
    await db.query("INSERT INTO cecelia_events(event_type,source) VALUES('duplicate','fixture'),('duplicate','fixture')");
    await expect(db.query('CREATE UNIQUE INDEX CONCURRENTLY idx_cecelia_events_type_time ON cecelia_events(event_type)')).rejects.toMatchObject({ code: '23505' });
    expect((await db.query("SELECT indisvalid FROM pg_index WHERE indexrelid='idx_cecelia_events_type_time'::regclass")).rows[0].indisvalid).toBe(false);
  }, async () => { await expect(ensureEventsTable()).rejects.toThrow('EVENTS_SCHEMA_NOT_READY'); });
});
