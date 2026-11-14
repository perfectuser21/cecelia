import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { taskLeaseFixture, seedTask } from '../helpers/task-lease-pg-fixture.js';
import { claimTaskWithLease, heartbeatTaskLease, reapExpiredLeases } from '../../lib/task-lease.js';

let fx, pool;
const owner = 'same-worker-instance';
const claim = taskId => claimTaskWithLease(pool, { taskId, claimer: owner, executorKind: 'external-worker', leaseSeconds: 120, onExpire: 'fail', start: true });
const seed = () => seedTask(pool, { task_type: 'content-pipeline', executor_kind: 'external-worker' });
const expire = id => pool.query("UPDATE task_leases SET lease_until=clock_timestamp()-INTERVAL '2 minutes' WHERE task_id=$1", [id]);
const task = async id => (await pool.query('SELECT * FROM tasks WHERE id=$1', [id])).rows[0];
const lease = async id => (await pool.query('SELECT * FROM task_leases WHERE task_id=$1', [id])).rows[0];
const afterTransition = async () => {};
beforeEach(async () => { fx = await taskLeaseFixture(); pool = fx.pool; });
afterEach(async () => { if (fx) await fx.close(); fx = null; });

const afterSnapshot = action => ({
  connect: () => pool.connect(),
  query: async (sql, args) => {
    const out = await pool.query(sql, args);
    if (sql.includes('LIMIT 50') && sql.includes('FROM task_leases l LEFT JOIN tasks t')) await action();
    return out;
  },
});

describe.sequential('expired lease snapshot race uses locked current identity', () => {
  it('snapshot race: a new same-owner claim must not be failed or have its device lock released', async () => {
    const id = await seed(); const original = (await claim(id)).body.claim_epoch;
    await expire(id);
    await pool.query("INSERT INTO device_locks(device_name,locked_by,locked_at,expires_at) VALUES('test-phone',$1,NOW(),NOW()+INTERVAL '10 minutes')", [id]);
    let current;
    const r = await reapExpiredLeases(afterSnapshot(async () => {
      await pool.query("UPDATE tasks SET claimed_by=NULL,claimed_at=NULL,status='queued' WHERE id=$1", [id]);
      current = (await claim(id)).body.claim_epoch;
    }), { afterTransition });
    expect(current).not.toBe(original); expect(r.failed).toBe(0); expect(r.requeued).toBe(0);
    expect((await task(id)).status).toBe('in_progress'); expect((await lease(id)).released_at).toBeNull();
    expect((await pool.query("SELECT locked_by FROM device_locks WHERE device_name='test-phone'")).rows[0].locked_by).toBe(id);
  });

  it('snapshot race: a lease renewed after scanning is not disposed using the old expiration', async () => {
    const id = await seed(); await claim(id); await expire(id);
    const r = await reapExpiredLeases(afterSnapshot(async () => {
      // This simulates an already-in-flight renewal that committed before the reaper obtains its task/lease locks.
      await pool.query("UPDATE task_leases SET lease_until=clock_timestamp()+INTERVAL '2 minutes' WHERE task_id=$1", [id]);
    }), { afterTransition });
    expect(r.failed).toBe(0); expect(r.requeued).toBe(0); expect(r.skipped).toBe(1);
    expect((await task(id)).status).toBe('in_progress'); expect((await lease(id)).released_at).toBeNull();
  });

  it('unchanged expired external task fails through the normal public terminal path', async () => {
    const id = await seed(); await claim(id); await expire(id);
    const r = await reapExpiredLeases(pool, { afterTransition });
    expect(r.failed).toBe(1); expect((await task(id)).status).toBe('failed');
    expect((await lease(id)).released_at).toBeTruthy();
  });

  it('a heartbeat cannot resurrect an already expired external lease', async () => {
    const id = await seed(); const epoch = (await claim(id)).body.claim_epoch; await expire(id);
    expect((await heartbeatTaskLease(pool, { taskId: id, claimer: owner, claimEpoch: epoch })).ok).toBe(false);
    expect((await reapExpiredLeases(pool, { afterTransition })).failed).toBe(1);
  });
});
