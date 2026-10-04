/**
 * ops-alarm-ledger.pg.integration.test.js — 闹钟总账真 PG 集成（任务 fe10d1a0）
 *
 * fakePool 按子串匹配抓不到列名拼错、占位符错位、ON CONFLICT 目标缺唯一键、CHECK 约束被撞这类 bug，
 * 只有对着真表（517 迁移后的 ops_schedule_entries）跑一遍才测得出。
 *
 * 门控：连不上 PG，或库里还没有 517 的列（本地 DB 落后）→ 整体 skip（不 mock pg，不假装绿）。
 * 隔离：每个用例 BEGIN，结束 ROLLBACK，不污染共享测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { runSchedulerLiveness } from '../ops-scheduler-liveness.js';
import { syncRecurringLedger } from '../ops-alarm-ledger.js';
import { importInventorySnapshot } from '../ops-alarm-import.js';
import { buildAlarmsPayload } from '../routes/agent-ops.js';

let DB_READY = false;
{
  let probe;
  try {
    probe = new pg.Pool({ ...DB_DEFAULTS, max: 1, connectionTimeoutMillis: 2000 });
    const { rows } = await probe.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='ops_schedule_entries' AND column_name='ledger_status'`);
    DB_READY = rows.length === 1;
  } catch {
    DB_READY = false;
  } finally {
    if (probe) await probe.end().catch(() => {});
  }
}

/** 让 importInventorySnapshot 的 pool.connect() 复用测试事务：吞掉它自己的 BEGIN/COMMIT/ROLLBACK。 */
function txPool(client) {
  const swallow = /^(BEGIN|COMMIT|ROLLBACK)$/;
  return {
    query: (sql, p) => client.query(sql, p),
    connect: async () => ({
      query: (sql, p) => (swallow.test(String(sql).trim()) ? Promise.resolve({ rows: [] }) : client.query(sql, p)),
      release: () => {},
    }),
  };
}

describe.skipIf(!DB_READY)('闹钟总账 — pg 集成（真实 SQL，不 mock pg）', () => {
  let pool;
  let client;
  const NOW = Date.parse('2026-10-04T01:00:00Z');
  const iso = (secAgo) => new Date(NOW - secAgo * 1000).toISOString();

  beforeAll(() => { pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { client = await pool.connect(); await client.query('BEGIN'); });
  afterEach(async () => { await client.query('ROLLBACK'); client.release(); });

  const seedSentinel = (name, rec) => client.query(
    `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2`,
    [`scheduler_job_last_run:${name}`, JSON.stringify(rec)]);
  const ledgerRow = async (label) => (await client.query(
    `SELECT * FROM ops_schedule_entries WHERE source='brain' AND host_alias='us-vps' AND label=$1`, [label])).rows[0];

  it('Brain job 落总账：列值正确、挂上 ops_workflows、满足 CHECK；重跑不变不刷新；人工/挂树列不被冲', async () => {
    await seedSentinel('led-a', { at: iso(5), ok: true });
    await seedSentinel('led-b', { at: iso(5), ok: false, error: 'x' });
    const jobs = [
      { name: 'led-a', cadence: { everySec: 300 } },
      { name: 'led-b', cadence: { cron: '30 8 * * *', tz: 'Asia/Shanghai' } },
    ];
    const r = await runSchedulerLiveness(client, { jobs, now: NOW, raise: vi.fn(), bark: vi.fn() });
    expect(r.ok).toBe(true);

    const a = await ledgerRow('led-a');
    expect(a).toMatchObject({
      kind: 'brain_job', schedule_desc: '每 5 分钟', interval_sec: 300, enabled: true, active: true,
      last_status: '正常', liveness: 'ok', registered_via: 'brain-job', ledger_status: 'registered',
    });
    expect(a.ops_workflow_id).not.toBeNull();
    expect(a.last_success_at).not.toBeNull();
    const b = await ledgerRow('led-b');
    expect(b).toMatchObject({ schedule_desc: 'cron(Asia/Shanghai): 30 8 * * *', interval_sec: 86400, last_status: '失败' });
    expect(b.last_success_at).toBeNull();

    // 人写了归属/备注，导入脚本挂了树：机器后续刷新一律不得冲掉
    const { rows: [vs] } = await client.query(`SELECT id FROM journeys WHERE status <> 'deleted' LIMIT 1`);
    await client.query(
      `UPDATE ops_schedule_entries SET owner_manual='alex', note_manual='人写', tree_bucket_manual='暂存', journey_id=$2
        WHERE id=$1`, [a.id, vs?.id ?? null]);
    // 无变化重跑：降噪生效，updated_at 不动
    await runSchedulerLiveness(client, { jobs, now: NOW + 5000, raise: vi.fn(), bark: vi.fn() });
    expect((await ledgerRow('led-a')).updated_at).toEqual(a.updated_at);
    // 有变化（周期改了）：行被刷新，但人工列/挂树列原样保留
    await runSchedulerLiveness(client, { jobs: [{ name: 'led-a', cadence: { everySec: 600 } }, jobs[1]], now: NOW + 10000, raise: vi.fn(), bark: vi.fn() });
    const a2 = await ledgerRow('led-a');
    expect(a2.interval_sec).toBe(600);
    expect(a2).toMatchObject({ owner_manual: 'alex', note_manual: '人写', tree_bucket_manual: '暂存' });
    expect(a2.journey_id).toBe(vs?.id ?? null);
  });

  it('下线的 job 置 inactive，不删行', async () => {
    await seedSentinel('led-gone', { at: iso(5), ok: true });
    await runSchedulerLiveness(client, { jobs: [{ name: 'led-gone', cadence: { everySec: 60 } }], now: NOW, raise: vi.fn(), bark: vi.fn() });
    expect((await ledgerRow('led-gone')).active).toBe(true);
    await runSchedulerLiveness(client, { jobs: [{ name: 'led-other', cadence: { everySec: 60 } }], now: NOW + 1000, raise: vi.fn(), bark: vi.fn() });
    expect((await ledgerRow('led-gone')).active).toBe(false);
  });

  it('recurring 模板落表；停用后行置 inactive', async () => {
    const { rows: [t] } = await client.query(
      `INSERT INTO recurring_tasks (title, task_type, cron_expression, is_active, last_run_at, last_run_status)
       VALUES ('ledger-it 日报', 'dev', '0 9 * * *', TRUE, NOW(), 'created') RETURNING id`);
    await syncRecurringLedger(client, new Date());
    const row = (await client.query(
      `SELECT * FROM ops_schedule_entries WHERE source='brain' AND host_alias='local' AND label='ledger-it 日报'`)).rows[0];
    expect(row).toMatchObject({ kind: 'brain_recurring', schedule_desc: '0 9 * * *', interval_sec: 86400, last_status: '正常', registered_via: 'recurring', active: true });
    expect(row.last_success_at).not.toBeNull();
    await client.query(`UPDATE recurring_tasks SET is_active=FALSE WHERE id=$1`, [t.id]);
    await syncRecurringLedger(client, new Date());
    const off = (await client.query(
      `SELECT active FROM ops_schedule_entries WHERE source='brain' AND host_alias='local' AND label='ledger-it 日报'`)).rows[0];
    expect(off.active).toBe(false);
  });

  it('盘点导入：补挂树只补空、快照行插入且幂等、/alarms 读得出来', async () => {
    const { rows: [vsRow] } = await client.query(
      `INSERT INTO journeys (name, journey_type) VALUES ('ledger-it 价值流', 'autonomous') RETURNING id`);
    const { rows: [capRow] } = await client.query(
      `INSERT INTO journeys (name, journey_type, parent_journey_id) VALUES ('ledger-it 价值流 · 清理', 'autonomous', $1) RETURNING id`, [vsRow.id]);
    const items = [
      { name: 'ledger-it-timer', host: 'nas', mech: 'synology-task', freq: '每天', en: '禁用', node: '无（历史残留）', last: '2026-09-01 10:00', ok: '无记录', st: '失败', note: '备注' },
    ];
    // 采集腿已有的 crontab/mmv 行：只补挂树、不插行
    await client.query(
      `INSERT INTO ops_schedule_entries (source, host_alias, label, kind, schedule_desc, active)
       VALUES ('crontab', 'mmv', 'ledger-it-job.sh @ 5 * * * *', 'crontab', 'cron(UTC): 5 * * * *', TRUE)`);
    items.push({ name: 'ledger-it-job.sh', host: 'MMV', mech: 'crontab', freq: '', en: '启用', node: '某部 / ledger-it 价值流 / 清理', last: '', ok: '', st: '', note: '' });

    const p = txPool(client);
    const dry = await importInventorySnapshot(p, items, { dryRun: true });
    expect(dry.dry_run).toBe(true);
    const before = (await client.query(`SELECT count(*)::int AS n FROM ops_schedule_entries WHERE source='inventory-20261004'`)).rows[0].n;
    const done = await importInventorySnapshot(p, items, { dryRun: false, now: new Date('2026-10-04T02:00:00Z') });
    expect(done.inserts).toBe(1);
    const snap = (await client.query(
      `SELECT * FROM ops_schedule_entries WHERE source='inventory-20261004' AND label='ledger-it-timer'`)).rows[0];
    expect(snap).toMatchObject({
      host_alias: 'nas', kind: 'synology-task', enabled: false, last_state: 'disabled', last_status: '失败',
      registered_via: 'external-legacy', ledger_status: 'registered', tree_bucket_manual: '无（历史残留）', journey_id: null,
    });
    expect(snap.last_run_at.toISOString()).toBe('2026-09-01T02:00:00.000Z');
    const mmv = (await client.query(
      `SELECT * FROM ops_schedule_entries WHERE source='crontab' AND host_alias='mmv' AND label='ledger-it-job.sh @ 5 * * * *'`)).rows[0];
    expect(mmv).toMatchObject({ journey_id: capRow.id, registered_via: 'external-legacy', ledger_status: 'registered' });

    // 幂等：再跑一次不增行；人手改过的挂树结论不被覆盖
    await client.query(`UPDATE ops_schedule_entries SET journey_id=NULL, tree_bucket_manual='人改' WHERE id=$1`, [snap.id]);
    await importInventorySnapshot(p, items, { dryRun: false });
    const after = (await client.query(`SELECT count(*)::int AS n FROM ops_schedule_entries WHERE source='inventory-20261004'`)).rows[0].n;
    expect(after).toBe(before + 1);
    const snap2 = (await client.query(`SELECT tree_bucket_manual FROM ops_schedule_entries WHERE id=$1`, [snap.id])).rows[0];
    expect(snap2.tree_bucket_manual).toBe('人改');

    // /alarms：能读出挂树路径、暂存文字、停用状态
    const payload = await buildAlarmsPayload(client, new Date());
    const mine = payload.alarms.find((a) => a.name === 'ledger-it-job.sh @ 5 * * * *');
    expect(mine.tree).toMatchObject({ value_stream: 'ledger-it 价值流', capability: '清理' });
    const nas = payload.alarms.find((a) => a.name === 'ledger-it-timer');
    expect(nas).toMatchObject({ enabled: false, last_status: '失败', mechanism: 'synology-task', machine: 'nas' });
    expect(nas.tree.path).toBe('人改');
  });

  it('CHECK 约束：非法的 last_status / ledger_status / registered_via 写不进（防口径漂移）', async () => {
    const bad = (cols, vals) => client.query('SAVEPOINT s').then(() => client.query(
      `INSERT INTO ops_schedule_entries (source, host_alias, label, kind, ${cols}) VALUES ('t','h',$1,'k',${vals})`,
      [`chk-${Math.random()}`])).then(() => 'ok', async (e) => { await client.query('ROLLBACK TO s'); return e.code; });
    expect(await bad('last_status', "'乱写'")).toBe('23514');
    expect(await bad('ledger_status', "'maybe'")).toBe('23514');
    expect(await bad('registered_via', "'cron-by-hand'")).toBe('23514');
    expect(await bad('last_status', "'正常'")).toBe('ok');
  });
});
