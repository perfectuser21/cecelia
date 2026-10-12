// F1 step1：真实领单租约跨 watchdog 边界，保证有头执行者不会被旧 stale 扫描清除。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { taskLeaseFixture, seedTask } from '../../../packages/brain/src/__tests__/helpers/task-lease-pg-fixture.js';
import { claimTaskWithLease } from '../../../packages/brain/src/lib/task-lease.js';
import { resumeStalledHarnessDrivers } from '../../../packages/brain/src/harness-watchdog.js';

let fx;
beforeEach(async () => {
  fx = await taskLeaseFixture();
  await fx.pool.query(`
    ALTER TABLE tasks ADD COLUMN blocked_at TIMESTAMPTZ,
      ADD COLUMN driver_heartbeat_at TIMESTAMPTZ, ADD COLUMN execution_attempts INT DEFAULT 0;
    CREATE TABLE initiative_runs(id UUID, initiative_id UUID, current_task_id UUID,
      orchestrator_version TEXT, phase TEXT, completed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
    CREATE TABLE initiative_run_events(initiative_id UUID, ts DOUBLE PRECISION);`);
});
afterEach(async () => { if (fx) await fx.close(); fx = null; });

async function staleHeadedTask() {
  const id = await seedTask(fx.pool, { task_type: 'harness_initiative', payload: { orchestrator: 'skill-relay' } });
  await claimTaskWithLease(fx.pool, { taskId: id, claimer: 'codex-active', executorKind: 'headed-session', leaseSeconds: 14400 });
  await fx.pool.query(`UPDATE tasks SET status='in_progress', claimed_at=NOW()-INTERVAL '90 minutes' WHERE id=$1`, [id]);
  return id;
}
const scan = pool => resumeStalledHarnessDrivers({ pool, maxFreshStarts: 3, execFn: () => '' });
const row = async id => (await fx.pool.query('SELECT status,claimed_by FROM tasks WHERE id=$1', [id])).rows[0];

describe.sequential('有效租约保护无 initiative_runs 的有头会话（真实 PG）', () => {
  it('开工已超 grace，但同 owner 租约有效时不清 claim、不降级', async () => {
    const id = await staleHeadedTask();
    await scan(fx.pool);
    expect(await row(id)).toEqual({ status: 'in_progress', claimed_by: 'codex-active' });
  });
  it.each(['expired', 'released', 'foreign'])('%s 租约不能保护真正陈旧的 claim', async mode => {
    const id = await staleHeadedTask();
    const set = { expired: "lease_until=NOW()-INTERVAL '1 minute'", released: 'released_at=NOW()', foreign: "claimer='someone-else'" }[mode];
    await fx.pool.query(`UPDATE task_leases SET ${set} WHERE task_id=$1`, [id]);
    await scan(fx.pool);
    expect(await row(id)).toEqual({ status: 'blocked', claimed_by: null });
  });
  it('候选扫描后续租，事务内重查有效租约仍保住 claim', async () => {
    const id = await staleHeadedTask();
    await fx.pool.query("UPDATE task_leases SET lease_until=NOW()-INTERVAL '1 minute' WHERE task_id=$1", [id]);
    const pool = {
      query: (...args) => fx.pool.query(...args),
      connect: async () => {
        await fx.pool.query("UPDATE task_leases SET lease_until=NOW()+INTERVAL '4 hours' WHERE task_id=$1", [id]);
        return fx.pool.connect();
      },
    };
    await scan(pool);
    expect(await row(id)).toEqual({ status: 'in_progress', claimed_by: 'codex-active' });
  });
});
