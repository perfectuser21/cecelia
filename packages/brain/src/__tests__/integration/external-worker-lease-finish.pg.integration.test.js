import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { taskLeaseFixture, seedTask } from '../helpers/task-lease-pg-fixture.js';
import { claimTaskWithLease, heartbeatTaskLease, releaseTaskLease } from '../../lib/task-lease.js';
import { finishTaskLease } from '../../lib/task-lease-finish.js';

let fx, pool;
const worker = 'zj-worker-instance-1';
const afterTransition = vi.fn(async () => {});
const row = async id => (await pool.query('SELECT * FROM tasks WHERE id=$1', [id])).rows[0];
const lease = async id => (await pool.query('SELECT * FROM task_leases WHERE task_id=$1', [id])).rows[0];
const seed = fields => seedTask(pool, { task_type: 'content-pipeline', executor_kind: 'external-worker', ...fields });
const claim = id => claimTaskWithLease(pool, { taskId: id, claimer: worker, executorKind: 'external-worker', start: true, leaseSeconds: 120, onExpire: 'fail' });
const finish = (id, epoch, overrides = {}) => finishTaskLease(pool, {
  taskId: id, claimer: worker, claimEpoch: epoch, status: 'completed', result: { artifact: 'local-output/manifest.json' }, ...overrides,
}, { afterTransition });
beforeEach(async () => { fx = await taskLeaseFixture(); pool = fx.pool; afterTransition.mockClear(); });
afterEach(async () => { if (fx) await fx.close(); fx = null; });

describe.sequential('external business worker: actual PG owner/epoch/terminal transaction', () => {
  it('claim returns server epoch at native PG precision; heartbeat and finish preserve independent result namespace', async () => {
    const id = await seed();
    const c = await claim(id);
    expect(c.status).toBe(200);
    const exact = (await pool.query('SELECT claimed_at::text AS epoch FROM tasks WHERE id=$1', [id])).rows[0].epoch;
    expect(c.body.claim_epoch).toBe(exact);
    expect((await heartbeatTaskLease(pool, { taskId: id, claimer: worker, claimEpoch: exact, leaseSeconds: 180 })).ok).toBe(true);
    const r = await finish(id, exact, { result: { workflow_control: { phase: 'fake' }, count: 2 } });
    expect(r).toMatchObject({ status: 200, body: { ok: true, replayed: false } });
    expect((await row(id)).result).toEqual({ external_execution: { workflow_control: { phase: 'fake' }, count: 2 }, lease_receipt: r.body.receipt });
    expect((await row(id)).claimed_by).toBeNull();
    expect((await lease(id)).released_at).toBeTruthy();
    expect(afterTransition).toHaveBeenCalledOnce();
    // Hook observes committed facts through another pooled connection.
    expect((await row(id)).status).toBe('completed');
  });

  it('microseconds distinguish claims even when JS Date would round both to the same millisecond', async () => {
    const id = await seed(); await claim(id);
    const a = '2026-11-14 10:00:00.123001+00';
    const b = '2026-11-14 10:00:00.123999+00';
    expect(new Date(a).getTime()).toBe(new Date(b).getTime());
    await pool.query('UPDATE tasks SET claimed_at=$2::timestamptz WHERE id=$1', [id, b]);
    await pool.query('UPDATE task_leases SET claimed_at=$2::timestamptz WHERE task_id=$1', [id, b]);
    expect((await finish(id, a)).status).toBe(409);
    expect((await heartbeatTaskLease(pool, { taskId: id, claimer: worker, claimEpoch: a })).ok).toBe(false);
    expect((await finish(id, b)).status).toBe(200);
  });

  it('same owner old epoch cannot finish a newly claimed task', async () => {
    const id = await seed(); const old = (await claim(id)).body.claim_epoch;
    await pool.query("UPDATE tasks SET status='queued',claimed_by=NULL,claimed_at=NULL WHERE id=$1", [id]);
    const current = (await claim(id)).body.claim_epoch;
    expect(current).not.toBe(old);
    expect((await finish(id, old)).status).toBe(409);
    expect((await finish(id, current)).status).toBe(200);
  });

  it('missing epoch cannot heartbeat or release external lease; old epoch cannot release same-owner new claim', async () => {
    const id = await seed(); const old = (await claim(id)).body.claim_epoch;
    expect((await heartbeatTaskLease(pool, { taskId: id, claimer: worker })).ok).toBe(false);
    expect((await releaseTaskLease(pool, { taskId: id, claimer: worker })).released).toBe(false);
    await pool.query("UPDATE tasks SET status='queued',claimed_by=NULL,claimed_at=NULL WHERE id=$1", [id]);
    const current = (await claim(id)).body.claim_epoch;
    expect((await releaseTaskLease(pool, { taskId: id, claimer: worker, claimEpoch: old })).released).toBe(false);
    expect((await releaseTaskLease(pool, { taskId: id, claimer: worker, claimEpoch: current })).released).toBe(true);
  });

  it('same canonical result retry is idempotent; altered status/result is rejected', async () => {
    const id = await seed(); const epoch = (await claim(id)).body.claim_epoch;
    const first = await finish(id, epoch, { result: { z: 2, a: { b: 1 } } });
    const alternateEpoch = (await pool.query(`SELECT to_char(claimed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS epoch FROM task_leases WHERE task_id=$1`, [id])).rows[0].epoch;
    const retry = await finish(id, alternateEpoch, { result: { a: { b: 1 }, z: 2 } });
    expect(first.body.replayed).toBe(false); expect(retry.body.replayed).toBe(true);
    expect(retry.body.receipt).toEqual(first.body.receipt);
    expect((await finish(id, epoch, { result: { z: 3 } })).status).toBe(409);
    expect((await finish(id, epoch, { status: 'failed', result: { z: 2, a: { b: 1 } } })).status).toBe(409);
    expect(afterTransition).toHaveBeenCalledOnce();
  });

  it('post-commit follow-up failure is not reported as failure of the already committed business receipt', async () => {
    const id = await seed(); const epoch = (await claim(id)).body.claim_epoch;
    const r = await finishTaskLease(pool, { taskId: id, claimer: worker, claimEpoch: epoch, status: 'completed', result: {} },
      { afterTransition: async () => { throw Error('isolated follow-up unavailable'); } });
    expect(r.status).toBe(200); expect((await row(id)).status).toBe('completed');
    expect((await finish(id, epoch, { result: {} })).body.replayed).toBe(true);
  });

  it('concurrent same-epoch finish writes once and returns an idempotent replay', async () => {
    const id = await seed(); const epoch = (await claim(id)).body.claim_epoch;
    const results = await Promise.all([finish(id, epoch), finish(id, epoch)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(results.map(r => r.body.replayed).sort()).toEqual([false, true]);
    expect(afterTransition).toHaveBeenCalledOnce();
  });

  it.each(['wrong-owner', 'expired', 'released', 'cancelled', 'claim-epoch-mismatch'])('%s cannot finish or revive a lease', async mode => {
    const id = await seed(); const epoch = (await claim(id)).body.claim_epoch;
    if (mode === 'expired') await pool.query("UPDATE task_leases SET lease_until=NOW()-INTERVAL '1 second' WHERE task_id=$1", [id]);
    if (mode === 'released') await pool.query('UPDATE task_leases SET released_at=NOW() WHERE task_id=$1', [id]);
    if (mode === 'cancelled') await pool.query("UPDATE tasks SET status='cancelled' WHERE id=$1", [id]);
    if (mode === 'claim-epoch-mismatch') await pool.query("UPDATE task_leases SET claimed_at=claimed_at-INTERVAL '1 microsecond' WHERE task_id=$1", [id]);
    const who = mode === 'wrong-owner' ? 'another-worker' : worker;
    expect((await finish(id, epoch, { claimer: who })).status).toBe(409);
    expect((await heartbeatTaskLease(pool, { taskId: id, claimer: who, claimEpoch: epoch })).ok).toBe(false);
    expect((await row(id)).status).toBe(mode === 'cancelled' ? 'cancelled' : 'in_progress');
    expect(afterTransition).not.toHaveBeenCalled();
  });

  it.each(['dev', 'coding_workflow', 'workflow_run'])('cannot complete protected/non-external type %s using an external executor label', async task_type => {
    const id = await seed({ task_type }); const epoch = (await claim(id)).body.claim_epoch;
    expect((await finish(id, epoch)).status).toBe(409);
    expect((await row(id)).status).toBe('in_progress');
  });

  it('Commander/common-runner authority cannot be supplied through an otherwise valid external task', async () => {
    const id = await seed(); const epoch = (await claim(id)).body.claim_epoch;
    await pool.query("UPDATE tasks SET result='{" + '"workflow_common_runner":{}' + "}'::jsonb WHERE id=$1", [id]);
    expect((await finish(id, epoch)).status).toBe(409);
    expect((await row(id)).status).toBe('in_progress');
  });

  it('failure while releasing lease rolls back task, result and hook', async () => {
    const id = await seed(); const epoch = (await claim(id)).body.claim_epoch;
    await pool.query(`CREATE FUNCTION deny_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.released_at IS NOT NULL THEN RAISE EXCEPTION 'release unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER deny_release BEFORE UPDATE ON task_leases FOR EACH ROW EXECUTE FUNCTION deny_release();`);
    await expect(finish(id, epoch)).rejects.toThrow('release unavailable');
    expect((await row(id)).status).toBe('in_progress'); expect((await row(id)).result).toBeNull();
    expect((await lease(id)).released_at).toBeNull(); expect(afterTransition).not.toHaveBeenCalled();
  });

  it('finish and cancellation serialize on task identity; cancellation winner cannot be overwritten', async () => {
    const id = await seed(); const epoch = (await claim(id)).body.claim_epoch;
    const blocker = await pool.connect(); await blocker.query('BEGIN');
    await blocker.query("UPDATE tasks SET status='cancelled' WHERE id=$1", [id]);
    const running = finish(id, epoch);
    await blocker.query('COMMIT'); blocker.release();
    expect((await running).status).toBe(409); expect((await row(id)).status).toBe('cancelled');
  });

  it('heartbeat race with finish never reopens completed lease', async () => {
    const id = await seed(); const epoch = (await claim(id)).body.claim_epoch;
    const [done] = await Promise.all([finish(id, epoch), heartbeatTaskLease(pool, { taskId: id, claimer: worker, claimEpoch: epoch, leaseSeconds: 120 })]);
    expect(done.status).toBe(200); expect((await row(id)).status).toBe('completed');
    expect((await lease(id)).released_at).toBeTruthy();
    expect((await heartbeatTaskLease(pool, { taskId: id, claimer: worker, claimEpoch: epoch })).ok).toBe(false);
  });
});
