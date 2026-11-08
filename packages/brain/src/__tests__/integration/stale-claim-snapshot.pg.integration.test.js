/** 实际恢复器+实际释放/认领函数；两连接控制SELECT快照后的并发提交，只准私有PG。 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';

const boundary = vi.hoisted(() => ({ writer: null, forbidden: vi.fn(() => { throw new Error('禁止恢复测试进入文件/进程/派发边界'); }) }));
vi.mock('child_process', () => ({ execSync: boundary.forbidden }));
vi.mock('node:child_process', () => ({ execSync: boundary.forbidden }));
vi.mock('fs', () => ({ existsSync: boundary.forbidden, readdirSync: boundary.forbidden, rmSync: boundary.forbidden,
  readFileSync: boundary.forbidden, unlinkSync: boundary.forbidden, statSync: boundary.forbidden }));
vi.mock('node:fs', () => ({ existsSync: boundary.forbidden, readdirSync: boundary.forbidden, rmSync: boundary.forbidden,
  readFileSync: boundary.forbidden, unlinkSync: boundary.forbidden, statSync: boundary.forbidden }));
vi.mock('../../utils/cleanup-lock.js', () => ({ withLock: boundary.forbidden }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => {
  if (!boundary.writer) throw new Error('只能访问本人writer');
  return boundary.writer.query(...args);
} } }));
vi.mock('../../task-updater.js', () => ({ broadcastTaskState: vi.fn(async () => {}) }));
vi.mock('../../work-routing-store.js', () => ({ createRoutedTask: boundary.forbidden }));
vi.mock('../../domain-detector.js', () => ({ detectDomain: boundary.forbidden }));
vi.mock('../../role-registry.js', () => ({ getDomainRole: boundary.forbidden }));
vi.mock('../../executor-contracts.js', () => ({ EXECUTOR_CONTRACTS: {}, resolveLivenessKind: boundary.forbidden }));
vi.mock('../../device-lock-helpers.js', () => ({ releaseDeviceLocksHeldBy: boundary.forbidden }));
vi.mock('../../lib/task-event-log.js', () => ({ recordTaskEventSafe: boundary.forbidden }));

let reader, writer, cleanupStaleClaims, updateTask, claimTaskWithLease;
const ids = [];
const cleaner = 'owned-snapshot-cleaner';
let previousRunner, readerConnected = false, writerConnected = false;
beforeAll(async () => {
  previousRunner = process.env.BRAIN_RUNNER_ID;
  process.env.BRAIN_RUNNER_ID = cleaner;
  const config = privatePgConfig();
  reader = new pg.Client(config);
  writer = new pg.Client(config);
  await reader.connect();
  readerConnected = true;
  await verifyPrivatePg(reader);
  await writer.connect();
  writerConnected = true;
  boundary.writer = writer;
  ({ cleanupStaleClaims } = await import('../../startup-recovery.js'));
  ({ updateTask } = await import('../../actions.js'));
  ({ claimTaskWithLease } = await import('../../lib/task-lease.js'));
});
afterAll(async () => {
  try {
    if (writerConnected) await writer.query('ROLLBACK').catch(() => {});
    if (writerConnected && ids.length) {
      await writer.query('DELETE FROM tasks WHERE id=ANY($1::uuid[])', [ids]);
      expect((await writer.query('SELECT id FROM tasks WHERE id=ANY($1::uuid[])', [ids])).rows).toEqual([]);
    }
    expect(boundary.forbidden).not.toHaveBeenCalled();
  } finally {
    boundary.writer = null;
    if (readerConnected) await reader.end();
    if (writerConnected) await writer.end();
    if (previousRunner === undefined) delete process.env.BRAIN_RUNNER_ID;
    else process.env.BRAIN_RUNNER_ID = previousRunner;
  }
});
async function seed({ status = 'queued', owner = 'old-owned-runner', age = 120 } = {}) {
  const id = randomUUID();
  ids.push(id);
  await writer.query(`INSERT INTO tasks(id,title,status,task_type,priority,payload,result,claimed_by,claimed_at)
    VALUES($1,$2,$3,'research','P2','{}','{}',$4,
      CASE WHEN $5::int IS NULL THEN NULL ELSE NOW()-($5::int*INTERVAL '1 minute') END)`,
  [id, `stale-snapshot-${id}`, status, owner, age]);
  return id;
}
async function row(id) {
  return (await writer.query('SELECT status,claimed_by,claimed_at FROM tasks WHERE id=$1', [id])).rows[0];
}
it('真过期queued/paused被清，鲜活other/in_progress保持；原self-PID清理策略不变', async () => {
  const stale = await seed(), paused = await seed({ status: 'paused', age: null });
  const fresh = await seed({ age: 1 }), active = await seed({ status: 'in_progress' });
  const self = await seed({ owner: cleaner, age: 0 });
  const result = await cleanupStaleClaims(reader);
  expect(result).toEqual({ cleaned: 3, errors: [] });
  for (const id of [stale, paused, self]) expect(await row(id)).toMatchObject({ claimed_by: null, claimed_at: null });
  expect(await row(fresh)).toMatchObject({ claimed_by: 'old-owned-runner', status: 'queued' });
  expect(await row(active)).toMatchObject({ claimed_by: 'old-owned-runner', status: 'in_progress' });
  // 避免后续case拾取此有意保留的过期in_progress样本；只删本人IDs。
  await writer.query('DELETE FROM tasks WHERE id=ANY($1::uuid[])', [[stale, paused, fresh, active, self]]);
});

it.each(['new-owner', 'same-owner-new-time', 'now-in-progress', 'new-owner-lock-wait'])('过期SELECT后并发提交%s，清理不能覆盖新事实且cleaned=0', async change => {
  const id = await seed();
  let resume, selected;
  const ready = new Promise(resolve => { selected = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  const pending = cleanupStaleClaims({ query: async (sql, args) => {
    const result = await reader.query(sql, args);
    if (/SELECT id, claimed_by, claimed_at, status/.test(sql)) {
      selected(result.rows);
      await gate;
    }
    return result;
  } });
  let error, snapshot, before, settled = false;
  pending.then(() => { settled = true; });
  try {
    // 明确在实际SELECT完成后才提交另一连接事务；不是mock rows或定时猜测。
    snapshot = await Promise.race([ready, pending.then(() => { throw new Error('未到达实际过期SELECT'); })]);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].id).toBe(id);
    await writer.query('BEGIN');
    await writer.query("SET LOCAL statement_timeout='5s'");
    if (change === 'now-in-progress') {
      expect((await updateTask({ task_id: id, status: 'in_progress' })).success).toBe(true);
    } else {
      expect((await updateTask({ task_id: id, status: 'queued' })).success).toBe(true);
      const owner = change.startsWith('new-owner') ? 'new-owned-runner' : 'old-owned-runner';
      expect((await claimTaskWithLease(writer, { taskId: id, claimer: owner })).status).toBe(200);
    }
    if (change === 'new-owner-lock-wait') {
      resume(); // 清理UPDATE在另连接未提交的认领行上真实等待，再检验MVCC重验。
      let lock;
      for (let attempt = 0; attempt < 200; attempt++) {
        const state = (await writer.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1', [reader.processID])).rows[0];
        if (state?.wait_event_type === 'Lock') { lock = state; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(lock).toMatchObject({ wait_event_type: 'Lock', wait_event: 'transactionid' });
      expect(settled).toBe(false);
    }
    await writer.query('COMMIT');
    before = await row(id);
    expect(before.claimed_by).toBe(change.startsWith('new-owner') ? 'new-owned-runner' : 'old-owned-runner');
    expect(before.status).toBe(change === 'now-in-progress' ? 'in_progress' : 'queued');
    if (change !== 'now-in-progress') expect(before.claimed_at.getTime()).toBeGreaterThan(snapshot[0].claimed_at.getTime());
  } catch (caught) { error = caught; }
  finally { await writer.query('ROLLBACK').catch(() => {}); resume(); }
  const result = await pending;
  if (error) throw error;
  expect(result).toEqual({ cleaned: 0, errors: [] });
  expect(await row(id)).toEqual(before); // 独立数据库读回，不把rowCount或SQL字样当状态证明。
  await writer.query('DELETE FROM tasks WHERE id=$1', [id]);
}, 15000);
