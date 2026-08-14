/** Watchdog 与 Kernel run 创建的精确身份/竞态真 PostgreSQL 回归。 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resumeStalledHarnessDrivers } from '../../harness-watchdog.js';
import { createKernelRun } from '../../orchestrator/kernel-run-store.js';
import { createKernelLeasePgFixture } from './kernel-controller-lease-renewal.pg-fixture.js';

const fixture = createKernelLeasePgFixture();
let testPool;

async function seedTask({ initiativeId = randomUUID(), withRouting = false } = {}) {
  const taskId = randomUUID();
  const receiptId = randomUUID();
  await testPool.query(
    `INSERT INTO tasks (
       id, title, status, priority, task_type, trigger_source,
       claimed_by, claimed_at, payload
     ) VALUES (
       $1, $2, 'in_progress', 'P2', 'harness_initiative', 'api',
       'watchdog-race-fixture', NOW() - INTERVAL '2 hours', $3::jsonb
     )`,
    [taskId, `watchdog-kernel-identity-${taskId}`, JSON.stringify({
      initiative_id: initiativeId,
      ...(withRouting ? {
        routing_receipt_id: receiptId,
        work_kind: 'coding_mutation',
        change_kind: 'bugfix',
        repo: 'cecelia',
        harness_runtime: 'kernel-v1',
      } : {}),
    })],
  );
  if (withRouting) {
    await testPool.query(
      `INSERT INTO work_routing_receipts (
         id,task_id,source,source_id,work_kind,change_kind,pipeline,
         canonical_task_type,map_scope,impact_contract_required,
         orchestrator,router_version,route_reason,default_execution_profile,repo,evidence
       ) VALUES (
         $1,$2,'integration',$3,'coding_mutation','bugfix','harness',
         'harness_initiative','["F0"]'::jsonb,true,
         'kernel-harness-v2','work-router-v1','integration','hotfix-v1','cecelia',$4::jsonb
       )`,
      [receiptId, taskId, `watchdog-race:${taskId}`, JSON.stringify({
        branch: 'cp-watchdog-race-integration',
        base_sha: 'a'.repeat(40),
      })],
    );
  }
  return { initiativeId, receiptId, taskId };
}

async function createRun({ initiativeId, taskId }) {
  return createKernelRun(testPool, {
    taskId,
    initiativeId,
    phase: 'planning',
    journeyId: null,
    abilityId: null,
    host: 'kernel-watchdog-integration',
    deadlineHours: 8,
    createdSource: 'kernel_dispatch',
  }, {
    controllerSessionIdFactory: randomUUID,
    ensureMapImpactPreflight: async () => ({
      contract: { id: randomUUID(), status: 'active' },
      recovery_contract: null,
    }),
  });
}

async function waitForBlockedTaskLock() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows: [row] } = await testPool.query(
      `SELECT count(*)::int AS blocked
         FROM pg_stat_activity
        WHERE datname=current_database()
          AND wait_event_type='Lock'
          AND cardinality(pg_blocking_pids(pid)) > 0
          AND query LIKE '%FROM tasks%'
          AND query LIKE '%FOR UPDATE%'`,
    );
    if (row.blocked > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('createKernelRun did not reach the blocked task lock');
}

beforeAll(async () => {
  await fixture.createIsolatedDatabase();
  testPool = fixture.pool();
}, 60_000);

afterAll(() => fixture.dropIsolatedDatabase(), 30_000);

describe('Watchdog Kernel 精确身份与创建竞态（真 PostgreSQL）', () => {
  it('v1 与历史无 current_task 的 legacy v2 都按 task initiative 身份受保护', async () => {
    const v1 = await seedTask();
    const legacyV2 = await seedTask();
    await testPool.query(
      `INSERT INTO initiative_runs (initiative_id, phase, orchestrator_version, deadline_at)
       VALUES
         ($1, 'A_planning', 'v1', NOW() + INTERVAL '8 hours'),
         ($2, 'done', 'v1', NOW() + INTERVAL '8 hours')`,
      [v1.taskId, legacyV2.taskId],
    );
    await testPool.query(
      `UPDATE initiative_runs
          SET orchestrator_version='v2'
        WHERE initiative_id=$1
          AND current_task_id IS NULL`,
      [legacyV2.taskId],
    );

    const result = await resumeStalledHarnessDrivers({
      pool: testPool,
      execFn: () => '',
      maxFreshStarts: 3,
    });

    const { rows } = await testPool.query(
      'SELECT id,status FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id',
      [[v1.taskId, legacyV2.taskId]],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'in_progress')).toBe(true);
    expect(result.resumed).not.toContain(v1.taskId);
    expect(result.resumed).not.toContain(legacyV2.taskId);
  });

  it('共享 initiative 的 sibling v2 run 不会保护无 exact run 的 task', async () => {
    const initiativeId = randomUUID();
    const sibling = await seedTask({ initiativeId, withRouting: true });
    await createRun(sibling);
    const target = await seedTask({ initiativeId });

    const result = await resumeStalledHarnessDrivers({
      pool: testPool,
      execFn: () => '',
      maxFreshStarts: 3,
    });

    const { rows: [targetRow] } = await testPool.query(
      'SELECT status, claimed_at FROM tasks WHERE id=$1',
      [target.taskId],
    );
    const { rows: [siblingRow] } = await testPool.query(
      'SELECT status FROM tasks WHERE id=$1',
      [sibling.taskId],
    );
    expect(targetRow).toMatchObject({ status: 'failed', claimed_at: null });
    expect(siblingRow.status).toBe('in_progress');
    expect(result.resumed).toContain(target.taskId);
    expect(result.resumed).not.toContain(sibling.taskId);
  });

  it('createKernelRun 在 Watchdog 锁前提交后，二次 exact-run 复核保护健康任务', async () => {
    const target = await seedTask({ withRouting: true });
    let releaseWatchdogLock;
    let signalWatchdogAtLock;
    const watchdogAtLock = new Promise((resolve) => { signalWatchdogAtLock = resolve; });
    const allowWatchdogLock = new Promise((resolve) => { releaseWatchdogLock = resolve; });
    const watchdogPool = {
      query: (...args) => testPool.query(...args),
      async connect() {
        const client = await testPool.connect();
        return {
          release: () => client.release(),
          async query(sql, params) {
            if (/FROM\s+tasks[\s\S]*FOR\s+UPDATE/i.test(String(sql))) {
              signalWatchdogAtLock();
              await allowWatchdogLock;
            }
            return client.query(sql, params);
          },
        };
      },
    };

    const watchdog = resumeStalledHarnessDrivers({
      pool: watchdogPool,
      execFn: () => '',
      maxFreshStarts: 3,
    });
    await watchdogAtLock;
    const created = await createRun(target);
    releaseWatchdogLock();
    const result = await watchdog;

    const { rows: [task] } = await testPool.query(
      'SELECT status, claimed_at FROM tasks WHERE id=$1',
      [target.taskId],
    );
    expect(created.created).toBe(true);
    expect(created.run.current_task_id).toBe(target.taskId);
    expect(task.status).toBe('in_progress');
    expect(task.claimed_at).not.toBeNull();
    expect(result.resumed).not.toContain(target.taskId);
  });

  it('Watchdog 已持 task 锁时 createKernelRun 等待，判死提交后不得创建 active run', async () => {
    const target = await seedTask({ withRouting: true });
    let releaseWatchdogAfterLock;
    let signalWatchdogLocked;
    const watchdogLocked = new Promise((resolve) => { signalWatchdogLocked = resolve; });
    const allowWatchdogContinue = new Promise((resolve) => {
      releaseWatchdogAfterLock = resolve;
    });
    const watchdogPool = {
      query: (...args) => testPool.query(...args),
      async connect() {
        const client = await testPool.connect();
        return {
          release: () => client.release(),
          async query(sql, params) {
            const result = await client.query(sql, params);
            if (/FROM\s+tasks[\s\S]*FOR\s+UPDATE/i.test(String(sql))) {
              signalWatchdogLocked();
              await allowWatchdogContinue;
            }
            return result;
          },
        };
      },
    };

    const watchdog = resumeStalledHarnessDrivers({
      pool: watchdogPool,
      execFn: () => '',
      maxFreshStarts: 3,
    });
    await watchdogLocked;
    const createOutcome = createRun(target).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    );
    await waitForBlockedTaskLock();
    releaseWatchdogAfterLock();

    const [watchdogResult, created] = await Promise.all([watchdog, createOutcome]);
    const { rows: [task] } = await testPool.query(
      'SELECT status, claimed_at FROM tasks WHERE id=$1',
      [target.taskId],
    );
    const { rows: [runCount] } = await testPool.query(
      `SELECT count(*)::int AS count
         FROM initiative_runs
        WHERE orchestrator_version='v2' AND current_task_id=$1`,
      [target.taskId],
    );

    expect(watchdogResult.resumed).toContain(target.taskId);
    expect(task).toMatchObject({ status: 'failed', claimed_at: null });
    expect(created.value).toBeNull();
    expect(created.error?.message).toMatch(/not eligible/);
    expect(runCount.count).toBe(0);
  });
});
