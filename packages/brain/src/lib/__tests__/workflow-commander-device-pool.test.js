/**
 * 抖音发布 workflow（Brain→Commander 出口）从设备池选机（派发总闸 G，任务 c5f6e683）。
 * 登记了 device.pool 的 workflow：认领后从池里按 priority 试锁，选中哪台调度单就写哪台；
 * 全被占只等不接管；池空 → failed 写原因。派发成功后落 Brain 租约（超时 + 15 分钟）。
 */
import { describe, it, expect, vi } from 'vitest';
import { WORKFLOW_DISPATCH_TASK_TYPE, dispatchWorkflowCommanderTasks } from '../workflow-commander-dispatch.js';
import { resolveWorkflowConfig } from '../factory-workflow-config.js';

const CFG = {
  workflow_key: 'douyin_video_publish.android',
  device: { node: 'XIAN-M4-PHONE', profile: 'xiaolongxia', serial: 'ANGYVB4311010223', ssh_host: 'xian-m4', pool: 'douyin.internal' },
  commander: { capability: 'douyin_video_publish', biz: 'Ai办公室', timeout_min: 40 },
  publish_hours: [9, 23],
};
const resolveConfig = (k) => (k === CFG.workflow_key ? CFG : null);
const IN_HOURS = () => new Date('2026-10-12T02:00:00Z');
const T = {
  id: 'bbbbbbbb-1111-2222-3333-444444444444', task_type: WORKFLOW_DISPATCH_TASK_TYPE, status: 'queued',
  title: '发一条抖音私密作品', priority: 'P1', payload: { workflow_key: CFG.workflow_key },
};
function fakePool() {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (/FROM tasks[\s\S]*status = 'queued'/.test(sql)) return { rows: [T] };
      if (/UPDATE tasks SET claimed_by = \$2/.test(sql)) return { rows: [T], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }),
  };
}
const SECOND = { serial: 'e6c7ef34', machine: 'xian-m4', profile: 'yueshengyun-work', account_ref: 'Ai效率笔记', priority: 20 };

describe('真配置', () => {
  it('抖音·视频发布登记了 device.pool=douyin.internal', () => {
    expect(resolveWorkflowConfig('douyin_video_publish.android').device.pool).toBe('douyin.internal');
  });
});

describe('dispatchWorkflowCommanderTasks × 设备池', () => {
  it('池里选中第二台 → 调度单/设备 serial 用选中的那台，留痕 device_pool_selected，派发后落 Brain 租约', async () => {
    const pool = fakePool();
    const sshCalls = [];
    const selectFromPool = vi.fn(async () => ({ ok: true, member: SECOND, tried: [{ serial: 'ANGYVB4311010223', status: 409, error: 'device_locked' }] }));
    const lockGate = vi.fn();
    const setLease = vi.fn(async () => ({}));
    const recordEvent = vi.fn(async () => {});
    const out = await dispatchWorkflowCommanderTasks(pool, {
      resolveConfig, now: IN_HOURS, lockGate, selectFromPool, setLease, recordEvent,
      sshDispatch: async (args, input) => { sshCalls.push({ args, input }); return 'DISPATCHED'; },
    });
    expect(out.dispatched).toBe(1);
    expect(lockGate).not.toHaveBeenCalled();
    expect(selectFromPool).toHaveBeenCalledWith(pool, 'douyin.internal', expect.objectContaining({ id: T.id }), expect.objectContaining({ ttlMinutes: 60 }));
    expect(sshCalls[0].input).toContain('调度单：douyin_video_publish xian-m4 yueshengyun-work e6c7ef34 Ai效率笔记');
    const pay = pool.calls.find((c) => /jsonb_build_object\('run_id'/.test(c.sql));
    expect(pay.params[3]).toBe('e6c7ef34');
    expect(recordEvent).toHaveBeenCalledWith(pool, T.id, 'device_pool_selected', expect.objectContaining({ pool: 'douyin.internal', serial: 'e6c7ef34' }));
    expect(setLease).toHaveBeenCalledWith(pool, T.id, 40 * 60 + 900);
  });

  it('池里全被占 → 只等不接管：放 claim、不派、不落租约', async () => {
    const pool = fakePool();
    const sshDispatch = vi.fn();
    const setLease = vi.fn();
    const out = await dispatchWorkflowCommanderTasks(pool, {
      resolveConfig, now: IN_HOURS, sshDispatch, setLease, recordEvent: vi.fn(async () => {}),
      selectFromPool: async () => ({ ok: false, reason: 'all_busy', tried: [{ serial: 'ANGYVB4311010223', status: 409 }] }),
    });
    expect(out.waiting).toBe(1);
    expect(sshDispatch).not.toHaveBeenCalled();
    expect(setLease).not.toHaveBeenCalled();
    expect(pool.calls.some((c) => /SET claimed_by = NULL/.test(c.sql))).toBe(true);
  });

  it('池空（无可用成员）→ failed 写 workflow_dispatch_pool_empty', async () => {
    const pool = fakePool();
    const out = await dispatchWorkflowCommanderTasks(pool, {
      resolveConfig, now: IN_HOURS, sshDispatch: vi.fn(), recordEvent: vi.fn(async () => {}),
      selectFromPool: async () => ({ ok: false, reason: 'pool_empty', tried: [] }),
    });
    expect(out.failed).toBe(1);
    expect(JSON.stringify(pool.calls.find((c) => /status = 'failed'/.test(c.sql)).params)).toContain('workflow_dispatch_pool_empty');
  });

  it('池成员字段含非法字符 → 不拼进调度单，放锁后 failed', async () => {
    const pool = fakePool();
    const releaseLock = vi.fn(async () => 1);
    const sshDispatch = vi.fn();
    const out = await dispatchWorkflowCommanderTasks(pool, {
      resolveConfig, now: IN_HOURS, sshDispatch, releaseLock, recordEvent: vi.fn(async () => {}),
      selectFromPool: async () => ({ ok: true, member: { ...SECOND, account_ref: 'a b' }, tried: [] }),
    });
    expect(out.failed).toBe(1);
    expect(sshDispatch).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledWith(T.id);
  });

  it('没登记 pool 的 workflow 仍走固定 serial 单闸（老路径不变）', async () => {
    const pool = fakePool();
    const noPool = { ...CFG, device: { ...CFG.device, pool: undefined } };
    const selectFromPool = vi.fn();
    const lockGate = vi.fn(async () => ({ pass: true, acquired: true }));
    const out = await dispatchWorkflowCommanderTasks(pool, {
      resolveConfig: () => noPool, now: IN_HOURS, lockGate, selectFromPool, setLease: vi.fn(async () => ({})),
      sshDispatch: async () => 'DISPATCHED',
    });
    expect(out.dispatched).toBe(1);
    expect(selectFromPool).not.toHaveBeenCalled();
    expect(lockGate.mock.calls[0][0].payload.device_serial).toBe('ANGYVB4311010223');
  });
});
