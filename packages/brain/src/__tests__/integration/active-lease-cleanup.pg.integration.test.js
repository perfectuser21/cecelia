/** 真实claim/heartbeat/cleanup，私有全迁移PG；不调用dispatcher/设备/通知。 */
import { beforeAll, afterAll, it, expect } from 'vitest';
import { clients, cleaner, open, close, seed, read, remove, cleanup, heartbeat, snapshotGate, waitForLock, cycle } from '../helpers/active-lease-cleanup-pg.js';
beforeAll(open);
afterAll(close);

it('认领已90分钟但租约仍有效，真实heartbeat后清理不得夺走owner且后续续租成功', async () => {
  const { id, owner } = await seed();
  try {
    const before = await read(id);
    expect((await heartbeat(clients.heartbeat, { taskId: id, claimer: owner, leaseSeconds: 7200 })).ok).toBe(true);
    const renewed = await read(id);
    expect(renewed.heartbeat_count).toBe(1);
    expect(renewed.lease_until.getTime()).toBeGreaterThan(before.lease_until.getTime());
    expect(renewed.claimed_at).toEqual(before.claimed_at); // 心跳不重置认领起点。
    expect(renewed.task_version).toBe(before.task_version); // 不以无业务字段touch喂xmin。
    expect(await cleanup(clients.cleaner)).toEqual({ cleaned: 0, errors: [] });
    expect((await read(id)).claimed_by).toBe(owner);
    expect((await heartbeat(clients.heartbeat, { taskId: id, claimer: owner })).ok).toBe(true);
  } finally { await remove(id); }
});
it.each(['none', 'expired', 'released', 'mismatched'])('%s租约不能阻挡真正过期claim恢复', async kind => {
  const { id } = await seed(kind);
  try {
    expect(await cleanup(clients.cleaner)).toEqual({ cleaned: 1, errors: [] });
    expect(await read(id)).toMatchObject({ claimed_by: null, claimed_at: null });
  } finally { await remove(id); }
});
it.each(['wrong-owner', 'terminal', 'commander'])('heartbeat对%s仍返回lease_lost，不续租/同步设备', async kind => {
  const { id, owner } = await seed();
  try {
    if (kind === 'terminal') await clients.observer.query("UPDATE tasks SET status='failed' WHERE id=$1", [id]);
    if (kind === 'commander') await clients.observer.query(`UPDATE tasks SET payload='${JSON.stringify({ commander_protocol: 'commander-v2' })}'::jsonb WHERE id=$1`, [id]);
    const before = await read(id);
    const result = await heartbeat(clients.heartbeat, { taskId: id, claimer: kind === 'wrong-owner' ? 'different-owned' : owner });
    expect(result).toMatchObject({ ok: false, reason: 'lease_lost' });
    const after = await read(id);
    expect(after.heartbeat_count).toBe(before.heartbeat_count);
    expect(after.lease_until).toEqual(before.lease_until);
  } finally { await remove(id); }
});

it.each([undefined, cleaner])('heartbeat先持task/lease行锁，owner=%s，cleanup等待后保护续租', async ownerOverride => {
  const { id, owner } = await seed('expired', ownerOverride);
  const gate = snapshotGate(clients.cleaner);
  let pending, settled = false;
  try {
    if (!ownerOverride) {
      pending = cleanup(gate.pool).then(value => { settled = true; return value; });
      expect((await gate.ready).map(row => row.id)).toContain(id);
    }
    await clients.heartbeat.query('BEGIN');
    expect((await heartbeat(clients.heartbeat, { taskId: id, claimer: owner, leaseSeconds: 7200 })).ok).toBe(true);
    if (ownerOverride) pending = cleanup(clients.cleaner).then(value => { settled = true; return value; });
    gate.resume();
    await waitForLock(clients.cleaner, () => settled);
    await clients.heartbeat.query('COMMIT');
    expect(await pending).toEqual({ cleaned: 0, errors: [] });
    expect((await read(id)).claimed_by).toBe(owner);
  } finally {
    gate.resume(); await clients.heartbeat.query('ROLLBACK').catch(() => {});
    if (pending) await pending;
    await remove(id);
  }
}, 15000);
it.each([undefined, cleaner])('cleanup先持task锁，owner=%s，heartbeat等待后不能假续租', async ownerOverride => {
  const { id, owner } = await seed('expired', ownerOverride);
  let pending, settled = false;
  try {
    await clients.cleaner.query('BEGIN');
    expect(await cleanup(clients.cleaner)).toEqual({ cleaned: 1, errors: [] });
    pending = heartbeat(clients.heartbeat, { taskId: id, claimer: owner, leaseSeconds: 7200 })
      .then(value => { settled = true; return value; });
    await waitForLock(clients.heartbeat, () => settled);
    await clients.cleaner.query('COMMIT');
    expect(await pending).toMatchObject({ ok: false, reason: 'lease_lost' });
    const after = await read(id);
    expect(after.claimed_by).toBeNull();
    expect(after.heartbeat_count).toBe(0);
  } finally {
    await clients.cleaner.query('ROLLBACK').catch(() => {});
    if (pending) await pending;
    await remove(id);
  }
}, 15000);
it('两个清理器竞争同一过期批次，单批成功计数且无反序死锁', async () => {
  const one = await seed('expired'), two = await seed('expired');
  let pending, settled = false;
  try {
    await clients.cleaner.query('BEGIN');
    expect(await cleanup(clients.cleaner)).toEqual({ cleaned: 2, errors: [] });
    pending = cleanup(clients.heartbeat).then(value => { settled = true; return value; });
    await waitForLock(clients.heartbeat, () => settled);
    await clients.cleaner.query('COMMIT');
    expect(await pending).toEqual({ cleaned: 0, errors: [] });
    expect((await read(one.id)).claimed_by).toBeNull();
    expect((await read(two.id)).claimed_by).toBeNull();
  } finally {
    await clients.cleaner.query('ROLLBACK').catch(() => {});
    if (pending) await pending;
    await remove(one.id); await remove(two.id);
  }
}, 15000);

it.each(['valid', 'expired'])('paused的%s同owner租约：有效时保守保留，过期恢复', async kind => {
  const { id, owner } = await seed(kind);
  try {
    await clients.observer.query("UPDATE tasks SET status='paused' WHERE id=$1", [id]);
    expect(await cleanup(clients.cleaner)).toEqual({ cleaned: kind === 'valid' ? 0 : 1, errors: [] });
    expect((await read(id)).claimed_by).toBe(kind === 'valid' ? owner : null);
  } finally { await remove(id); }
});
it.each(['queued', 'paused'])('self owner新鲜%s有效lease受保护；queued仍能续租', async status => {
  const { id, owner } = await seed('valid', cleaner);
  try {
    await clients.observer.query('UPDATE tasks SET status=$2,claimed_at=NOW() WHERE id=$1', [id, status]);
    expect(await cycle()).toMatchObject({ staleReleased: 0 });
    expect((await read(id)).claimed_by).toBe(owner);
    if (status === 'queued') expect((await heartbeat(clients.heartbeat, { taskId: id, claimer: owner })).ok).toBe(true);
  } finally { await remove(id); }
});
it.each(['none', 'expired', 'released', 'mismatched'])('self owner新鲜%s租约仍恢复崩溃残留', async kind => {
  const { id } = await seed(kind, cleaner);
  try {
    await clients.observer.query('UPDATE tasks SET claimed_at=NOW() WHERE id=$1', [id]);
    expect(await cycle()).toMatchObject({ staleReleased: 1 });
    expect((await read(id)).claimed_by).toBeNull();
  } finally { await remove(id); }
});
