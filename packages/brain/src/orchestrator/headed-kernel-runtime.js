import { createHash, randomUUID } from 'node:crypto';
import { createKernelRun, finalizeKernelRun } from './kernel-run-store.js';

async function createHeadedKernelAttempt(dbPool, {
  runId,
  task,
  worktreePath,
  branch,
  baseSha,
  provider,
}) {
  const attemptId = randomUUID();
  const callbackSecretHash = createHash('sha256')
    .update(`headed:${attemptId}:${randomUUID()}`)
    .digest('hex');
  const taskBundle = {
    contract_version: '1.0',
    run_id: runId,
    attempt_id: attemptId,
    role: 'planner',
    phase: 'planning',
    inputs: {
      task_id: task.id,
      workspace_spec: {
        repo: task.payload.repo,
        branch,
        base_sha: baseSha,
        worktree_path: worktreePath,
      },
    },
  };
  const result = await dbPool.query(
    `INSERT INTO harness_attempts (
       id, run_id, hop, phase, role, provider, task_bundle,
       callback_secret_hash, status, lease_owner, lease_expires_at,
       provider_session_id, logical_cycle_id, attempt_kind, workstream_key
     )
     VALUES (
       $1,$2,1,'planning','planner',$3,$4::jsonb,
       $5,'running',$6,NOW()+INTERVAL '8 hours',
       $7,$8,'initial','ws1'
     )
     RETURNING *`,
    [
      attemptId,
      runId,
      provider,
      JSON.stringify(taskBundle),
      callbackSecretHash,
      `headed:${attemptId}`,
      `headed:${attemptId}`,
      `headed:${runId}`,
    ],
  );
  return result.rows[0];
}

async function terminalizeLaunchFailure({ dbPool, deps, task, runId, error }) {
  const reason = `headed_kernel_launch_failed:${error}`;
  const finalizeRun = deps.finalizeRun ?? finalizeKernelRun;
  await finalizeRun(dbPool, {
    runId,
    expectedTaskId: task.id,
    outcome: 'failed',
    reason,
  });
  return {
    ok: false,
    mode: 'kernel-v1-headed',
    runId,
    error,
    terminalized: true,
  };
}

export async function spawnHeadedKernelRuntime({
  task,
  dbPool,
  initiativeId,
  deps,
  gear,
  spawnSession,
}) {
  const createRun = deps.createKernelRun ?? createKernelRun;
  const created = await createRun(dbPool, {
    taskId: task.id,
    initiativeId,
    phase: 'planning',
    journeyId: task.payload?.journey_id || null,
    abilityId: task.ability_id || task.payload?.ability_id || null,
    host: 'kernel-v1-headed',
    deadlineHours: 8,
    createdSource: 'kernel_dispatch',
    gear,
  });
  const runId = created.run?.id;
  if (!runId) throw new Error('kernel-v1 headed run authority returned no id');
  if (!created.created) {
    return {
      ok: false,
      mode: 'kernel-v1-headed',
      deferred: true,
      reason: 'kernel_run_exists',
      runId,
    };
  }

  const createAttempt = deps.createHeadedAttempt ?? ((input) => (
    createHeadedKernelAttempt(dbPool, input)
  ));
  try {
    const result = await spawnSession({ runId, createAttempt });
    if (result.ok) return result;
    return {
      ...await terminalizeLaunchFailure({
        dbPool,
        deps,
        task,
        runId,
        error: result.error,
      }),
      ...result,
      mode: 'kernel-v1-headed',
      runId,
      terminalized: true,
    };
  } catch (error) {
    return terminalizeLaunchFailure({
      dbPool,
      deps,
      task,
      runId,
      error: error.message,
    });
  }
}
