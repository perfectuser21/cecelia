import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { vi, expect } from 'vitest';
import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';
const boundary = vi.hoisted(() => ({ forbidden: vi.fn(() => { throw new Error('禁止租约回归进入外部副作用'); }) }));
vi.mock('child_process', () => ({ execSync: boundary.forbidden }));
vi.mock('node:child_process', () => ({ execSync: boundary.forbidden }));
vi.mock('fs', () => ({ existsSync: boundary.forbidden, readdirSync: boundary.forbidden, rmSync: boundary.forbidden,
  readFileSync: boundary.forbidden, unlinkSync: boundary.forbidden, statSync: boundary.forbidden }));
vi.mock('node:fs', () => ({ existsSync: boundary.forbidden, readdirSync: boundary.forbidden, rmSync: boundary.forbidden,
  readFileSync: boundary.forbidden, unlinkSync: boundary.forbidden, statSync: boundary.forbidden }));
vi.mock('../../db.js', () => ({ default: { query: boundary.forbidden } }));
vi.mock('../../utils/cleanup-lock.js', () => ({ withLock: boundary.forbidden }));
vi.mock('../../executor-contracts.js', () => ({ EXECUTOR_CONTRACTS: {}, resolveLivenessKind: boundary.forbidden }));
vi.mock('../../device-lock-helpers.js', () => ({ releaseDeviceLocksHeldBy: boundary.forbidden }));
vi.mock('../../lib/task-event-log.js', () => ({ recordTaskEventSafe: boundary.forbidden }));

export const clients = {};
export const cleaner = 'owned-active-lease-cleaner';
export let cleanup, claim, heartbeat, release;
let recover;
const connected = new Set(), ids = [];
let previous;
export async function open() {
  previous = process.env.BRAIN_RUNNER_ID;
  process.env.BRAIN_RUNNER_ID = cleaner;
  const config = privatePgConfig();
  for (const name of ['observer', 'cleaner', 'heartbeat']) {
    const client = clients[name] = new pg.Client(config);
    await client.connect(); connected.add(client);
    await verifyPrivatePg(client);
    await client.query("SET statement_timeout='5s'");
  }
  ({ runRecoveryOnce: recover } = await import('../../recovery-loop.js'));
  ({ cleanupStaleClaims: cleanup } = await import('../../startup-recovery.js'));
  ({ claimTaskWithLease: claim, heartbeatTaskLease: heartbeat, releaseTaskLease: release } = await import('../../lib/task-lease.js'));
}
export async function close() {
  try {
    for (const client of connected) await client.query('ROLLBACK').catch(() => {});
    if (connected.has(clients.observer) && ids.length) {
      await clients.observer.query('DELETE FROM tasks WHERE id=ANY($1::uuid[])', [ids]);
      expect((await clients.observer.query('SELECT id FROM tasks WHERE id=ANY($1::uuid[])', [ids])).rows).toEqual([]);
      expect((await clients.observer.query('SELECT task_id FROM task_leases WHERE task_id=ANY($1::uuid[])', [ids])).rows).toEqual([]);
    }
    expect(boundary.forbidden).not.toHaveBeenCalled();
  } finally {
    for (const client of connected) await client.end();
    if (previous === undefined) delete process.env.BRAIN_RUNNER_ID;
    else process.env.BRAIN_RUNNER_ID = previous;
  }
}
export async function seed(kind = 'valid', ownerOverride) {
  const id = randomUUID(), owner = ownerOverride || `owned-lease-${id}`;
  ids.push(id);
  await clients.observer.query(`INSERT INTO tasks(id,title,status,task_type,priority,payload,result)
    VALUES($1,$2,'queued','research','P2','{}','{}')`, [id, `active-lease-${id}`]);
  const claimed = await claim(clients.observer, { taskId: id, claimer: owner, ...(kind === 'none' ? {} : { leaseSeconds: 7200 }) });
  expect(claimed.status).toBe(200);
  await clients.observer.query("UPDATE tasks SET claimed_at=NOW()-INTERVAL '90 minutes' WHERE id=$1", [id]);
  if (kind !== 'none') await clients.observer.query(`UPDATE task_leases SET claimed_at=NOW()-INTERVAL '90 minutes',
    lease_until=NOW()+INTERVAL '30 minutes' WHERE task_id=$1`, [id]);
  if (kind === 'expired') await clients.observer.query("UPDATE task_leases SET lease_until=NOW()-INTERVAL '1 minute' WHERE task_id=$1", [id]);
  if (kind === 'released') expect((await release(clients.observer, { taskId: id, claimer: owner })).released).toBe(true);
  if (kind === 'mismatched') await clients.observer.query("UPDATE task_leases SET claimer='different-owned-lease' WHERE task_id=$1", [id]);
  return { id, owner };
}
export async function read(id) {
  return (await clients.observer.query(`SELECT t.id,t.status,t.claimed_by,t.claimed_at,t.xmin::text AS task_version,
    l.claimer,l.lease_until,l.heartbeat_at,l.heartbeat_count,l.released_at
    FROM tasks t LEFT JOIN task_leases l ON l.task_id=t.id WHERE t.id=$1`, [id])).rows[0];
}
export async function remove(id) {
  await clients.observer.query('DELETE FROM tasks WHERE id=$1', [id]);
}
export function snapshotGate(client) {
  let selected, resume;
  const ready = new Promise(resolve => { selected = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  const pool = { query: async (sql, args) => {
    const result = await client.query(sql, args);
    if (/SELECT id, claimed_by, claimed_at, status/.test(sql)) { selected(result.rows); await gate; }
    return result;
  } };
  return { pool, ready, resume };
}
export async function waitForLock(client, settled) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const row = (await clients.observer.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1', [client.processID])).rows[0];
    if (row?.wait_event_type === 'Lock') {
      expect(row.wait_event).toBe('transactionid');
      expect(settled()).toBe(false);
      return;
    }
    if (settled()) throw new Error('受控并发操作在获得预期行锁前已结束');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('未观察到真实PG事务锁等待');
}

/** 真实周期默认cleanup动态入口；其它五恢复网显式record-only，不启动定时器。 */
export async function cycle() {
  const calls = [];
  const record = name => async () => { calls.push(name); return []; };
  const result = await recover({ pool: clients.cleaner,
    checkStuckPipelines: record('pipelines'), fetchInProgress: async () => [],
    autoFailTimedOutTasks: record('timeouts'), probeTaskLiveness: record('liveness'),
    unblockExpiredTasks: record('unblock'), sweepStaleDeviceLocks: record('devices') });
  expect(calls).toEqual(['pipelines', 'timeouts', 'liveness', 'unblock', 'devices']);
  return result;
}
