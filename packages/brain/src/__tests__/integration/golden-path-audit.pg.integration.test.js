import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { createGoldenPathAuditStore } from '../../lib/golden-path-audit-store.js';
import { readGoldenPathT0 } from '../../lib/golden-path-window.js';
import { goldenPathSource } from '../../lib/golden-path-audit-runtime.js';
const options = process.env.TEST_DATABASE_URL ? { connectionString: process.env.TEST_DATABASE_URL } : DB_DEFAULTS;
const database = process.env.TEST_DATABASE_URL ? new URL(process.env.TEST_DATABASE_URL).pathname.slice(1) : DB_DEFAULTS.database;
if (!/_(scratch|test)$/.test(database)) throw new Error('scratch/test database required');
const pool = new pg.Pool({ ...options, max: 4 });
const windowId = randomUUID(), roots = [];
beforeAll(async () => { expect((await pool.query("SELECT to_regclass('cecelia_events') AS name")).rows[0].name).toBeTruthy(); });
afterAll(async () => {
  await pool.query("DELETE FROM cecelia_events WHERE source='golden-path-retirement' AND payload->>'window_id'=$1", [windowId]);
  await pool.end(); for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const payload = () => ({ audit_id: randomUUID(), window_id: windowId, lifecycle: 'heartbeat' });
it('真实非UTC数据库+UTC客户端，RETURNING持久DB时刻不猜naive时区', async () => {
  const prior = process.env.TZ; process.env.TZ = 'UTC';
  const wrapped = { async connect() { const c = await pool.connect(); await c.query("SET TIME ZONE 'America/Chicago'"); return c; } };
  try {
    const begin = (await pool.query('SELECT clock_timestamp() AS time')).rows[0].time.getTime();
    const receipt = await createGoldenPathAuditStore(wrapped).persist('golden_path_observation_health', payload());
    const end = (await pool.query('SELECT clock_timestamp() AS time')).rows[0].time.getTime();
    expect(receipt.created_at.getTime()).toBeGreaterThanOrEqual(begin); expect(receipt.created_at.getTime()).toBeLessThanOrEqual(end);
    const row = (await pool.query('SELECT payload FROM cecelia_events WHERE id=$1', [receipt.id])).rows[0];
    expect(Date.parse(row.payload.gp_db_created_at)).toBe(receipt.created_at.getTime());
    expect(receipt.db_time.getTime()).toBeGreaterThanOrEqual(receipt.created_at.getTime());
  } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
});
it('真实并发同audit_id只一事件，重放返回同ID同原始DB时间', async () => {
  const input = payload(), store = createGoldenPathAuditStore(pool);
  const [a, b] = await Promise.all([store.persist('golden_path_observation_health', input), store.persist('golden_path_observation_health', input)]);
  expect(b.id).toBe(a.id); expect(b.created_at).toEqual(a.created_at);
  expect((await pool.query("SELECT count(*) AS count FROM cecelia_events WHERE payload->>'audit_id'=$1", [input.audit_id])).rows[0].count).toBe('1');
  await expect(store.persist('golden_path_legacy_access', input)).rejects.toThrow('gp_audit_identity_conflict');
});
it('真实COMMIT生效但ACK丢失明确失败，重放查同一事件', async () => {
  let destroyed = false;
  const ambiguous = { async connect() { const c = await pool.connect(); return {
    async query(input) { const r = await c.query(input); if (input.text === 'COMMIT') throw new Error('ACK lost'); return r; },
    release(value) { destroyed = value; c.release(value); },
  }; } };
  const input = payload(); await expect(createGoldenPathAuditStore(ambiguous).persist('golden_path_observation_health', input)).rejects.toThrow();
  expect(destroyed).toBe(true);
  const rows = (await pool.query("SELECT id FROM cecelia_events WHERE payload->>'audit_id'=$1", [input.audit_id])).rows;
  expect(rows).toHaveLength(1); expect((await createGoldenPathAuditStore(pool).persist('golden_path_observation_health', input)).id).toBe(rows[0].id);
});
it('Chicago发行+UTC reader真实T0发行档绑定存储值，清理后保原值，旧未知发行拒绝', async () => {
  const source = goldenPathSource({ GIT_SHA: 'a'.repeat(40) });
  const root = mkdtempSync(path.join(os.tmpdir(), 'gp-t0-pg-')); roots.push(root);
  const wrapped = { async connect() { const c = await pool.connect(); await c.query("SET TIME ZONE 'America/Chicago'"); return c; } };
  const receipt = await createGoldenPathAuditStore(wrapped).issueT0({ root, windowId, source });
  const reader = await pool.connect();
  try {
    await reader.query("SET TIME ZONE 'UTC'");
    const window = { window_id: windowId, t0_event_id: receipt.id, source };
    expect(await readGoldenPathT0({ pool: reader, root, window })).toEqual(JSON.parse(JSON.stringify(receipt)));
    const actual = (await reader.query("SELECT to_char(created_at,'YYYY-MM-DD\"T\"HH24:MI:SS.US') AS value FROM cecelia_events WHERE id=$1", [receipt.id])).rows[0];
    expect(actual.value).toBe(receipt.issuance.clock_utc_text);
    expect(receipt.issuance.storage_type).toBe('timestamp without time zone');
    await reader.query('DELETE FROM cecelia_events WHERE id=$1', [receipt.id]);
    expect(await readGoldenPathT0({ pool: reader, root, window })).toEqual(JSON.parse(JSON.stringify(receipt)));
    const old = (await reader.query("INSERT INTO cecelia_events(event_type,source,payload) VALUES('golden_path_observation_t0','golden-path-retirement',$1) RETURNING id", [JSON.stringify({ window_id: windowId, source })])).rows[0];
    expect(await readGoldenPathT0({ pool: reader, root, window: { ...window, t0_event_id: old.id } })).toBeNull();
  } finally { await reader.query('RESET TIME ZONE'); reader.release(); }
});

it('真实新事件caller倒签8天必须拒绝，不把payload alias自比当DB锚', async () => {
  const source = goldenPathSource({ GIT_SHA: 'a'.repeat(40) });
  const dbNow = (await pool.query('SELECT clock_timestamp() AS time')).rows[0].time;
  const forged = new Date(dbNow.getTime() - 8 * 86400_000).toISOString();
  const row = (await pool.query(`INSERT INTO cecelia_events(event_type,source,payload)
    VALUES('golden_path_observation_t0','golden-path-retirement',$1) RETURNING id`,
  [JSON.stringify({ window_id: windowId, source, gp_db_created_at: forged })])).rows[0];
  expect(await readGoldenPathT0({ pool, root: '/unused', window: { window_id: windowId, t0_event_id: row.id, source } })).toBeNull();
});

it('真实DB lease按instance最新持久heartbeat/end与DBclock返回，非本机时间', async () => {
  const store = createGoldenPathAuditStore(pool), instance_id = randomUUID();
  const event = await store.persist('golden_path_observation_health', { ...payload(), instance_id, healthy: true });
  const live = await store.lease(instance_id);
  expect(live.latest.lifecycle).toBe('heartbeat');
  expect(Date.parse(live.latest.gp_db_created_at)).toBe(event.created_at.getTime());
  expect(live.db_now.getTime()).toBeGreaterThanOrEqual(event.created_at.getTime());
  await store.persist('golden_path_observation_health', { ...payload(), instance_id, lifecycle: 'instance_end', healthy: true });
  expect((await store.lease(instance_id)).latest.lifecycle).toBe('instance_end');
});

it('Chicago writer默认naive时间+倒签5h，UTC reader无发行回执必须拒绝', async () => {
  const source = goldenPathSource({ GIT_SHA: 'a'.repeat(40) });
  const writer = await pool.connect(), reader = await pool.connect();
  try {
    await writer.query("SET TIME ZONE 'America/Chicago'"); await reader.query("SET TIME ZONE 'UTC'");
    const row = (await writer.query(`INSERT INTO cecelia_events(event_type,source,payload)
      VALUES('golden_path_observation_t0','golden-path-retirement',
      $1::jsonb||jsonb_build_object('gp_db_created_at',now()-interval '5 hours')) RETURNING id`,
    [JSON.stringify({ window_id: windowId, source })])).rows[0];
    expect(await readGoldenPathT0({ pool: reader, root: '/unused', window: { window_id: windowId, t0_event_id: row.id, source } })).toBeNull();
  } finally { await writer.query('RESET TIME ZONE'); await reader.query('RESET TIME ZONE'); writer.release(); reader.release(); }
});

it('有真实新T0 DBstamp但无受控发行档拒绝，不能读行后自动升级历史档', async () => {
  const source = goldenPathSource({ GIT_SHA: 'a'.repeat(40) });
  const row = await createGoldenPathAuditStore(pool).persist('golden_path_observation_t0', { audit_id: randomUUID(), window_id: windowId, source });
  const root = mkdtempSync(path.join(os.tmpdir(), 'gp-no-issue-')); roots.push(root);
  expect(await readGoldenPathT0({ pool, root, window: { window_id: windowId, t0_event_id: row.id, source } })).toBeNull();
});

it('发行档存在但实际DB payload变化必须拒绝，不能由可信旧档覆盖冲突行', async () => {
  const source = goldenPathSource({ GIT_SHA: 'a'.repeat(40) });
  const root = mkdtempSync(path.join(os.tmpdir(), 'gp-conflict-pg-')); roots.push(root);
  const receipt = await createGoldenPathAuditStore(pool).issueT0({ root, windowId, source });
  await pool.query("UPDATE cecelia_events SET payload=payload||jsonb_build_object('gp_db_created_at',now()-interval '5 hours') WHERE id=$1", [receipt.id]);
  expect(await readGoldenPathT0({ pool, root, window: { window_id: windowId, t0_event_id: receipt.id, source } })).toBeNull();
});

it('真实T0 COMMIT生效ACK丢失不发行，不返回有效T0；DB仍有行必须诚实不可证明', async () => {
  const source = goldenPathSource({ GIT_SHA: 'a'.repeat(40) });
  const root = mkdtempSync(path.join(os.tmpdir(), 'gp-issue-unknown-')); roots.push(root);
  const ambiguous = { async connect() { const c = await pool.connect(); return {
    async query(input) { const result = await c.query(input); if (input.text === 'COMMIT') throw new Error('ACK lost'); return result; },
    release(value) { c.release(value); },
  }; } };
  const before = (await pool.query("SELECT id FROM cecelia_events WHERE payload->>'window_id'=$1", [windowId])).rows.map(r => r.id);
  await expect(createGoldenPathAuditStore(ambiguous).issueT0({ root, windowId, source })).rejects.toThrow('ACK lost');
  const rows = (await pool.query("SELECT id FROM cecelia_events WHERE payload->>'window_id'=$1", [windowId])).rows.filter(r => !before.includes(r.id));
  expect(rows).toHaveLength(1);
  expect(await readGoldenPathT0({ pool, root, window: { window_id: windowId, t0_event_id: rows[0].id, source } })).toBeNull();
});

it('真实DB已提交但发行档冲突不返回有效T0，不能补造归档或假zero writes', async () => {
  const source = goldenPathSource({ GIT_SHA: 'a'.repeat(40) });
  const root = mkdtempSync(path.join(os.tmpdir(), 'gp-issue-fs-conflict-')); roots.push(root);
  const directory = path.join(root, windowId); mkdirSync(directory, { mode: 0o700 });
  writeFileSync(path.join(directory, 't0-receipt.json'), '{}', { mode: 0o600 });
  const before = (await pool.query("SELECT id FROM cecelia_events WHERE payload->>'window_id'=$1", [windowId])).rows.map(r => r.id);
  await expect(createGoldenPathAuditStore(pool).issueT0({ root, windowId, source })).rejects.toThrow('gp_archive_invalid');
  const rows = (await pool.query("SELECT id FROM cecelia_events WHERE payload->>'window_id'=$1", [windowId])).rows.filter(r => !before.includes(r.id));
  expect(rows).toHaveLength(1);
  expect(await readGoldenPathT0({ pool, root, window: { window_id: windowId, t0_event_id: rows[0].id, source } })).toBeNull();
});

it('发行后DB行event_type改变仍存在必须拒绝，不当成清理后archive兜底', async () => {
  const source = goldenPathSource({ GIT_SHA: 'a'.repeat(40) });
  const root = mkdtempSync(path.join(os.tmpdir(), 'gp-issue-type-conflict-')); roots.push(root);
  const receipt = await createGoldenPathAuditStore(pool).issueT0({ root, windowId, source });
  await pool.query("UPDATE cecelia_events SET event_type='golden_path_legacy_access' WHERE id=$1", [receipt.id]);
  expect(await readGoldenPathT0({ pool, root, window: { window_id: windowId, t0_event_id: receipt.id, source } })).toBeNull();
});
