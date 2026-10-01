/**
 * commander-watchdog.pg.integration.test.js — 真实 pg 只钉 SQL（任务 17ea4536）。
 *
 * fakePool 验不出：payload 里 ISO 心跳串 ::timestamptz 的比较、LIKE ESCAPE 的账本 run_id 匹配、
 * `::timestamptz AT TIME ZONE 'Asia/Shanghai'` 的自然日分组、working_memory upsert。ssh/Bark 仍是桩。
 * 门控：连不上 PG 整体 skip；每用例 BEGIN/ROLLBACK。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { recordCommanderHeartbeat, runCommanderWatchdog, runWorkflowTrendBark } from '../commander-watchdog.js';

let DB_AVAILABLE = false;
{
  let probePool;
  try {
    probePool = new pg.Pool({ ...DB_DEFAULTS, max: 1, connectionTimeoutMillis: 2000 });
    await probePool.query('SELECT 1');
    DB_AVAILABLE = true;
  } catch {
    DB_AVAILABLE = false;
  } finally {
    if (probePool) await probePool.end().catch(() => {});
  }
}

describe.skipIf(!DB_AVAILABLE)('commander-watchdog — pg 集成（真实 SQL，不 mock pg）', () => {
  let pool;
  let client;
  let seq = 0;

  beforeAll(async () => { pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { client = await pool.connect(); await client.query('BEGIN'); });
  afterEach(async () => { await client.query('ROLLBACK'); client.release(); });

  async function insertRun({ payload, dueAgo = '30 minutes', status = 'in_progress', completedAgo = null, title = null }) {
    seq += 1;
    const { rows } = await client.query(
      `INSERT INTO tasks (title, task_type, status, priority, payload, due_at, created_at, completed_at)
       VALUES ($1, 'device_job', $2, 'P2', $3::jsonb, NOW() - $4::interval, NOW() - $4::interval,
               CASE WHEN $5::text IS NULL THEN NULL ELSE NOW() - $5::interval END) RETURNING id`,
      [title ?? `cmdr-it-${seq}-${Date.now()}`, status, JSON.stringify(payload), dueAgo, completedAgo],
    );
    return rows[0].id;
  }
  const ssh = () => vi.fn((c, a, o, cb) => cb(null, '{"id": "esc-it-0001"}', ''));

  it('心跳：tag 命中写 payload；账本 run_id LIKE %-<TAG>__% 命中；serial 唯一命中；起跑登记落 working_memory 后被心跳合并', async () => {
    const byTag = await insertRun({ payload: { serial: 'S-TAG', source: 'cron', tag: 'cmd09300201' } });
    const byLedger = await insertRun({ payload: { serial: 'S-LED', source: 'cron' } });
    await client.query(`INSERT INTO task_runs (task_id, run_id, status) VALUES ($1, $2, 'running')`, [byLedger, 'social-keyword-leadgen-crontab-cmd09300202__a1.discovery']);
    const bySerial = await insertRun({ payload: { serial: 'S-ONLY', source: 'cron' } });

    expect(await recordCommanderHeartbeat(client, { tag: 'cmd09300201', host: 'xian-m4', escort_id: 'e-tag' })).toMatchObject({ matched: true, task_id: byTag, via: 'tag' });
    expect(await recordCommanderHeartbeat(client, { tag: 'cmd09300202', host: 'xian-m4' })).toMatchObject({ matched: true, task_id: byLedger, via: 'ledger' });
    expect(await recordCommanderHeartbeat(client, { tag: 'cmd09300299', serial: 'S-ONLY' })).toMatchObject({ matched: true, task_id: bySerial, via: 'serial' });
    // 起跑登记（单还没建）→ working_memory；随后单建出来、心跳来了 → escort_id 从登记合并
    expect(await recordCommanderHeartbeat(client, { kind: 'launch', tag: 'cmd09300300', host: 'xian-m1', escort_id: 'e-launch' })).toMatchObject({ matched: false, stored: 'launch' });
    const late = await insertRun({ payload: { serial: 'S-LATE', source: 'cron', tag: 'cmd09300300' } });
    await recordCommanderHeartbeat(client, { tag: 'cmd09300300' });
    const { rows } = await client.query(`SELECT payload FROM tasks WHERE id = ANY($1::uuid[])`, [[byTag, late]]);
    const p = Object.fromEntries(rows.map((r) => [r.payload.serial, r.payload]));
    expect(p['S-TAG']).toMatchObject({ escort_id: 'e-tag', host: 'xian-m4' });
    expect(p['S-TAG'].commander_heartbeat_at).toBeTruthy();
    expect(p['S-LATE']).toMatchObject({ escort_id: 'e-launch', host: 'xian-m1' });
  });

  it('看门狗 SQL：起跑 30min 心跳 20min 前 → 拉；心跳 5min 前不拉；刚起跑 5min 不拉；已 Bark 不拉；接班 3 次不拉', async () => {
    const stale = await insertRun({ payload: { serial: 'S1', source: 'cron', tag: 'cmdA', host: 'xian-m4', profile: 'p', commander_heartbeat_at: new Date(Date.now() - 20 * 60e3).toISOString() } });
    const fresh = await insertRun({ payload: { serial: 'S2', source: 'cron', tag: 'cmdB', host: 'xian-m4', profile: 'p', commander_heartbeat_at: new Date(Date.now() - 5 * 60e3).toISOString() } });
    const young = await insertRun({ payload: { serial: 'S3', source: 'cron', tag: 'cmdC', host: 'xian-m4', profile: 'p' }, dueAgo: '5 minutes' });
    const barked = await insertRun({ payload: { serial: 'S4', source: 'cron', tag: 'cmdD', host: 'xian-m4', profile: 'p', commander_relaunch_count: 3, commander_bark_at: new Date().toISOString() } });
    const never = await insertRun({ payload: { serial: 'S5', source: 'cron', tag: 'cmdE', host: 'xian-m4', profile: 'p' } });
    const execFileFn = ssh();
    const bark = vi.fn().mockResolvedValue(true);
    const out = await runCommanderWatchdog(client, { execFileFn, bark, gateMs: 0 });
    expect(out.relaunched).toBe(2);
    const { rows } = await client.query(`SELECT id, payload FROM tasks WHERE id = ANY($1::uuid[])`, [[stale, fresh, young, barked, never]]);
    const p = Object.fromEntries(rows.map((r) => [r.id, r.payload]));
    expect(p[stale]).toMatchObject({ escort_id: 'esc-it-0001', commander_relaunch_count: 1 });
    expect(p[never]).toMatchObject({ escort_id: 'esc-it-0001', commander_relaunch_count: 1 });
    expect(p[fresh].escort_id).toBeUndefined();
    expect(p[young].escort_id).toBeUndefined();
    expect(p[barked].commander_relaunch_count).toBe(3);
    const ev = await client.query(`SELECT event_type FROM task_events WHERE task_id = ANY($1::uuid[])`, [[stale, never]]);
    expect(ev.rows.map((r) => r.event_type)).toEqual(['commander_relaunched', 'commander_relaunched']);
    expect(bark).not.toHaveBeenCalled();
    // 刚接班的（commander_relaunched_at 新）下一轮不再拉
    const again = await runCommanderWatchdog(client, { execFileFn: ssh(), bark, gateMs: 0 });
    expect(again.relaunched).toBe(0);
  });

  it('趋势 SQL：按北京自然日分组，连续两天零线索的 wf 叫、有线索的不叫；phone_registry 24h 无 completed 叫', async () => {
    // 当日去重状态在事务内隔离；ROLLBACK 恢复已有测试库记录。
    await client.query(`DELETE FROM working_memory WHERE key = 'workflow_trend_bark:last_day'`);
    await client.query(`INSERT INTO phone_registry (serial, nickname, host, profile, enabled) VALUES ('S-STALE', '小测', 'xian-m4', 'p', true), ('S-IDLE', '小闲', 'xian-m4', 'p', true)`);
    // 落点钉在北京 D-1 / D-2 的中午 12:00（按当前北京时刻反算小时数），不受用例运行时刻影响
    const bj = new Date(Date.now() + 8 * 3600e3);
    const minsToday = bj.getUTCHours() * 60 + bj.getUTCMinutes();
    const d1 = `${((minsToday + 24 * 60 - 12 * 60) / 60).toFixed(2)} hours`;
    const d2 = `${((minsToday + 48 * 60 - 12 * 60) / 60).toFixed(2)} hours`;
    const mk = (wf, ago, leads, serial = 'S-STALE') => insertRun({ payload: { serial, source: 'cron', wf_id: wf, leads }, status: 'completed', dueAgo: ago, completedAgo: ago });
    await mk('zero-wf', d1, 0); await mk('zero-wf', d2, 0);
    await mk('ok-wf', d1, 0); await mk('ok-wf', d2, 3);
    const bark = vi.fn().mockResolvedValue(true);
    // 用当前时刻（北京日期由 SQL 与 JS 同算）但强制窗口
    const out = await runWorkflowTrendBark(client, { bark, windowOverride: true, staleSerialMs: 24 * 3600e3 });
    expect(out.zeroLeads).toEqual(['zero-wf']);
    expect(out.staleSerials).toEqual(['S-STALE']);
    expect(bark).toHaveBeenCalledTimes(2);
    const wm = await client.query(`SELECT value_json FROM working_memory WHERE key = 'workflow_trend_bark:last_day'`);
    expect(wm.rows[0].value_json.day).toBe(out.day);
    expect(await runWorkflowTrendBark(client, { bark, windowOverride: true })).toMatchObject({ skipped: 'already_today' });
  });
});
