/**
 * 统一领单租约 + 设备锁跟租约走 + 设备池（派发总闸 G，任务 c5f6e683）——真 PG。
 *
 * 钉住：claim 带租约落 task_leases；heartbeat 续约并把设备锁 expires_at 拉到租约；
 * reaper 按任务类型现有语义回队 / 判 lost 并放设备锁；Brain 租约（openclaw-agent）过期先探活；
 * 设备锁不再被持有者 in_progress 无限压住；设备池按 priority 依次试锁，不可用换下一台。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { taskLeaseFixture, seedTask } from '../helpers/task-lease-pg-fixture.js';
import { acquireDeviceLock } from '../../device-lock-helpers.js';
import {
  claimTaskWithLease, heartbeatTaskLease, releaseTaskLease, setBrainLease, reapExpiredLeases,
} from '../../lib/task-lease.js';
import { listPoolCandidates, selectDeviceFromPool } from '../../lib/device-pool.js';

const PHONE = 'ANGYVB4311010223';
const PHONE_2 = 'e6c7ef34';
let fx;
let pool;

beforeEach(async () => { fx = await taskLeaseFixture(); pool = fx.pool; });
afterEach(async () => { if (fx) await fx.close(); fx = null; });

const expireLease = (taskId, ago = '1 minute') => pool.query(
  `UPDATE task_leases SET lease_until = NOW() - $2::interval WHERE task_id = $1`, [taskId, ago],
);
const taskRow = async (id) => (await pool.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
const leaseRow = async (id) => (await pool.query('SELECT * FROM task_leases WHERE task_id = $1', [id])).rows[0];
const lockRow = async (serial) => (await pool.query('SELECT * FROM device_locks WHERE device_name = $1', [serial])).rows[0];
const noProbe = async () => { throw new Error('probe must not be called'); };

describe.sequential('统一领单 claim + lease', () => {
  it('claim 带 lease_seconds：认领成功并落租约行，返回 lease_until', async () => {
    const id = await seedTask(pool);
    const r = await claimTaskWithLease(pool, { taskId: id, claimer: 'factory-dispatcher@mmv', executorKind: 'openclaw-agent', leaseSeconds: 120 });
    expect(r.status).toBe(200);
    expect(r.body.claimed_by).toBe('factory-dispatcher@mmv');
    expect(r.body.lease_until).toBeTruthy();
    const l = await leaseRow(id);
    expect(l.claimer).toBe('factory-dispatcher@mmv');
    expect(l.source).toBe('claim');
    expect(l.lease_seconds).toBe(120);
  });

  it('不带 lease_seconds：行为与旧 claim 一致，不落租约', async () => {
    const id = await seedTask(pool);
    const r = await claimTaskWithLease(pool, { taskId: id, claimer: 'x' });
    expect(r.status).toBe(200);
    expect(r.body.executor_kind).toBe('headed-session');
    expect(await leaseRow(id)).toBeUndefined();
  });

  it('已被别人认领 → 409，不落租约；不存在 → 404', async () => {
    const id = await seedTask(pool, { claimed_by: 'someone' });
    const r = await claimTaskWithLease(pool, { taskId: id, claimer: 'me', leaseSeconds: 60 });
    expect(r.status).toBe(409);
    expect(r.body.claimed_by).toBe('someone');
    expect(await leaseRow(id)).toBeUndefined();
    const missing = await claimTaskWithLease(pool, { taskId: '00000000-0000-4000-8000-000000000000', claimer: 'me', leaseSeconds: 60 });
    expect(missing.status).toBe(404);
  });

  it('非法 on_lease_expire → 400', async () => {
    const id = await seedTask(pool);
    const r = await claimTaskWithLease(pool, { taskId: id, claimer: 'me', leaseSeconds: 60, onExpire: 'explode' });
    expect(r.status).toBe(400);
    expect((await taskRow(id)).claimed_by).toBeNull();
  });

  it('heartbeat：同领单方续约并把它持有的设备锁 expires_at 拉到租约；别的领单方 → lease_lost', async () => {
    const id = await seedTask(pool, { status: 'in_progress' });
    await claimTaskWithLease(pool, { taskId: id, claimer: 'runner-a', leaseSeconds: 60 });
    expect((await acquireDeviceLock(id, PHONE, 1, pool)).result).toBe('acquired');
    const hb = await heartbeatTaskLease(pool, { taskId: id, claimer: 'runner-a', leaseSeconds: 900 });
    expect(hb.ok).toBe(true);
    const l = await leaseRow(id);
    expect(l.heartbeat_count).toBe(1);
    expect(new Date(l.lease_until).getTime()).toBeGreaterThan(Date.now() + 800_000);
    expect(new Date((await lockRow(PHONE)).expires_at).getTime()).toBe(new Date(l.lease_until).getTime());
    const foreign = await heartbeatTaskLease(pool, { taskId: id, claimer: 'runner-b', leaseSeconds: 60 });
    expect(foreign).toMatchObject({ ok: false, reason: 'lease_lost' });
  });

  it('heartbeat：任务已终态或租约已被回收 → lease_lost（执行者据此停手）', async () => {
    const id = await seedTask(pool);
    await claimTaskWithLease(pool, { taskId: id, claimer: 'r', leaseSeconds: 60 });
    await pool.query(`UPDATE tasks SET status = 'failed' WHERE id = $1`, [id]);
    expect((await heartbeatTaskLease(pool, { taskId: id, claimer: 'r' })).ok).toBe(false);
    const id2 = await seedTask(pool);
    await claimTaskWithLease(pool, { taskId: id2, claimer: 'r', leaseSeconds: 60 });
    await releaseTaskLease(pool, { taskId: id2, claimer: 'r', reason: 'done' });
    expect((await heartbeatTaskLease(pool, { taskId: id2, claimer: 'r' })).ok).toBe(false);
  });
});

describe.sequential('task-lease-reaper：过期租约按任务类型语义回收', () => {
  it('bridge 类（合同 onStale=requeue）：回队、清认领、租约 requeue_count+1、放设备锁', async () => {
    const id = await seedTask(pool, { status: 'in_progress', executor_kind: 'bridge' });
    await claimTaskWithLease(pool, { taskId: id, claimer: 'w', executorKind: 'bridge', leaseSeconds: 60 });
    await pool.query(`UPDATE tasks SET status = 'in_progress' WHERE id = $1`, [id]);
    expect((await acquireDeviceLock(id, PHONE, 30, pool)).result).toBe('acquired');
    await expireLease(id);
    const out = await reapExpiredLeases(pool, { probe: noProbe });
    expect(out.requeued).toBe(1);
    const t = await taskRow(id);
    expect(t.status).toBe('queued');
    expect(t.claimed_by).toBeNull();
    expect((await lockRow(PHONE)).locked_by).toBeNull();
    const l = await leaseRow(id);
    expect(l.released_at).not.toBeNull();
    expect(l.release_reason).toBe('expired_requeued');
    expect(l.requeue_count).toBe(1);
    const ev = await pool.query(`SELECT event_type FROM task_events WHERE task_id = $1`, [id]);
    expect(ev.rows.map((r) => r.event_type)).toContain('lease_expired');
  });

  it('openclaw-agent 类（外部执行者，onStale=fail）claim 租约过期：判 lost=failed，写 lease_expired 原因并放锁', async () => {
    const id = await seedTask(pool, { status: 'queued', task_type: 'skill_factory_run' });
    await claimTaskWithLease(pool, { taskId: id, claimer: 'factory-dispatcher@mmv', executorKind: 'openclaw-agent', leaseSeconds: 60 });
    await pool.query(`UPDATE tasks SET status = 'in_progress' WHERE id = $1`, [id]);
    expect((await acquireDeviceLock(id, PHONE, 30, pool)).result).toBe('acquired');
    await expireLease(id);
    const out = await reapExpiredLeases(pool, { probe: noProbe });
    expect(out.failed).toBe(1);
    const t = await taskRow(id);
    expect(t.status).toBe('failed');
    expect(t.error_message).toMatch(/^lease_expired/);
    expect(t.result.lease_expired.claimer).toBe('factory-dispatcher@mmv');
    expect((await lockRow(PHONE)).locked_by).toBeNull();
  });

  it('领单方显式 on_lease_expire=requeue 覆盖类型默认', async () => {
    const id = await seedTask(pool);
    await claimTaskWithLease(pool, { taskId: id, claimer: 'c', executorKind: 'openclaw-agent', leaseSeconds: 60, onExpire: 'requeue' });
    await expireLease(id);
    expect((await reapExpiredLeases(pool, { probe: noProbe })).requeued).toBe(1);
    expect((await taskRow(id)).status).toBe('queued');
  });

  it('回队次数到上限 → failed（不无限回队）', async () => {
    const id = await seedTask(pool);
    await claimTaskWithLease(pool, { taskId: id, claimer: 'c', executorKind: 'bridge', leaseSeconds: 60 });
    await pool.query('UPDATE task_leases SET requeue_count = 2 WHERE task_id = $1', [id]);
    await expireLease(id);
    const out = await reapExpiredLeases(pool, { probe: noProbe });
    expect(out.failed).toBe(1);
    expect((await taskRow(id)).error_message).toMatch(/lease_expired.*retries_exhausted/);
  });

  it('queued + 认领挂着的 headed-session 领单（us-price 形态）：过期即释放认领回队', async () => {
    const id = await seedTask(pool, { task_type: 'qiumi_task' });
    await claimTaskWithLease(pool, { taskId: id, claimer: 'us-price-keyword:abc', leaseSeconds: 60 });
    await expireLease(id);
    expect((await reapExpiredLeases(pool, { probe: noProbe })).requeued).toBe(1);
    const t = await taskRow(id);
    expect(t.status).toBe('queued');
    expect(t.claimed_by).toBeNull();
  });

  it('任务已终态 / 认领已换人：只关租约，不动任务', async () => {
    const a = await seedTask(pool);
    await claimTaskWithLease(pool, { taskId: a, claimer: 'c', leaseSeconds: 60 });
    await pool.query(`UPDATE tasks SET status = 'completed' WHERE id = $1`, [a]);
    const b = await seedTask(pool);
    await claimTaskWithLease(pool, { taskId: b, claimer: 'c', leaseSeconds: 60 });
    await pool.query(`UPDATE tasks SET claimed_by = 'other' WHERE id = $1`, [b]);
    await expireLease(a);
    await expireLease(b);
    const out = await reapExpiredLeases(pool, { probe: noProbe });
    expect(out.released).toBe(2);
    expect((await taskRow(a)).status).toBe('completed');
    expect((await taskRow(b)).claimed_by).toBe('other');
    expect((await leaseRow(a)).release_reason).toBe('task_terminal');
    expect((await leaseRow(b)).release_reason).toBe('claim_changed');
  });

  it('未过期租约不动', async () => {
    const id = await seedTask(pool);
    await claimTaskWithLease(pool, { taskId: id, claimer: 'c', executorKind: 'bridge', leaseSeconds: 600 });
    const out = await reapExpiredLeases(pool, { probe: noProbe });
    expect(out).toMatchObject({ requeued: 0, failed: 0, released: 0 });
    expect((await taskRow(id)).claimed_by).toBe('c');
  });

  it('Brain 租约（openclaw-agent 自派）过期：探活 alive → 续 15 分钟；unknown → 判 lost；dead 且刚过期 → 留给专属收割', async () => {
    const alive = await seedTask(pool, { status: 'in_progress', executor_kind: 'openclaw-agent', claimed_by: 'dispatcher', payload: { run_id: 'r-alive' } });
    const lost = await seedTask(pool, { status: 'in_progress', executor_kind: 'openclaw-agent', claimed_by: 'dispatcher', payload: { run_id: 'r-lost' } });
    const dead = await seedTask(pool, { status: 'in_progress', executor_kind: 'openclaw-agent', claimed_by: 'dispatcher', payload: { run_id: 'r-dead' } });
    for (const id of [alive, lost, dead]) await setBrainLease(pool, id, 1800);
    expect((await leaseRow(alive)).claimer).toBeNull();
    await expireLease(alive);
    await expireLease(lost);
    await expireLease(dead, '2 minutes');
    const verdicts = { 'r-alive': 'alive', 'r-lost': 'unknown', 'r-dead': 'dead' };
    const out = await reapExpiredLeases(pool, { probe: async (t) => verdicts[t.payload.run_id] });
    expect(out).toMatchObject({ extended: 1, failed: 1, skipped: 1 });
    const la = await leaseRow(alive);
    expect(la.extend_count).toBe(1);
    expect(new Date(la.lease_until).getTime()).toBeGreaterThan(Date.now() + 800_000);
    expect((await taskRow(alive)).status).toBe('in_progress');
    expect((await taskRow(lost)).status).toBe('failed');
    expect((await taskRow(lost)).error_message).toMatch(/lease_expired.*probe=unknown/);
    expect((await taskRow(dead)).status).toBe('in_progress');
  });

  it('Brain 租约 dead 且过期超过宽限（专属收割没收走）→ 判 lost', async () => {
    const id = await seedTask(pool, { status: 'in_progress', executor_kind: 'openclaw-agent', payload: { run_id: 'r1' } });
    await setBrainLease(pool, id, 1800);
    await expireLease(id, '15 minutes');
    const out = await reapExpiredLeases(pool, { probe: async () => 'dead' });
    expect(out.failed).toBe(1);
  });

  it('setBrainLease 同步把任务持有的设备锁 expires_at 拉到租约', async () => {
    const id = await seedTask(pool, { status: 'in_progress', executor_kind: 'openclaw-agent' });
    expect((await acquireDeviceLock(id, PHONE, 1, pool)).result).toBe('acquired');
    await setBrainLease(pool, id, 3600);
    const l = await leaseRow(id);
    expect(new Date((await lockRow(PHONE)).expires_at).getTime()).toBe(new Date(l.lease_until).getTime());
  });
});

describe.sequential('设备锁跟租约走（不再被 in_progress 无限压住）', () => {
  async function holdExpired(holder, lockedAgo = '1 minute') {
    await pool.query(
      `UPDATE device_locks SET locked_by = $1, locked_at = NOW() - $3::interval, expires_at = NOW() - INTERVAL '30 seconds' WHERE device_name = $2`,
      [String(holder), PHONE, lockedAgo],
    );
  }

  it('持有者 in_progress 且租约有效 → 锁 TTL 过期也不可抢', async () => {
    const holder = await seedTask(pool, { status: 'in_progress' });
    await claimTaskWithLease(pool, { taskId: holder, claimer: 'h', leaseSeconds: 600 });
    await holdExpired(holder);
    expect((await acquireDeviceLock(await seedTask(pool), PHONE, 30, pool)).result).toBe('locked');
  });

  it('持有者 in_progress 但租约已过期 → 可抢（只回收已过期的）', async () => {
    const holder = await seedTask(pool, { status: 'in_progress' });
    await claimTaskWithLease(pool, { taskId: holder, claimer: 'h', leaseSeconds: 600 });
    await expireLease(holder);
    await holdExpired(holder);
    const rival = await seedTask(pool);
    const r = await acquireDeviceLock(rival, PHONE, 30, pool);
    expect(r.result).toBe('acquired');
    expect(r.lock.locked_by).toBe(rival);
  });

  it('无租约的旧持有者 in_progress：4 小时内仍保护，超过 4 小时（TTL 上限）锁随之过期', async () => {
    const holder = await seedTask(pool, { status: 'in_progress' });
    await holdExpired(holder, '1 hour');
    expect((await acquireDeviceLock(await seedTask(pool), PHONE, 30, pool)).result).toBe('locked');
    await holdExpired(holder, '5 hours');
    expect((await acquireDeviceLock(await seedTask(pool), PHONE, 30, pool)).result).toBe('acquired');
  });

  it('锁未过期：无论租约如何都不可抢（never take over another run）', async () => {
    const holder = await seedTask(pool, { status: 'in_progress' });
    await claimTaskWithLease(pool, { taskId: holder, claimer: 'h', leaseSeconds: 600 });
    await expireLease(holder);
    expect((await acquireDeviceLock(holder, PHONE, 30, pool)).result).toBe('acquired');
    expect((await acquireDeviceLock(await seedTask(pool), PHONE, 30, pool)).result).toBe('locked');
  });
});

describe.sequential('设备池：同平台同账号类型一池，派发从池里选可用的一台', () => {
  const gate = (task) => acquireDeviceLock(task.id, task.payload.device_serial, 30, pool).then((r) => (
    r.result === 'acquired' ? { pass: true, acquired: true }
      : r.result === 'unknown_device' ? { pass: false, status: 422, body: { error: 'unknown_device' } }
        : { pass: false, status: 409, body: { error: 'device_locked', locked_by: r.holder?.locked_by } }
  ));

  async function addSecondMember(priority = 20) {
    await pool.query(
      `INSERT INTO device_pool_members (pool_key, serial, account_ref, priority) VALUES ('douyin.internal', $1, 'Ai效率笔记', $2)`,
      [PHONE_2, priority],
    );
  }

  it('迁移种子：douyin.internal 池里是小彩（Ai办公室），机器/profile 取手机台账（553 把台账 host 对齐生产 xian-m4）', async () => {
    const c = await listPoolCandidates(pool, 'douyin.internal');
    expect(c).toEqual([expect.objectContaining({ serial: PHONE, account_ref: 'Ai办公室', machine: 'xian-m4', profile: 'xiaolongxia' })]);
  });

  it('首选空闲 → 选它并持锁；payload 里写的是选中的 serial', async () => {
    const task = { id: await seedTask(pool), payload: {} };
    const r = await selectDeviceFromPool(pool, 'douyin.internal', task, { lockGate: gate });
    expect(r.ok).toBe(true);
    expect(r.member.serial).toBe(PHONE);
    expect((await lockRow(PHONE)).locked_by).toBe(task.id);
  });

  it('首选被别的在途 run 占着 → 自动换下一台；不接管别人的锁', async () => {
    await addSecondMember();
    const other = await seedTask(pool, { status: 'in_progress' });
    expect((await acquireDeviceLock(other, PHONE, 30, pool)).result).toBe('acquired');
    const task = { id: await seedTask(pool), payload: {} };
    const r = await selectDeviceFromPool(pool, 'douyin.internal', task, { lockGate: gate });
    expect(r.ok).toBe(true);
    expect(r.member.serial).toBe(PHONE_2);
    expect(r.member.account_ref).toBe('Ai效率笔记');
    expect(r.tried).toEqual([expect.objectContaining({ serial: PHONE, status: 409 })]);
    expect((await lockRow(PHONE)).locked_by).toBe(other);
  });

  it('全被占 → all_busy（调用方只等不接管）', async () => {
    await addSecondMember();
    for (const s of [PHONE, PHONE_2]) {
      expect((await acquireDeviceLock(await seedTask(pool, { status: 'in_progress' }), s, 30, pool)).result).toBe('acquired');
    }
    const r = await selectDeviceFromPool(pool, 'douyin.internal', { id: await seedTask(pool), payload: {} }, { lockGate: gate });
    expect(r).toMatchObject({ ok: false, reason: 'all_busy' });
    expect(r.tried).toHaveLength(2);
  });

  it('成员停用 / 手机台账停用 / 池停用 都不进候选；空池 → pool_empty', async () => {
    await addSecondMember();
    await pool.query(`UPDATE device_pool_members SET enabled = false WHERE serial = $1`, [PHONE]);
    await pool.query(`UPDATE phone_registry SET enabled = false WHERE serial = $1`, [PHONE_2]);
    expect(await listPoolCandidates(pool, 'douyin.internal')).toEqual([]);
    const r = await selectDeviceFromPool(pool, 'douyin.internal', { id: await seedTask(pool), payload: {} }, { lockGate: gate });
    expect(r).toMatchObject({ ok: false, reason: 'pool_empty' });
    await pool.query(`UPDATE device_pool_members SET enabled = true; UPDATE phone_registry SET enabled = true; UPDATE device_pools SET enabled = false`);
    expect(await listPoolCandidates(pool, 'douyin.internal')).toEqual([]);
    expect((await selectDeviceFromPool(pool, 'no.such', { id: await seedTask(pool), payload: {} }, { lockGate: gate })).reason).toBe('pool_empty');
  });

  it('门闸说资源不健康（409 resource_unhealthy）也算不可用，换下一台', async () => {
    await addSecondMember();
    const sick = async (task) => (task.payload.device_serial === PHONE
      ? { pass: false, status: 409, body: { error: 'resource_unhealthy' } } : gate(task));
    const r = await selectDeviceFromPool(pool, 'douyin.internal', { id: await seedTask(pool), payload: {} }, { lockGate: sick });
    expect(r.member.serial).toBe(PHONE_2);
    expect(r.tried[0].error).toBe('resource_unhealthy');
  });
});
