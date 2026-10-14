import pg from 'pg';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../../db-config.js';
import { finalizeTask } from '../../task-terminal.js';
vi.mock('../../../db.js', () => ({ default: {} }));
import { acquireDeviceLock, releaseDeviceLocksHeldBy, sweepStaleDeviceLocks } from '../../../device-lock-helpers.js';

const ID = '44444444-4444-4444-8444-444444444444';
let client;
beforeEach(async () => {
  client = new pg.Client(DB_DEFAULTS);
  await client.connect();
  await client.query(`CREATE TEMP TABLE tasks (
    id uuid PRIMARY KEY, status text, payload jsonb, result jsonb,
    updated_at timestamptz, completed_at timestamptz,
    claimed_by text, claimed_at timestamptz
  )`);
  await client.query(`CREATE TEMP TABLE device_locks (
    device_name text PRIMARY KEY, locked_by text, locked_at timestamptz, expires_at timestamptz
  ); CREATE TEMP TABLE task_leases (task_id uuid, released_at timestamptz, lease_until timestamptz)`);
});

describe('Commander 未决清理的设备锁隔离', () => {
  async function locked(control, protocol = 'commander-v2') {
    await seed(control, protocol);
    await client.query("UPDATE tasks SET status='failed'");
    await client.query("INSERT INTO device_locks VALUES ('phone',$1,now()-interval '8 hours',now()-interval '1 hour')", [ID]);
  }
  it.each([
    { execution_stopped: false, delivery: { cleanup: { completed: true, evidence: ['readback'] } } },
    { execution_stopped: true, delivery: { cleanup: { completed: false, evidence: ['unknown'] } } },
    { execution_stopped: true, delivery: { cleanup: { completed: true, evidence: [] } } },
    { execution_stopped: true, delivery: { cleanup: { completed: true, evidence: {} } } },
  ])('任务失败和TTL过期不证明已停止/清理：%j', async control => {
    await locked(control);
    expect(await sweepStaleDeviceLocks(client)).toBe(0);
    expect(await releaseDeviceLocksHeldBy(ID, client)).toBe(0);
    expect((await acquireDeviceLock('another-owner', 'phone', 30, client)).result).toBe('locked');
    expect((await client.query('SELECT locked_by FROM device_locks')).rows[0].locked_by).toBe(ID);
  });
  it('官方停止和清理证据落账后可释放，旧任务失败仍正常回收', async () => {
    await locked({ execution_stopped: true, delivery: { cleanup: { completed: true, evidence: ['official-cleanup-readback'] } } });
    expect(await releaseDeviceLocksHeldBy(ID, client)).toBe(1);
    await client.query('TRUNCATE tasks,device_locks');
    await locked({}, 'legacy');
    expect(await sweepStaleDeviceLocks(client)).toBe(1);
  });
});
afterEach(async () => { await client?.end(); });

async function seed(control, protocol = 'commander-v2') {
  await client.query('INSERT INTO tasks VALUES ($1,$2,$3,$4,now(),NULL,$5,now())',
    [ID, 'in_progress', { commander_protocol: protocol },
      { workflow_control: control }, 'original-owner']);
}
async function finish(status) {
  const result = await finalizeTask(client, ID, status, { relay: false });
  const row = (await client.query('SELECT * FROM tasks WHERE id=$1', [ID])).rows[0];
  return { result, row };
}

describe('Commander 真实 SQL 终判门禁', () => {
  it.each(['FAIL', 'INCONCLUSIVE'])('最终 %s 可收失败账且保留未决清理事实', async verdict => {
    const control = { phase: 'final', verdict, terminal_status: 'failed', owner_epoch: 2,
      execution_stopped: false, cleanup: { completed: false, evidence: ['stop:unknown'] } };
    await seed(control);
    const { result, row } = await finish('failed');
    expect(result.rowCount).toBe(1);
    expect(row.status).toBe('failed');
    expect(row.claimed_by).toBeNull();
    expect(row.result.workflow_control).toEqual(control);
    expect(row.completed_at).toBeNull();
  });

  it.each([
    ['running', 'FAIL', 'failed', 'failed'],
    ['final', 'PASS', 'failed', 'failed'],
    ['final', 'FAIL', 'completed', 'failed'],
    ['final', 'FAIL', 'failed', 'completed'],
    ['final', 'INCONCLUSIVE', 'failed', 'completed'],
    ['final', 'FAIL', 'failed', 'archived'],
  ])('不接受错配 phase=%s verdict=%s declared=%s status=%s', async (phase, verdict, terminal_status, status) => {
    await seed({ phase, verdict, terminal_status });
    const { result, row } = await finish(status);
    expect(result.rowCount).toBe(0);
    expect(row.status).toBe('in_progress');
    expect(row.claimed_by).toBe('original-owner');
  });

  it('既有 final PASS 仍可完成，非 Commander 失败出口不退化', async () => {
    await seed({ phase: 'final', verdict: 'PASS' });
    expect((await finish('completed')).result.rowCount).toBe(1);
    await client.query('TRUNCATE tasks');
    await seed({}, 'legacy');
    expect((await finish('failed')).result.rowCount).toBe(1);
  });
});
