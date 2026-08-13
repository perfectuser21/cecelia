import { execFileSync } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';

import { createAttemptStore } from '../../src/orchestrator/attempt-store.js';
import {
  createDetachedLauncher,
  createDispatcher,
} from '../../src/orchestrator/dispatcher.js';
import { createWorkspaceSpecResolver } from '../../src/orchestrator/workspace-spec.js';
import { validateWorkRoutingIdentity } from '../../src/routes/work-routing.js';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertImplementationBaseline({ repoRoot, sourceRevision, baselineSha }) {
  invariant(/^[a-f0-9]{40}$/.test(baselineSha), 'BASELINE_SHA must be a 40-character Git SHA');
  try {
    execFileSync(
      'git',
      ['-C', repoRoot, 'merge-base', '--is-ancestor', baselineSha, sourceRevision],
      { stdio: 'ignore' },
    );
  } catch {
    throw new Error(`BASELINE_SHA ${baselineSha} is not an ancestor of ${sourceRevision}`);
  }
}

function fakeSmokeSkill(name) {
  return Object.freeze({
    name,
    version: 'smoke-v1',
    digest: `sha256:${'a'.repeat(64)}`,
    content: 'Scratch smoke only: prove canonical routing reaches the Runner action gate.',
  });
}

async function runRunnerActionGate({ repoRoot, env }) {
  const entrypoint = await readFile(
    new URL('../../../../docker/cecelia-runner/entrypoint.sh', import.meta.url),
    'utf8',
  );
  const actionGate = entrypoint.match(
    /# routing-action-gate:start([\s\S]*?)# routing-action-gate:end/,
  )?.[1];
  invariant(actionGate?.includes('install_routing_action_gate'),
    'Runner install_routing_action_gate block is absent');
  execFileSync('/bin/bash', ['-c', `set -euo pipefail\n${actionGate}\ninstall_routing_action_gate`], {
    cwd: repoRoot,
    env: { ...process.env, ...env, WORKTREE_PATH: repoRoot },
    stdio: 'pipe',
  });
  const lockPath = `${repoRoot}/.dev-lock.${env.CECELIA_BRANCH}`;
  try {
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    invariant(lock.task_id === env.CECELIA_TASK_ID, 'Runner lock task identity mismatch');
    invariant(lock.routing_receipt_id === env.CECELIA_ROUTING_RECEIPT_ID,
      'Runner lock receipt identity mismatch');
    invariant(lock.run_id === env.CECELIA_RUN_ID, 'Runner lock run identity mismatch');
    invariant(lock.repo === env.CECELIA_REPO, 'Runner lock repo identity mismatch');
    invariant(lock.branch === env.CECELIA_BRANCH, 'Runner lock branch identity mismatch');
    invariant(lock.base_sha === env.CECELIA_BASE_SHA, 'Runner lock baseline identity mismatch');
  } finally {
    await unlink(lockPath).catch(() => {});
  }
}

export async function dispatchSmokeKernelAttempt({
  pool,
  task,
  run,
  repoRoot,
  branch,
  sourceRevision,
}) {
  await pool.query(
    `UPDATE tasks
        SET payload = COALESCE(payload, '{}'::jsonb)
          || jsonb_build_object(
               'worktree_path',$2::text,
               'base_repo','perfectuser21/cecelia',
               'sprint_dir','sprints/08122220-unified-work-router',
               'branch',$3::text,
               'base_sha',$4::text
             )
      WHERE id=$1`,
    [task.id, repoRoot, branch, sourceRevision],
  );
  const taskRow = (await pool.query('SELECT * FROM tasks WHERE id=$1', [task.id])).rows[0];
  const receipt = (await pool.query(
    'SELECT *,false AS superseded FROM work_routing_receipts WHERE task_id=$1',
    [task.id],
  )).rows[0];
  invariant(receipt, 'Dispatcher smoke receipt is absent');

  const attemptStore = createAttemptStore(pool);
  const detachedLauncher = createDetachedLauncher({
    attemptStore,
    leaseOwner: 'uwr-scratch-smoke',
    machineId: 'us-mac-m4',
    removeContainer: async () => false,
    spawnDetached: async ({ containerId, env }) => {
      await runRunnerActionGate({ repoRoot, env });
      return { containerId };
    },
  });
  const pendingLaunches = new Map();
  const smokeTransport = {
    async prepare(input) {
      pendingLaunches.set(input.attempt.id, input);
      return {
        actualMachineId: input.target.machine,
        executionTransport: 'fleet-worker',
        remoteJobId: `uwr-smoke-${input.attempt.id}`,
        attestationStatus: 'verified',
        containerId: null,
        jobId: `uwr-smoke-${input.attempt.id}`,
      };
    },
    async start({ attempt }) {
      const input = pendingLaunches.get(attempt.id);
      invariant(input, `prepared smoke launch is absent for ${attempt.id}`);
      await detachedLauncher.launch({
        ...input,
        attempt,
        leaseClaimed: true,
        bundle: {
          ...input.bundle,
          inputs: { ...input.bundle.inputs, worktree_path: repoRoot },
        },
      });
      return { status: 'running', attempt_id: attempt.id };
    },
    async cancel() { return { status: 'missing' }; },
  };
  const adapter = {
    name: 'codex',
    start: ({ bundle }) => ({
      provider: 'codex', args: [], stdin: JSON.stringify({ task_bundle: bundle }), env: {},
    }),
  };
  const dispatch = createDispatcher({
    db: pool,
    attemptStore,
    registry: { resolve: () => adapter },
    launcher: smokeTransport,
    loadSkill: fakeSmokeSkill,
    machineId: 'us-mac-m4',
    leaseOwner: 'uwr-scratch-smoke',
    resolveWorkspaceSpec: createWorkspaceSpecResolver({
      resolveRepoHead: async () => sourceRevision,
    }),
  });
  const result = await dispatch('spawn:planner', {
    taskId: task.id,
    runId: run.id,
    hop: 1,
    observed: {
      task: taskRow,
      run,
      routingReceipt: receipt,
      contract: { approved: false, row: null, artifacts: [] },
      pr: null,
      prdExists: false,
    },
    decision: { phase: 'plan', reason: 'scratch_dispatch_contract' },
  });
  invariant(result.status === 'LAUNCHED' && result.attempt_id,
    `Dispatcher did not launch a real Attempt: ${JSON.stringify(result)}`);
  const attempt = (await pool.query(
    `SELECT id,run_id,hop,role,status,task_bundle,execution_transport,
            actual_machine_id,machine_attestation_status
       FROM harness_attempts WHERE id=$1`,
    [result.attempt_id],
  )).rows[0];
  invariant(attempt?.role === 'planner' && attempt.status === 'starting',
    'real Dispatcher Attempt did not reach starting');
  invariant(attempt.execution_transport === 'fleet-worker'
    && attempt.machine_attestation_status === 'verified',
  'real Dispatcher Attempt lacks an attested Fleet receipt');
  const identity = attempt.task_bundle?.inputs?.routing_identity;
  const workspace = attempt.task_bundle?.inputs?.workspace_spec;
  try {
    const validated = await validateWorkRoutingIdentity(pool, {
      task_id: task.id,
      routing_receipt_id: identity?.routing_receipt_id,
      run_id: run.id,
      repo: identity?.repo,
      branch: workspace?.branch,
      base_sha: workspace?.base_sha,
    });
    invariant(validated.status === 200 && validated.body?.valid === true,
      `canonical action API rejected live Attempt: ${validated.body?.reason_code}`);
  } finally {
    await attemptStore.fail(attempt.id, {
      code: 'scratch_smoke_complete',
      message: 'Dispatcher, Attempt and Runner action gate contract verified',
    }, {
      leaseOwner: 'uwr-scratch-smoke',
      leaseGeneration: 0,
    });
  }
  return attempt;
}
