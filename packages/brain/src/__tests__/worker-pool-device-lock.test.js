/**
 * worker-pool-device-lock.test.js — G5 横切件（task 104ab89f）：worker 池旁路派发接线设备锁。
 *
 * 语义（设计规格 2026-09-16-device-locks-phones-design.md 组件3）：
 * - CAS 预占成功之后、发射 tmux 之前，payload.device_serial 存在时抢设备锁
 * - 抢不到（locked / unknown_device）→ 回滚 claim（claimed_by=NULL，guard 预占名）留下轮，
 *   不发射 tmux（worker-pool 无 terminal 语义，unknown_device 判死在 dispatcher 侧）
 * - 锁持有者必须是 task.id（与 dispatcher 同键，sweeper 才认得），不是 'interactive-dev-skill'
 * - 无 device_serial → helper 不被调用
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAcquireDeviceLock = vi.fn();
const mockReleaseDeviceLocksHeldBy = vi.fn().mockResolvedValue(0);
vi.mock('../device-lock-helpers.js', () => ({
  acquireDeviceLock: (...args) => mockAcquireDeviceLock(...args),
  releaseDeviceLocksHeldBy: (...args) => mockReleaseDeviceLocksHeldBy(...args),
  sweepStaleDeviceLocks: vi.fn().mockResolvedValue(0),
}));

import { runWorkerPoolDispatch, __resetWorkerPoolDispatchForTest } from '../worker-pool-dispatch.js';

const SERIAL = 'ANGYVB4311010223';
const PHONE_TASK = {
  id: 'aaaaaaaa-1111-0000-0000-000000000001',
  title: '手机发布任务（带 device_serial）',
  payload: { parallel_worker: true, device_serial: SERIAL },
};
const PLAIN_TASK = {
  id: 'bbbbbbbb-2222-0000-0000-000000000002',
  title: '普通并行任务（无 device_serial）',
  payload: { parallel_worker: true },
};

/** mock execFn：slot7-9 全空闲，send-keys 后 pane 立即接管（发射成功路径） */
function makeExecFn() {
  const calls = [];
  const launched = new Set();
  const fn = vi.fn((cmd, opts) => {
    calls.push({ cmd, opts });
    const sk = cmd.match(/send-keys -t (slot\d+)/);
    if (sk) launched.add(sk[1]);
    const m = cmd.match(/list-panes[^']*-t (slot\d+)/);
    if (m) return launched.has(m[1]) ? 'claude\n' : 'zsh\n';
    return '';
  });
  fn.calls = calls;
  return fn;
}

function makePool(tasks = []) {
  const q = vi.fn(async (sql, _params) => {
    if (/FROM dispatch_events/i.test(sql) && /SELECT/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/FROM tasks/i.test(sql) && /queued/i.test(sql)) return { rows: tasks, rowCount: tasks.length };
    if (/UPDATE tasks/i.test(sql)) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { query: q };
}

const noSleep = async () => {};

beforeEach(() => {
  vi.clearAllMocks();
  mockAcquireDeviceLock.mockReset();
  mockReleaseDeviceLocksHeldBy.mockReset();
  mockReleaseDeviceLocksHeldBy.mockResolvedValue(0);
  __resetWorkerPoolDispatchForTest();
});

describe('runWorkerPoolDispatch — 设备锁旁路接线（G5 横切件 task 104ab89f）', () => {
  it('① CAS 成功且设备被占 → 回滚 claim（guard 预占名）且不发射 tmux', async () => {
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'locked',
      holder: { device_name: SERIAL, locked_by: 'other-task-id' },
    });
    const execFn = makeExecFn();
    const pool = makePool([PHONE_TASK]);

    const r = await runWorkerPoolDispatch(pool, { execFn, sleep: noSleep });

    expect(r.dispatched).toBe(0);
    // 不发射 tmux
    expect(execFn.calls.some(c => /send-keys/.test(c.cmd))).toBe(false);
    // 回滚 claim：claimed_by=NULL 且 WHERE guard claimed_by='interactive-dev-skill'
    const rollback = pool.query.mock.calls.find(([sql]) =>
      /UPDATE tasks/i.test(sql)
      && /claimed_by\s*=\s*NULL/i.test(sql)
      && /claimed_by\s*=\s*'interactive-dev-skill'/i.test(sql)
    );
    expect(rollback).toBeTruthy();
    expect(rollback[1]).toContain(PHONE_TASK.id);
    // 锁持有者用 task.id（与 dispatcher 同键），不是预占名
    expect(mockAcquireDeviceLock).toHaveBeenCalledWith(PHONE_TASK.id, SERIAL, undefined);
  });

  it('①b unknown_device → 终态 failed（与 dispatcher 同款：parallel_worker 任务不进 dispatcher 候选，留队列=永久空转）', async () => {
    mockAcquireDeviceLock.mockResolvedValue({ result: 'unknown_device' });
    const execFn = makeExecFn();
    const pool = makePool([PHONE_TASK]);

    const r = await runWorkerPoolDispatch(pool, { execFn, sleep: noSleep });

    expect(r.dispatched).toBe(0);
    expect(execFn.calls.some(c => /send-keys/.test(c.cmd))).toBe(false);
    // 终态 UPDATE：status='failed' + error_message 含 serial 与注册指引 + failure_class
    const failUpdate = pool.query.mock.calls.find(([sql, params]) =>
      /UPDATE tasks/i.test(sql)
      && /status\s*=\s*'failed'/.test(sql)
      && Array.isArray(params) && params[0] === PHONE_TASK.id
      && params.some((p) => typeof p === 'string' && p.includes(SERIAL) && p.includes('register'))
    );
    expect(failUpdate).toBeTruthy();
    expect(failUpdate[0]).toMatch(/failure_class/);
    expect(failUpdate[0]).toMatch(/unknown_device/);
    // 终态 UPDATE 自带 claimed_by=NULL 清理，不能再走 locked 分支的回滚语句
    expect(failUpdate[0]).toMatch(/claimed_by\s*=\s*NULL/i);
  });

  it('①d locked 与 unknown_device 分野：locked 只回滚不判死', async () => {
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'locked',
      holder: { device_name: SERIAL, locked_by: 'other-task-id' },
    });
    const execFn = makeExecFn();
    const pool = makePool([PHONE_TASK]);

    await runWorkerPoolDispatch(pool, { execFn, sleep: noSleep });

    // locked：绝不打 failed，只回滚 claim 留下轮
    const failUpdate = pool.query.mock.calls.find(([sql]) => /status\s*=\s*'failed'/.test(sql));
    expect(failUpdate).toBeFalsy();
    const rollback = pool.query.mock.calls.find(([sql]) =>
      /claimed_by\s*=\s*NULL/i.test(sql) && /interactive-dev-skill/.test(sql)
    );
    expect(rollback).toBeTruthy();
  });

  it('② acquired → 正常发射', async () => {
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'acquired',
      lock: { device_name: SERIAL, locked_by: PHONE_TASK.id },
    });
    const execFn = makeExecFn();
    const pool = makePool([PHONE_TASK]);

    const r = await runWorkerPoolDispatch(pool, { execFn, sleep: noSleep });

    expect(mockAcquireDeviceLock).toHaveBeenCalledWith(PHONE_TASK.id, SERIAL, undefined);
    expect(r.dispatched).toBe(1);
    expect(execFn.calls.some(c => /send-keys/.test(c.cmd))).toBe(true);
    const evts = pool.query.mock.calls.filter(([sql]) => /INSERT INTO dispatch_events/i.test(sql));
    expect(evts.length).toBe(1);
    expect(evts[0][1].join(' ')).toMatch(/dispatched/);
  });

  it('③ 无 device_serial → acquireDeviceLock 不被调用，正常发射', async () => {
    const execFn = makeExecFn();
    const pool = makePool([PLAIN_TASK]);

    const r = await runWorkerPoolDispatch(pool, { execFn, sleep: noSleep });

    expect(mockAcquireDeviceLock).not.toHaveBeenCalled();
    expect(r.dispatched).toBe(1);
  });

  it('②b device_ttl_minutes 透传', async () => {
    const ttlTask = {
      ...PHONE_TASK,
      payload: { parallel_worker: true, device_serial: SERIAL, device_ttl_minutes: 60 },
    };
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'acquired',
      lock: { device_name: SERIAL, locked_by: ttlTask.id },
    });
    const execFn = makeExecFn();
    const pool = makePool([ttlTask]);

    await runWorkerPoolDispatch(pool, { execFn, sleep: noSleep });

    expect(mockAcquireDeviceLock).toHaveBeenCalledWith(ttlTask.id, SERIAL, 60);
  });

  it('①c acquire 抛错 → fail-closed 按被占处理：回滚不发射', async () => {
    mockAcquireDeviceLock.mockRejectedValue(new Error('db down'));
    const execFn = makeExecFn();
    const pool = makePool([PHONE_TASK]);

    const r = await runWorkerPoolDispatch(pool, { execFn, sleep: noSleep });

    expect(r.dispatched).toBe(0);
    expect(execFn.calls.some(c => /send-keys/.test(c.cmd))).toBe(false);
    // fail-closed = 按被占处理：只回滚留下轮，绝不判死
    const failUpdate = pool.query.mock.calls.find(([sql]) => /status\s*=\s*'failed'/.test(sql));
    expect(failUpdate).toBeFalsy();
    const rollback = pool.query.mock.calls.find(([sql]) =>
      /claimed_by\s*=\s*NULL/i.test(sql) && /interactive-dev-skill/.test(sql)
    );
    expect(rollback).toBeTruthy();
  });
});
