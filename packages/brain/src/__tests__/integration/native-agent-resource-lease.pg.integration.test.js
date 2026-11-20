import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { taskLeaseFixture, seedTask } from '../helpers/task-lease-pg-fixture.js';
import { startRun, finishRun } from '../../lib/task-run.js';
import { acquireDeviceLock, releaseDeviceLocksHeldBy, sweepStaleDeviceLocks } from '../../device-lock-helpers.js';
import { claimTaskWithLease, reapExpiredLeases, releaseTaskLease, setBrainLease } from '../../lib/task-lease.js';

let fx, pool;
const phone = 'native-owned-phone';
const hash = 'a'.repeat(64);
const host = { machine_id: 'native-worker', bundle_sha256: hash };
beforeEach(async () => {
  fx = await taskLeaseFixture(); pool = fx.pool;
  await pool.query('CREATE TABLE workflows(id UUID PRIMARY KEY); ALTER TABLE task_runs ADD COLUMN workflow_id UUID');
  await pool.query('INSERT INTO device_locks(device_name) VALUES($1)', [phone]);
});
afterEach(async () => { if (fx) await fx.close(); fx = null; });
const row = async (table, id) => (await pool.query(`SELECT * FROM ${table} WHERE ${table === 'tasks' ? 'id' : table === 'device_locks' ? 'device_name' : 'task_id'}=$1`, [id])).rows[0];
async function holder({ status = 'in_progress', resource = true, source = 'native-agent', evidence = true } = {}) {
  const id = await seedTask(pool, { status, executor_kind: 'external-worker', task_type: 'qiumi_task' });
  const request = { task_id: id, run_id: randomUUID(), input_digest: hash, request_nonce: randomUUID() };
  await pool.query('UPDATE tasks SET result=$2 WHERE id=$1', [id, { native_agent: { request, host, resources: { device_serial: phone }, needs_review: status !== 'in_progress' } }]);
  await acquireDeviceLock(id, phone, 1, pool);
  await setBrainLease(pool, id, 60);
  await pool.query("UPDATE device_locks SET locked_at=NOW()-INTERVAL '6 hours',expires_at=NOW()-INTERVAL '1 hour' WHERE device_name=$1", [phone]);
  await pool.query("UPDATE task_leases SET lease_until=NOW()-INTERVAL '1 hour',extend_count=99 WHERE task_id=$1", [id]);
  const lock = await row('device_locks', phone);
  const version = (await pool.query('SELECT xmin::text AS acquisition_version FROM device_locks WHERE device_name=$1', [phone])).rows[0].acquisition_version;
  const devices = [{ device_name: phone, acquisition_version: version }];
  if (evidence) {
    const created = await startRun({ taskId: id, runId: request.run_id, source, context: { native_agent: { ...request, host, resource_bound: resource } } }, { pool });
    expect(created?.id).toBeTruthy();
  }
  return { id, request, devices, lock };
}
async function notStarted(h, overrides = {}) {
  await finishRun({ runId: h.request.run_id, status: 'failed', result: { actor: 'native-agent', native_agent_resource_settlement: {
    protocol: 'native-agent-resource-settlement/v1', basis: 'not-started', ...h.request, host, devices: h.devices, ...overrides,
  } } }, { pool, emit: async () => {} });
  await pool.query("UPDATE tasks SET status='blocked' WHERE id=$1", [h.id]);
}

describe.sequential('原生运行真账保护租约与设备', () => {
  it.each(['unknown', 'dead'])('离线或身份不明不能failLost并释放设备：%s', async verdict => {
    const h = await holder();
    const result = await reapExpiredLeases(pool, { probe: async () => verdict, afterTransition: async () => {} });
    expect(result).toMatchObject({ failed: 0, released: 0, extended: 1 });
    expect((await row('tasks', h.id)).status).toBe('in_progress');
    expect((await row('task_leases', h.id)).released_at).toBeNull();
    expect(new Date((await row('task_leases', h.id)).lease_until).getTime()).toBeGreaterThan(Date.now());
    expect((await row('device_locks', phone)).locked_by).toBe(h.id);
  });
  it('无设备原生执行的unknown也不能被通用外部worker失联策略判死', async () => {
    const h = await holder({ resource: false });
    expect((await reapExpiredLeases(pool, { probe: async () => 'unknown' })).failed).toBe(0);
    expect((await row('tasks', h.id)).status).toBe('in_progress');
  });
  it.each(['blocked', 'completed_no_pr', 'failed', 'cancelled'])('进程停止/任务%s不是独立设备清场证明', async status => {
    const h = await holder({ status });
    await finishRun({ runId: h.request.run_id, status: 'failed', result: { actor: 'native-agent', execution_stopped: true } }, { pool, emit: async () => {} });
    expect(await releaseDeviceLocksHeldBy(h.id, pool)).toBe(0);
    expect(await sweepStaleDeviceLocks(pool)).toBe(0);
    const other = await seedTask(pool);
    expect((await acquireDeviceLock(other, phone, 1, pool)).result).toBe('locked');
    expect((await reapExpiredLeases(pool, { probe: async () => 'dead' })).extended).toBe(1);
    expect((await row('device_locks', phone)).locked_by).toBe(h.id);
    expect((await row('tasks', h.id)).status).toBe(status);
  });
  it.each([false, true])('活跃原生owner不能被claim(start=%s)接管', async start => {
    const h = await holder();
    const claimed = await claimTaskWithLease(pool, { taskId: h.id, claimer: 'other', executorKind: 'external-worker', leaseSeconds: 60, start });
    expect(claimed.status).toBe(409);
    expect((await row('tasks', h.id)).claimed_by).toBeNull();
    expect((await row('task_leases', h.id)).released_at).toBeNull();
  });
  it('普通release租约请求不能代替原生运行停止和设备清场', async () => {
    const h = await holder();
    expect(await releaseTaskLease(pool, { taskId: h.id, reason: 'cancelled' })).toEqual({ released: false });
    expect((await row('device_locks', phone)).locked_by).toBe(h.id);
  });
  it.each(['no_run', 'foreign_source', 'foreign_run', 'foreign_nonce', 'foreign_host'])('伪造或错配%s不能借payload永久占锁', async variant => {
    const h = await holder({ status: 'blocked', evidence: variant !== 'no_run', source: variant === 'foreign_source' ? 'openclaw-agent' : 'native-agent' });
    if (variant.startsWith('foreign_') && variant !== 'foreign_source') {
      const key = variant === 'foreign_run' ? 'run_id' : variant === 'foreign_nonce' ? 'request_nonce' : 'host';
      await pool.query('UPDATE task_runs SET context=jsonb_set(context,$2::text[],$3::jsonb) WHERE run_id=$1', [h.request.run_id, ['native_agent', key], JSON.stringify(key === 'host' ? { machine_id: 'foreign' } : randomUUID())]);
    }
    expect(await sweepStaleDeviceLocks(pool)).toBe(1);
    expect((await row('device_locks', phone)).locked_by).toBeNull();
  });
  it('认证not_started真账只允许释放同一次设备epoch', async () => {
    const h = await holder(); await notStarted(h);
    expect(await releaseDeviceLocksHeldBy(h.id, pool)).toBe(1);
    const other = await seedTask(pool);
    expect((await acquireDeviceLock(other, phone, 1, pool)).result).toBe('acquired');
    expect(await releaseDeviceLocksHeldBy(h.id, pool)).toBe(0);
    expect((await row('device_locks', phone)).locked_by).toBe(other);
  });
  it('旧not_started证明不能扫掉同任务后来重新取得的新epoch', async () => {
    const h = await holder(); await notStarted(h);
    await pool.query('UPDATE device_locks SET locked_at=clock_timestamp() WHERE device_name=$1', [phone]);
    expect(await releaseDeviceLocksHeldBy(h.id, pool)).toBe(0);
    expect(await sweepStaleDeviceLocks(pool)).toBe(0);
    expect((await row('device_locks', phone)).locked_by).toBe(h.id);
  });
  it('not_started外观但错nonce不解除租约和设备隔离', async () => {
    const h = await holder(); await notStarted(h, { request_nonce: randomUUID() });
    expect(await sweepStaleDeviceLocks(pool)).toBe(0);
    expect((await reapExpiredLeases(pool)).extended).toBe(1);
  });
  it('持有者事务未提交的reservation/owner action不能被sweeper穿透', async () => {
    const h = await holder({ status: 'blocked', evidence: false });
    const owner = await pool.connect();
    try {
      await owner.query('BEGIN');
      await owner.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [h.id]);
      await startRun({ taskId: h.id, runId: h.request.run_id, source: 'native-agent', context: { native_agent: { ...h.request, host, resource_bound: true } } }, { pool: owner });
      expect(await sweepStaleDeviceLocks(pool)).toBe(0);
      await owner.query('COMMIT');
      expect(await sweepStaleDeviceLocks(pool)).toBe(0);
      expect((await row('device_locks', phone)).locked_by).toBe(h.id);
    } finally { await owner.query('ROLLBACK'); owner.release(); }
  });
  it.each(['device_release', 'lease_release', 'claim', 'claim_start'])('reservation等锁提交后%s必须重新读取native真账', async action => {
    const h = await holder({ evidence: false });
    const owner = await pool.connect(), contender = await pool.connect();
    const connection = { query: (...args) => contender.query(...args), connect: async () => ({ query: (...args) => contender.query(...args), release() {} }) };
    let operation;
    try {
      await owner.query('BEGIN');
      await owner.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [h.id]);
      await acquireDeviceLock(h.id, phone, 1, owner);
      await startRun({ taskId: h.id, runId: h.request.run_id, source: 'native-agent', context: { native_agent: { ...h.request, host, resource_bound: true } } }, { pool: owner });
      await owner.query('UPDATE tasks SET result=result WHERE id=$1', [h.id]);
      let ended = false;
      operation = (action === 'device_release' ? releaseDeviceLocksHeldBy(h.id, connection)
        : action === 'lease_release' ? releaseTaskLease(connection, { taskId: h.id })
          : claimTaskWithLease(connection, { taskId: h.id, claimer: 'other', leaseSeconds: 60, start: action === 'claim_start' }))
        .finally(() => { ended = true; });
      for (let i = 0; i < 100 && !ended; i++) {
        const wait = (await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [contender.processID])).rows[0];
        if (wait?.wait_event_type === 'Lock') break;
        await new Promise(resolve => setTimeout(resolve, 2));
      }
      await owner.query('COMMIT');
      const result = await operation;
      if (action === 'device_release') expect(result).toBe(0);
      else if (action === 'lease_release') expect(result).toEqual({ released: false });
      else expect(result.status).toBe(409);
      expect((await row('device_locks', phone)).locked_by).toBe(h.id);
      expect((await row('task_leases', h.id)).released_at).toBeNull();
      expect((await row('tasks', h.id)).claimed_by).toBeNull();
    } finally {
      await owner.query('ROLLBACK');
      if (operation) await operation.catch(() => {});
      owner.release(); contender.release();
    }
  });
});
