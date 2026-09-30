/**
 * qiumi-device-busy-wait.test.js — 手机忙时秋米任务排队等待，不再直接「受阻」收尾（任务 5ad81457）。
 *
 * 0930 09:15 实证：苏彦卿任务 160d1a2a（小彩）派出时，小彩正被另一张秋米测试任务 8ecb8384 持锁；
 * agent 预检通过、lock-acquire 失败后按技能规则不抢锁、直接收尾报告"受阻"，
 * 收割器照单判 completed_no_pr —— 活没干，账却销了。主理人原话：手机有活时，任务接了之后应该等待。
 *
 * 约定：agent 拿不到手机锁时，最后一行只输出 `DEVICE_BUSY owner=<持有者> serial=<序列号>`。
 * 收割器见到这个标记行：不判终态，回队（清 run_id 保留路由），5 分钟后重试；
 * 累计等待超过 min(任务超时, 120 分钟) 或已过 payload.expires_at → failed(device_busy_timeout)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../lib/ssh-args.js', () => ({ SSH_BASE_ARGS: Object.freeze(['-o', 'BatchMode=yes']) }));
vi.mock('../lib/task-event-log.js', () => ({ recordTaskEventSafe: vi.fn().mockResolvedValue(true) }));
vi.mock('../machine-registry.js', () => ({
  resolvePrimaryWorkerId: vi.fn(() => 'fake-primary'),
  sshTargetFor: vi.fn(() => 'administrator@10.0.0.9'),
}));
import { recordTaskEventSafe } from '../lib/task-event-log.js';
import { buildQiumiSource } from '../lib/qiumi-source.js';
import { triggerOpenclawAgent, reapOpenclawAgentRuns } from '../openclaw-agent-executor.js';
import { parseDeviceBusyMarker, planDeviceBusy, DEVICE_BUSY_RETRY_MS } from '../lib/qiumi-device-busy.js';
import { deviceBusyNote } from '../lib/qiumi-schedule.js';

const TID = '160d1a2a-1111-2222-3333-444444444444';
const NOW = Date.parse('2026-09-30T01:15:00.000Z'); // 上海 09:15
const MIN = 60_000;
const BUSY_TEXT = '预检通过；lock-acquire 失败，小彩正被占用，按约定不抢锁。\nDEVICE_BUSY owner=t3-readonly-20260930-01 serial=ABCD1234';

beforeEach(() => vi.clearAllMocks());

/** 收割一轮：第一条查询回候选行，其余查询统一回 rowCount=1。 */
async function reapOnce(finalText, payload = {}, { exit = 0 } = {}) {
  const row = { id: TID, run_id: 'qiumi-160d1a2a-1', payload: { run_id: 'qiumi-160d1a2a-1', ...payload } };
  const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [], rowCount: 1 });
  const log = JSON.stringify({ finalAssistantVisibleText: finalText });
  const execFileFn = vi.fn((c, a, o, cb) => cb(null, `EXIT=${exit}\n${log}\n`, ''));
  const r = await reapOpenclawAgentRuns({ query }, { execFileFn, now: () => NOW });
  return { r, query };
}
const requeueCall = (query) => query.mock.calls.find(([sql]) => /SET status = 'queued'/.test(sql));
const patchOf = (call) => JSON.parse(call[1].find((v) => typeof v === 'string' && v.includes('next_run_at')));

describe('收割器：DEVICE_BUSY 标记 → 回队等待，不判终态', () => {
  it('首次忙：回 queued、清 run_id、next_run_at≈+5min、attempts=1、status_history 留痕，不写 completed_no_pr', async () => {
    const { r, query } = await reapOnce(BUSY_TEXT);
    expect(r).toEqual({ reaped: 0, completed: 0, failed: 0, requeued: 1 });
    expect(query.mock.calls.some(([sql]) => /completed_no_pr/.test(sql)), '手机忙被判完成——0930 事故原样复发').toBe(false);
    expect(query.mock.calls.some(([sql]) => /SET status = 'failed'/.test(sql))).toBe(false);

    const call = requeueCall(query);
    expect(call, '没有回队 UPDATE').toBeTruthy();
    const [sql] = call;
    expect(sql).toMatch(/- 'run_id'/);
    expect(sql).toMatch(/status_history/);
    expect(sql).toMatch(/claimed_by = NULL/);
    expect(sql).toMatch(/AND status = 'in_progress'/);
    expect(sql, '不清回写指纹，第 2 次起的忙提示可能刷不上中文表').toMatch(/- 'qiumi_pushed_status'/);
    const patch = patchOf(call);
    expect(Date.parse(patch.next_run_at) - NOW).toBe(5 * MIN);
    expect(patch.device_busy_attempts).toBe(1);
    expect(patch.device_busy).toMatchObject({ owner: 't3-readonly-20260930-01', serial: 'ABCD1234', attempts: 1 });
    expect(patch.run_id, '回队 patch 不得带 run_id（要清掉，让下一轮换新 run_id）').toBeUndefined();
    expect(recordTaskEventSafe).toHaveBeenCalledWith(
      expect.anything(), TID, 'qiumi_device_busy_requeued',
      expect.objectContaining({ owner: 't3-readonly-20260930-01', attempt: 1 }),
    );
  });

  it('再次忙：attempts 递增、首次忙时间保留', async () => {
    const first = new Date(NOW - 10 * MIN).toISOString();
    const { query } = await reapOnce(BUSY_TEXT, {
      device_busy_attempts: 2, device_busy: { owner: 'x', serial: 'ABCD1234', first_at: first, attempts: 2 },
    });
    const patch = patchOf(requeueCall(query));
    expect(patch.device_busy_attempts).toBe(3);
    expect(patch.device_busy.first_at).toBe(first);
  });

  it('累计等待超过任务超时（默认 30 分钟）→ failed(device_busy_timeout)', async () => {
    const { r, query } = await reapOnce(BUSY_TEXT, {
      device_busy_attempts: 6, device_busy: { first_at: new Date(NOW - 31 * MIN).toISOString(), attempts: 6 },
    });
    expect(r).toEqual({ reaped: 1, completed: 0, failed: 1, requeued: 0 });
    expect(requeueCall(query)).toBeUndefined();
    const upd = query.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql));
    expect(upd[1]).toContain('device_busy_timeout');
    expect(upd[0]).toMatch(/AND status = 'in_progress'/);
  });

  it('等待上限封顶 120 分钟：超时 3 小时的任务等 100 分钟仍回队，等 121 分钟判 failed', async () => {
    const at = (m) => ({ timeout_sec: 10800, device_busy_attempts: 5, device_busy: { first_at: new Date(NOW - m * MIN).toISOString() } });
    const a = await reapOnce(BUSY_TEXT, at(100));
    expect(a.r.requeued).toBe(1);
    const b = await reapOnce(BUSY_TEXT, at(121));
    expect(b.r.failed).toBe(1);
    expect(b.query.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql))[1]).toContain('device_busy_timeout');
  });

  it('已过 payload.expires_at → failed(device_busy_timeout)，哪怕是第一次忙', async () => {
    const { r } = await reapOnce(BUSY_TEXT, { expires_at: new Date(NOW - MIN).toISOString() });
    expect(r.failed).toBe(1);
  });

  it('没有标记行的正常完成不受影响；正文里顺嘴提到 DEVICE_BUSY 也不算标记', async () => {
    const a = await reapOnce('已完成：截图 a.jpg');
    expect(a.r).toEqual({ reaped: 1, completed: 1, failed: 0, requeued: 0 });
    const b = await reapOnce('我没有遇到 DEVICE_BUSY 的情况，已完成。');
    expect(b.r.completed).toBe(1);
    expect(requeueCall(b.query)).toBeUndefined();
  });
});

describe('parseDeviceBusyMarker / planDeviceBusy', () => {
  it('取最后一个以 DEVICE_BUSY 开头的行；owner/serial 缺省为 null；容忍反引号包裹', () => {
    expect(parseDeviceBusyMarker(BUSY_TEXT)).toEqual({ owner: 't3-readonly-20260930-01', serial: 'ABCD1234' });
    expect(parseDeviceBusyMarker('`DEVICE_BUSY owner=harvest-cron`')).toEqual({ owner: 'harvest-cron', serial: null });
    expect(parseDeviceBusyMarker('DEVICE_BUSY')).toEqual({ owner: null, serial: null });
    expect(parseDeviceBusyMarker('没事')).toBeNull();
    expect(parseDeviceBusyMarker(null)).toBeNull();
  });

  it('next_run_at = now + 5 分钟', () => {
    const p = planDeviceBusy({ payload: {}, marker: { owner: 'o', serial: 's' }, timeoutSec: 1800, now: NOW });
    expect(p.action).toBe('requeue');
    expect(Date.parse(p.nextRunAt) - NOW).toBe(DEVICE_BUSY_RETRY_MS);
  });
});

describe('中文「OpenClaw结果」等待提示', () => {
  it('⏳ 手机忙（被 <owner> 占用），已排队，<HH:MM> 后重试（第 N 次），上海时间', () => {
    const note = deviceBusyNote({ owner: 't3-readonly-20260930-01', nextRunAt: '2026-09-30T01:20:00.000Z', attempts: 2 });
    expect(note).toBe('⏳ 手机忙（被 t3-readonly-20260930-01 占用），已排队，09:20 后重试（第 2 次）');
  });
  it('owner 缺失 → 写「其他运行」', () => {
    expect(deviceBusyNote({ owner: null, nextRunAt: '2026-09-30T01:20:00.000Z', attempts: 1 })).toContain('被 其他运行 占用');
  });
});

describe('executor prompt：设备提示段带 DEVICE_BUSY 约定', () => {
  function spawnMock() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end: vi.fn() }; child.kill = vi.fn();
    const fn = vi.fn(() => { setImmediate(() => { child.stdout.emit('data', Buffer.from('DISPATCHED\n')); child.emit('close', 0); }); return child; });
    fn.child = child;
    return fn;
  }
  const pool = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
  const taskWith = (hint) => ({
    id: TID, task_type: 'qiumi_task',
    payload: { run_id: 'qiumi-160d1a2a-1', qiumi_department: 'main', qiumi_source: buildQiumiSource({ title: 't' }), qiumi_route: { device_hint: hint } },
  });

  it.each([
    ['台账定案', { is_device: true, serial: 'S9', host: 'xian-m1', profile: 'p9', nickname: '小彩', account: null }],
    ['未定案', { is_device: true, serial: 'S9', host: 'xian-m1' }],
  ])('%s：不要抢锁、最后一行只输出 DEVICE_BUSY owner=… serial=…、Brain 自动排队重试', async (_, hint) => {
    const spawnFn = spawnMock();
    await triggerOpenclawAgent(taskWith(hint), { spawnFn, pool });
    const body = String(spawnFn.child.stdin.end.mock.calls[0][0]);
    expect(body).toContain('不要抢锁');
    expect(body).toContain('DEVICE_BUSY owner=<持有者> serial=<序列号>');
    expect(body).toContain('Brain 会自动排队重试');
  });
});
