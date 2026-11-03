/** Watchdog 与 Kernel run 创建的精确身份/竞态真 PostgreSQL 回归。 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resumeStalledHarnessDrivers } from '../../harness-watchdog.js';
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
         orchestrator,router_version,route_reason,default_execution_profile,repo,evidence,
         direct_contract_seed,map_scope_validation_version
       ) VALUES (
         $1,$2,'integration',$3,'coding_mutation','bugfix','harness',
         'harness_initiative','["F0"]'::jsonb,true,
         'kernel-harness-v2','work-router-v1','integration','hotfix-v1','cecelia',$4::jsonb,
         $5::jsonb,'active-business-node-v1'
       )`,
      [receiptId, taskId, `watchdog-race:${taskId}`, JSON.stringify({
        branch: 'cp-watchdog-race-integration',
        base_sha: 'a'.repeat(40),
      }), JSON.stringify({
        contract_version: 'direct-profile-contract-seed/v1',
        title: `watchdog-kernel-identity-${taskId}`,
        objective: `watchdog-kernel-identity-${taskId}`,
        execution_profile: 'hotfix-v1',
      })],
    );
  }
  return { initiativeId, receiptId, taskId };
}

async function createRun({ initiativeId, taskId }) {
  const session=randomUUID(),runId=randomUUID();
  await testPool.query(`INSERT INTO kernel_controller_sessions(id,task_id,generation,source,status,lease_expires_at)
    VALUES($1,$2,1,'historical_reconstruction','active',NOW()+INTERVAL '30 minutes')`,[session,taskId]);
  await testPool.query(`INSERT INTO initiative_runs(id,initiative_id,current_task_id,phase,orchestrator_version,created_source,
    controller_session_id,controller_generation,controller_lease_expires_at,deadline_at)
    SELECT $1,$2,$3,'planning','v2','historical_reconstruction',id,generation,lease_expires_at,NOW()+INTERVAL '8 hours'
    FROM kernel_controller_sessions WHERE id=$4`,[runId,initiativeId,taskId,session]);
  await testPool.query('UPDATE kernel_controller_sessions SET run_id=$2 WHERE id=$1',[session,runId]);
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

});
