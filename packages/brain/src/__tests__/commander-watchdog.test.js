/** 心跳与趋势保留；失联巡检不得复活旧执行器。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recordCommanderHeartbeat,
  runCommanderWatchdog,
  runWorkflowTrendBark,
  DEFAULT_HEARTBEAT_STALE_MS,
} from '../commander-watchdog.js';

function makePool(handlers) {
  const calls = [];
  const query = vi.fn(async (sql, params) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    for (const [re, fn] of handlers) {
      if (re.test(text)) return typeof fn === 'function' ? fn(text, params) : fn;
    }
    return { rows: [] };
  });
  return { query, calls };
}

const RUN = {
  id: 'task-run-1', task_type: 'device_job', title: '获客采收·AI训练师 · 4137 · 02:00 · abc',
  payload: { serial: 'ANGYVB4402004137', source: 'cron', tag: 'cmd09300200', host: 'xian-m4', profile: 'legacy', escort_id: 'old-escort-id-0000' },
};

describe('recordCommanderHeartbeat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('按 payload.tag 命中在途 run → 写 commander_heartbeat_at 并把 escort_id/host/serial 并进 payload', async () => {
    const pool = makePool([
      [/payload->>'tag' = \$1/, { rows: [{ id: 'task-run-1', payload: RUN.payload }] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const out = await recordCommanderHeartbeat(pool, { tag: 'cmd09300200', host: 'xian-m4', serial: 'ANGYVB4402004137', escort_id: 'esc-new-1', escort_name: 'escort-xian-m4-cmd09300200' }, { now: Date.parse('2026-09-30T03:00:00Z') });
    expect(out).toMatchObject({ matched: true, task_id: 'task-run-1', via: 'tag' });
    const upd = pool.calls.find((c) => /UPDATE tasks/.test(c.sql));
    expect(upd.sql).toMatch(/status = 'in_progress'/);
    const merged = JSON.parse(upd.params[1]);
    expect(merged).toMatchObject({ commander_heartbeat_at: '2026-09-30T03:00:00.000Z', escort_id: 'esc-new-1', host: 'xian-m4', tag: 'cmd09300200', escort_name: 'escort-xian-m4-cmd09300200' });
  });

  it('tag 没命中 → 按账本 run_id（task_runs LIKE %-<TAG>__%）→ 再按 serial 唯一在途镜像单', async () => {
    const pool = makePool([
      [/payload->>'tag' = \$1/, { rows: [] }],
      [/JOIN task_runs/, (sql, params) => { expect(params[0]).toBe('%-cmd09300200\\_\\_%'); return { rows: [] }; }],
      [/payload->>'serial' = \$1/, { rows: [{ id: 'task-by-serial', payload: { serial: 'ANGYVB4402004137', source: 'cron' } }] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const out = await recordCommanderHeartbeat(pool, { tag: 'cmd09300200', serial: 'ANGYVB4402004137', host: 'xian-m4' });
    expect(out).toMatchObject({ matched: true, task_id: 'task-by-serial', via: 'serial' });
  });

  it('kind=launch（wf-launch 起跑时 Brain 单还没建）→ 存 working_memory commander_launch:<TAG>，不报错', async () => {
    const pool = makePool([
      [/payload->>'tag' = \$1/, { rows: [] }],
      [/INSERT INTO working_memory/, { rows: [] }],
    ]);
    const out = await recordCommanderHeartbeat(pool, { kind: 'launch', tag: 'cmd09300200', host: 'xian-m4', serial: 'ANGYVB4402004137', escort_id: 'esc-launch-1' });
    expect(out).toMatchObject({ matched: false, stored: 'launch' });
    const wm = pool.calls.find((c) => /INSERT INTO working_memory/.test(c.sql));
    expect(wm.params[0]).toBe('commander_launch:cmd09300200');
    expect(JSON.parse(wm.params[1])).toMatchObject({ escort_id: 'esc-launch-1', host: 'xian-m4' });
  });

  it('tag 非法 / 缺 tag 与 serial → 拒绝', async () => {
    const pool = makePool([]);
    await expect(recordCommanderHeartbeat(pool, { tag: 'bad tag; rm' })).rejects.toThrow(/tag/);
    await expect(recordCommanderHeartbeat(pool, {})).rejects.toThrow(/tag|serial/);
  });
});

describe('runCommanderWatchdog', () => {
  beforeEach(() => vi.clearAllMocks());

  // 桩按远端命令分流：cron list --json 回 listJobs（默认空表），其余回 reply
  function sshStub(reply = '{"id": "esc-relaunched-1111"}', listJobs = []) {
    const seen = [];
    const fn = vi.fn((cmd, args, opts, cb) => {
      const remote = args[args.length - 1];
      seen.push({ target: args[args.length - 2], remote });
      if (/cron list --json/.test(remote)) return cb(null, JSON.stringify({ jobs: listJobs }), '');
      cb(null, reply, '');
    });
    return { fn, seen };
  }

  it('旧 run 心跳过期只告警，不再查询、收养或启动 OpenClaw cron', async () => {
    const pool = makePool([
      [/FROM tasks[\s\S]*commander_heartbeat_at/, { rows: [RUN] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const ssh = sshStub();
    const bark = vi.fn().mockResolvedValue(true);
    const result = await runCommanderWatchdog(pool, { execFileFn: ssh.fn, bark, gateMs: 0 });
    expect(ssh.fn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, relaunched: 0, adopted: 0, barked: 1, failed: 0 });
    expect(bark).toHaveBeenCalledTimes(1);
    expect(bark.mock.calls[0][1]).toContain('cmd09300200');
  });

  it('巡检不伪造心跳、接班时间或escort身份，成功告警只记去重时间', async () => {
    const stale = { ...RUN, payload: { ...RUN.payload, commander_relaunch_count: 2 } };
    const pool = makePool([
      [/FROM tasks[\s\S]*commander_heartbeat_at/, { rows: [stale] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const now = Date.parse('2026-11-20T02:00:00Z');
    await runCommanderWatchdog(pool, { execFileFn: sshStub().fn, bark: vi.fn().mockResolvedValue(true), gateMs: 0, now });
    const updates = pool.calls.filter(call => /UPDATE tasks/.test(call.sql)).map(call => JSON.parse(call.params[1]));
    expect(updates).toEqual([{ commander_bark_at: new Date(now).toISOString() }]);
    expect(pool.calls.find(call => /INSERT INTO task_events/.test(call.sql)).params[1]).toBe('commander_heartbeat_stale');
  });

  it.each(['false', 'error'])('Bark未发送成功（%s）不记已告警、心跳或接班成功', async kind => {
    const stale = { ...RUN, payload: { ...RUN.payload, commander_relaunch_count: 2 } };
    const pool = makePool([
      [/FROM tasks[\s\S]*commander_heartbeat_at/, { rows: [stale] }],
      [/UPDATE tasks/, (sql, params) => ({ rows: [{ id: params[0] }], rowCount: 1 })],
    ]);
    const bark = kind === 'false' ? vi.fn().mockResolvedValue(false) : vi.fn().mockRejectedValue(new Error('owned notification failed'));
    const result = await runCommanderWatchdog(pool, { execFileFn: sshStub().fn, bark, gateMs: 0 });
    expect(result).toMatchObject({ relaunched: 0, adopted: 0, barked: 0, failed: 1 });
    expect(pool.calls.some(call => /UPDATE tasks/.test(call.sql))).toBe(false);
  });

  it('巡检扫描只认真实心跳和已告警标记，不让历史接班时间冒充心跳', async () => {
    const pool = makePool([[/FROM tasks[\s\S]*commander_heartbeat_at/, (sql, params) => {
      expect(sql).toMatch(/COALESCE\(started_at, due_at, created_at\) < NOW\(\)/);
      expect(sql).not.toMatch(/commander_relaunched_at|commander_relaunch_count/);
      expect(sql).toMatch(/commander_bark_at/);
      expect(params).toEqual([DEFAULT_HEARTBEAT_STALE_MS]);
      return { rows: [] };
    }]]);
    expect(await runCommanderWatchdog(pool, { gateMs: 0 })).toMatchObject({ scanned: 0, relaunched: 0 });
  });

  it('全局巡检节流仍生效，窗口内不再读库或通知', async () => {
    const pool = makePool([]);
    const bark = vi.fn();
    const now = Date.parse('2026-11-20T08:00:00Z');
    await runCommanderWatchdog(pool, { bark, gateMs: 0, now });
    const calls = pool.calls.length;
    expect(await runCommanderWatchdog(pool, { bark, gateMs: 300000, now: now + 1000 })).toMatchObject({ skipped_reason: 'interval_gate' });
    expect(pool.calls).toHaveLength(calls);
    expect(bark).not.toHaveBeenCalled();
  });
});

describe('runWorkflowTrendBark', () => {
  beforeEach(() => vi.clearAllMocks());
  // 北京 2026-09-30 09:05 = UTC 01:05
  const NOW = Date.parse('2026-09-30T01:05:00Z');

  it('同一 wf 连续 2 个自然日（北京）零线索 → Bark 一次；有线索的不叫；只在北京 08:30–10:00 窗口跑且当日去重', async () => {
    const trend = [
      { label: 'social-keyword-leadgen', day: '2026-09-29', runs: '3', leads: '0' },
      { label: 'social-keyword-leadgen', day: '2026-09-28', runs: '2', leads: '0' },
      { label: 'benchmark-leadgen', day: '2026-09-29', runs: '1', leads: '0' },
      { label: 'benchmark-leadgen', day: '2026-09-28', runs: '1', leads: '4' },
      { label: 'moments-repost', day: '2026-09-29', runs: '1', leads: '0' },
    ];
    const pool = makePool([
      [/Asia\/Shanghai/, (sql) => { expect(sql).toMatch(/::timestamptz AT TIME ZONE 'Asia\/Shanghai'/); return { rows: trend }; }],
      [/FROM phone_registry/, { rows: [] }],
      [/FROM working_memory/, { rows: [] }],
      [/INSERT INTO working_memory/, { rows: [] }],
    ]);
    const bark = vi.fn().mockResolvedValue(true);
    const out = await runWorkflowTrendBark(pool, { bark, now: NOW });
    expect(out.zeroLeads).toEqual(['social-keyword-leadgen']);
    expect(bark).toHaveBeenCalledTimes(1);
    expect(bark.mock.calls[0][1]).toMatch(/social-keyword-leadgen/);
    expect(bark.mock.calls[0][1]).not.toMatch(/benchmark-leadgen/);
    const wm = pool.calls.find((c) => /INSERT INTO working_memory/.test(c.sql));
    expect(wm.params[0]).toBe('workflow_trend_bark:last_day');
    expect(wm.params[1]).toContain('2026-09-30');
    // 窗口外不跑
    const out2 = await runWorkflowTrendBark(makePool([]), { bark: vi.fn(), now: Date.parse('2026-09-30T05:00:00Z') });
    expect(out2.skipped).toBe('outside_window');
    // 当日已发不重复
    const pool3 = makePool([[/FROM working_memory/, { rows: [{ value_json: { day: '2026-09-30' } }] }]]);
    const out3 = await runWorkflowTrendBark(pool3, { bark: vi.fn(), now: NOW });
    expect(out3.skipped).toBe('already_today');
  });

  it('一台 serial 近 72h 有批但 24h 无 completed → Bark 点名昵称；无批的闲置手机不叫', async () => {
    const pool = makePool([
      [/Asia\/Shanghai/, { rows: [] }],
      [/FROM phone_registry/, (sql) => { expect(sql).toMatch(/interval '72 hours'/); return { rows: [
        { serial: 'ANGYVB4402004137', nickname: '小黄', recent_runs: '4', last_ok: null },
        { serial: 'e6c7ef34', nickname: '小白', recent_runs: '0', last_ok: null },
        { serial: 'ANGYVB4227006983', nickname: '小蓝', recent_runs: '3', last_ok: '2026-09-29T20:00:00Z' },
      ] }; }],
      [/FROM working_memory/, { rows: [] }],
      [/INSERT INTO working_memory/, { rows: [] }],
    ]);
    const bark = vi.fn().mockResolvedValue(true);
    const out = await runWorkflowTrendBark(pool, { bark, now: NOW, staleSerialMs: 24 * 3600e3 });
    expect(out.staleSerials).toEqual(['ANGYVB4402004137']);
    expect(bark).toHaveBeenCalledTimes(1);
    expect(bark.mock.calls[0][1]).toMatch(/小黄/);
    expect(bark.mock.calls[0][1]).not.toMatch(/小白|小蓝/);
  });
});
