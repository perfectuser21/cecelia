/**
 * 旁路报警（派发总闸 H，Brain 任务 865b502c）——纯逻辑单测，不碰真库、不执行 ssh、不发 Bark。
 * 目标：活不经过 Brain 就动手机或对外发东西 → 留「旁路动作」事件；正常 Brain 派发的 run 不误报。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeRunId,
  findLinkedTask,
  recordBypassAction,
  parseOpenclawSession,
  buildOpenclawPushSql,
  runOpenclawPushScan,
  shanghaiDay,
  runBypassDailyRollup,
  summarizeBypass,
  noteDeviceLockAcquire,
  runBypassAudit,
  BYPASS_EVENT_TYPE,
  _resetBypassAuditGates,
} from '../bypass-audit.js';

const TASK_UUID = '865b502c-ea72-45e6-b00f-d60fe8c922f2';

/** 假 pool：按 SQL 关键字路由返回值，记录所有调用 */
function makePool(handlers = {}) {
  const calls = [];
  const query = vi.fn(async (sql, params) => {
    calls.push({ sql, params });
    for (const [key, fn] of Object.entries(handlers)) {
      if (sql.includes(key)) return typeof fn === 'function' ? fn(sql, params) : fn;
    }
    return { rows: [], rowCount: 0 };
  });
  return { query, calls };
}

beforeEach(() => _resetBypassAuditGates());

describe('normalizeRunId（与执行机 douyin-phone-adb normalize_run_id 同口径）', () => {
  it('剥 execution_id 的 :aN、阶段后缀 -aN-<阶段>-<次数>、批次词序 -wN', () => {
    expect(normalizeRunId('qiumi-865b502c-1791400000000:a1')).toBe('qiumi-865b502c-1791400000000');
    expect(normalizeRunId('social-keyword-leadgen-20261012-t1-a2-discovery-1')).toBe('social-keyword-leadgen-20261012-t1');
    expect(normalizeRunId('auto10081559-w3')).toBe('auto10081559');
    expect(normalizeRunId('  ')).toBe('');
    expect(normalizeRunId(null)).toBe('');
  });
});

describe('findLinkedTask：持有者/run 能否追到 Brain 任务', () => {
  it('uuid 持有者 / payload.run_id / qiumi|wfd run 前缀 三路都进同一条查询', async () => {
    const pool = makePool({ 'FROM tasks': { rows: [{ id: TASK_UUID, status: 'in_progress' }] } });
    const r = await findLinkedTask(pool, { owner: 'qiumi-865b502c-1791400000000:a1', taskId: TASK_UUID });
    expect(r).toEqual({ id: TASK_UUID, status: 'in_progress' });
    const { sql, params } = pool.calls[0];
    expect(sql).toMatch(/id::text = ANY\(\$1\)/);
    expect(sql).toMatch(/payload->>'run_id' = ANY\(\$2\)/);
    expect(sql).toMatch(/LIKE ANY\(\$3\)/);
    expect(params[0]).toEqual([TASK_UUID]);
    expect(params[1]).toContain('qiumi-865b502c-1791400000000');
    expect(params[2]).toEqual(['865b502c%']);
  });

  it('什么线索都没有 → 不查库直接判未关联', async () => {
    const pool = makePool();
    expect(await findLinkedTask(pool, { owner: '', taskId: null, runId: undefined })).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('非 uuid 的 task_id 不进 uuid 数组（防 id::text 比对被乱串放大）', async () => {
    const pool = makePool();
    await findLinkedTask(pool, { taskId: 'not-a-uuid', owner: 'outreach-tick:xian-m4:20261012T010000:123' });
    expect(pool.calls[0].params[0]).toEqual([]);
    expect(pool.calls[0].params[2]).toEqual([]);
  });
});

describe('recordBypassAction：只记旁路，Brain 派发的不误报', () => {
  it('能追到 Brain 任务 → bypass:false，不写事件', async () => {
    const pool = makePool({ 'FROM tasks': { rows: [{ id: TASK_UUID, status: 'in_progress' }] } });
    const r = await recordBypassAction(pool, { kind: 'phone_lock', owner: TASK_UUID, device: 'S1', source: 'device-lock-api' });
    expect(r).toEqual({ bypass: false, linked_task_id: TASK_UUID });
    expect(pool.calls.some((c) => c.sql.includes('INSERT INTO cecelia_events'))).toBe(false);
  });

  it('追不到 → 写 cecelia_events(event_type=bypass_action, source=kind)，payload 带 owner/设备/来源', async () => {
    const pool = makePool({ 'INSERT INTO cecelia_events': { rows: [{ id: 42 }], rowCount: 1 } });
    const r = await recordBypassAction(pool, {
      kind: 'phone_lock', owner: 'outreach-tick:xian-m4:20261012T010000:123', device: 'S1',
      host: 'xian-m4', source: 'device-lock-api', action: 'lock-acquire',
    });
    expect(r).toMatchObject({ bypass: true, recorded: true, event_id: 42 });
    const ins = pool.calls.find((c) => c.sql.includes('INSERT INTO cecelia_events'));
    expect(ins.params[0]).toBe(BYPASS_EVENT_TYPE);
    expect(ins.params[1]).toBe('phone_lock');
    const payload = JSON.parse(ins.params[2]);
    expect(payload).toMatchObject({ kind: 'phone_lock', owner: 'outreach-tick:xian-m4:20261012T010000:123', device: 'S1', host: 'xian-m4', source: 'device-lock-api' });
  });

  it('同 dedupe_key 已有事件 → 不重复写（锁心跳续租不刷屏）', async () => {
    const pool = makePool({ "payload->>'dedupe_key'": { rows: [{ id: 7 }] } });
    const r = await recordBypassAction(pool, { kind: 'phone_lock', owner: 'x', device: 'S1', dedupe_key: 'lock:S1:x' });
    expect(r).toMatchObject({ bypass: true, recorded: false, deduped: true });
    expect(pool.calls.some((c) => c.sql.includes('INSERT INTO cecelia_events'))).toBe(false);
  });

  it('未知 kind → 抛 invalid_kind（只覆盖手机动作和 OpenClaw 对外推送）', async () => {
    await expect(recordBypassAction(makePool(), { kind: 'email_push', owner: 'x' })).rejects.toThrow(/invalid_kind/);
  });
});

describe('OpenClaw 对外推送扫描', () => {
  it('parseOpenclawSession：Brain 派发会话 agent:<dept>:<run_id>；main 主会话=与主理人对话不算；cron 会话照记', () => {
    expect(parseOpenclawSession('agent:media:qiumi-865b502c-1791400000000')).toEqual({ agent: 'media', sessionId: 'qiumi-865b502c-1791400000000', conversation: false });
    expect(parseOpenclawSession('agent:main:main')).toMatchObject({ conversation: true });
    expect(parseOpenclawSession('agent:foundry:cron:f44680ed:run:')).toEqual({ agent: 'foundry', sessionId: 'cron:f44680ed:run:', conversation: false });
    expect(parseOpenclawSession('garbage')).toBeNull();
  });

  it('buildOpenclawPushSql：只读 message 工具的 started 事件，数字内插只收整数', () => {
    const sql = buildOpenclawPushSql({ sinceMs: 1791400000000 });
    expect(sql).toContain("tool_name='message'");
    expect(sql).toContain("action='tool.action.started'");
    expect(sql).toContain('occurred_at >= 1791400000000');
    expect(() => buildOpenclawPushSql({ sinceMs: '1 OR 1=1' })).toThrow();
  });

  it('runOpenclawPushScan：cron 会话记旁路，Brain 派发会话不记，主会话跳过；按 tool_call_id 去重', async () => {
    const rows = [
      { occurred_at: 1791400001000, agent_id: 'foundry', session_key: 'agent:foundry:cron:f44680ed:run:', tool_call_id: 'tc-1', run_id: 'r1', status: 'started' },
      { occurred_at: 1791400002000, agent_id: 'media', session_key: 'agent:media:qiumi-865b502c-1791400000000', tool_call_id: 'tc-2', run_id: 'r2', status: 'started' },
      { occurred_at: 1791400003000, agent_id: 'main', session_key: 'agent:main:main', tool_call_id: 'tc-3', run_id: 'r3', status: 'started' },
    ];
    const pool = makePool({
      'FROM tasks': (_sql, params) => (params[1].includes('qiumi-865b502c-1791400000000')
        ? { rows: [{ id: TASK_UUID, status: 'completed' }] } : { rows: [] }),
      'INSERT INTO cecelia_events': { rows: [{ id: 1 }], rowCount: 1 },
    });
    const exec = vi.fn().mockResolvedValue(JSON.stringify(rows));
    const r = await runOpenclawPushScan(pool, { exec, inContainer: false, now: () => 1791400100000 });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toContain('ssh');
    expect(r).toMatchObject({ fetched: 3, recorded: 1, linked: 1, conversation: 1 });
    const ins = pool.calls.filter((c) => c.sql.includes('INSERT INTO cecelia_events'));
    expect(ins).toHaveLength(1);
    expect(JSON.parse(ins[0].params[2])).toMatchObject({ kind: 'openclaw_push', dedupe_key: 'openclaw:tc-1', source: 'openclaw-audit', action: 'message' });
  });

  it('自 gate：5 分钟内第二次调用直接 skipped，不发 ssh', async () => {
    const exec = vi.fn().mockResolvedValue('');
    const pool = makePool();
    await runOpenclawPushScan(pool, { exec, inContainer: false, now: () => 1791400100000 });
    const r2 = await runOpenclawPushScan(pool, { exec, inContainer: false, now: () => 1791400160000 });
    expect(r2).toEqual({ skipped: true });
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

describe('按天汇总 + 阈值 Bark（决策 d3e7746c：系统类不推主理人，对外/动真人才 Bark）', () => {
  const NOW = Date.parse('2026-10-12T04:00:00Z'); // 上海 12:00

  it('shanghaiDay：按上海日历日切', () => {
    expect(shanghaiDay(Date.parse('2026-10-11T16:30:00Z'))).toBe('2026-10-12');
    expect(shanghaiDay(Date.parse('2026-10-11T15:30:00Z'))).toBe('2026-10-11');
  });

  function rollupPool(counts) {
    return makePool({
      'GROUP BY source': { rows: Object.entries(counts).map(([kind, n]) => ({ kind, n })) },
      'INSERT INTO runs': { rows: [], rowCount: 1 },
    });
  }

  it('有旁路 → runs 记一行 bypass-audit:<日期> outcome=fail（进 Notion「最近执行」现有投影）', async () => {
    const pool = rollupPool({ phone_lock: 3 });
    const sendBark = vi.fn();
    const r = await runBypassDailyRollup(pool, { now: () => NOW, sendBark });
    const ins = pool.calls.find((c) => c.sql.includes('INSERT INTO runs'));
    expect(ins.params[0]).toBe('bypass-audit:2026-10-12');
    expect(ins.params).toContain('fail');
    expect(r.counts).toEqual({ phone_lock: 3, phone_outward: 0, openclaw_push: 0 });
    // 只有领锁（系统类）→ 不推主理人
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('零旁路 → outcome=pass，不 Bark', async () => {
    const pool = rollupPool({});
    const sendBark = vi.fn();
    await runBypassDailyRollup(pool, { now: () => NOW, sendBark });
    const ins = pool.calls.find((c) => c.sql.includes('INSERT INTO runs'));
    expect(ins.params).toContain('pass');
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('手机对外动作旁路达阈值（默认 1）→ Bark 一次，dedupeKey 按 日期+类型', async () => {
    const pool = rollupPool({ phone_outward: 2, phone_lock: 5 });
    const sendBark = vi.fn().mockResolvedValue(true);
    await runBypassDailyRollup(pool, { now: () => NOW, sendBark });
    expect(sendBark).toHaveBeenCalledTimes(1);
    const [title, body, opts] = sendBark.mock.calls[0];
    expect(title).toMatch(/旁路/);
    expect(body).toMatch(/2/);
    expect(opts.dedupeKey).toBe('bypass-alert:2026-10-12:phone_outward');
  });

  it('OpenClaw 对外推送未达阈值（默认 5）不 Bark，达到才 Bark', async () => {
    const sendBark = vi.fn().mockResolvedValue(true);
    await runBypassDailyRollup(rollupPool({ openclaw_push: 4 }), { now: () => NOW, sendBark });
    expect(sendBark).not.toHaveBeenCalled();
    _resetBypassAuditGates();
    await runBypassDailyRollup(rollupPool({ openclaw_push: 5 }), { now: () => NOW, sendBark });
    expect(sendBark).toHaveBeenCalledTimes(1);
    expect(sendBark.mock.calls[0][2].dedupeKey).toBe('bypass-alert:2026-10-12:openclaw_push');
  });

  it('Bark 发送失败不影响汇总落库', async () => {
    const pool = rollupPool({ phone_outward: 1 });
    const sendBark = vi.fn().mockRejectedValue(new Error('bark down'));
    const r = await runBypassDailyRollup(pool, { now: () => NOW, sendBark });
    expect(r.counts.phone_outward).toBe(1);
    expect(pool.calls.some((c) => c.sql.includes('INSERT INTO runs'))).toBe(true);
  });
});

describe('summarizeBypass（运维视图）', () => {
  it('按上海日 × 类型聚合，days 夹在 1..30', async () => {
    const pool = makePool({ 'FROM cecelia_events': { rows: [{ day: '2026-10-12', kind: 'phone_lock', n: 2, owners: ['a'] }] } });
    const r = await summarizeBypass(pool, { days: 999 });
    expect(r.days).toBe(30);
    expect(r.rows[0]).toMatchObject({ day: '2026-10-12', kind: 'phone_lock', n: 2 });
    expect(pool.calls[0].params[0]).toBe(BYPASS_EVENT_TYPE);
    expect(pool.calls[0].params[1]).toBe(30);
  });
});

describe('接线入口', () => {
  it('noteDeviceLockAcquire：按 设备+持有者 去重、来源 device-lock-api', async () => {
    const pool = makePool({ 'INSERT INTO cecelia_events': { rows: [{ id: 5 }], rowCount: 1 } });
    const r = await noteDeviceLockAcquire(pool, { device: 'S9', owner: 'harvest-fallback:xian-m4:1:2', host: 'xian-m4' });
    expect(r.recorded).toBe(true);
    const payload = JSON.parse(pool.calls.find((c) => c.sql.includes('INSERT INTO cecelia_events')).params[2]);
    expect(payload).toMatchObject({ kind: 'phone_lock', source: 'device-lock-api', action: 'lock-acquire', dedupe_key: 'lock:S9:harvest-fallback:xian-m4:1:2' });
  });

  it('runBypassAudit：扫描失败不挡汇总，本轮 ok:false 让调度器记 fail', async () => {
    const pool = makePool({ 'INSERT INTO runs': { rows: [], rowCount: 1 } });
    const exec = vi.fn().mockRejectedValue(new Error('ssh: connect timeout'));
    const r = await runBypassAudit(pool, { exec, inContainer: false, now: () => Date.parse('2026-10-12T04:00:00Z'), sendBark: vi.fn() });
    expect(r.ok).toBe(false);
    expect(r.scan.error).toMatch(/ssh/);
    expect(r.rollup.day).toBe('2026-10-12');
  });
});
