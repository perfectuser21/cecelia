import { createHash, randomUUID } from 'node:crypto';

import { createAttemptStore } from '../../../orchestrator/attempt-store.js';
import { createDispatcher } from '../../../orchestrator/dispatcher.js';
import { persistPlannerRecoveryReceipt } from '../../../orchestrator/planner-recovery-receipt-store.js';
import { seedOwnedActiveV2Run } from './controller-authority-fixture.js';

const CONTENT = '# Exact planner PRD\n\nServer-owned bytes.\n';
const REPO = 'perfectuser21/cecelia';
const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function seedPlannerRecoveryCallback(pool, overrides = {}) {
  const taskId = overrides.taskId ?? randomUUID();
  const runId = overrides.runId ?? randomUUID();
  const attemptId = overrides.attemptId ?? randomUUID();
  const sprintDir = `sprints/recovery-${attemptId.slice(0, 8)}`;
  const prdPath = `${sprintDir}/sprint-prd.md`;
  const branch = `cp-harness-prd-${attemptId.slice(0, 8)}-a1`;
  const changedFiles = [prdPath];
  const exactEvidence = Object.freeze({
    repo: REPO,
    base_sha: BASE_SHA,
    head_sha: HEAD_SHA,
    prd_path: prdPath,
    resolved_branch: branch,
    content: CONTENT,
    content_sha256: sha256(Buffer.from(CONTENT)),
    byte_length: Buffer.byteLength(CONTENT),
    changed_files: Object.freeze(changedFiles),
    changed_files_digest: sha256(JSON.stringify(changedFiles)),
    verification_method: 'remote_exact_commit_blob',
    verified_at: '2026-08-15T00:00:00.000Z',
  });
  const result = {
    status: 'completed',
    summary: 'planner finished',
    artifacts: [],
    checks: [],
    decision: null,
    error: null,
    provider_metadata: { provider: 'codex', session_id: `planner-${attemptId}` },
    server_verification: {
      planner_recovery_receipt: {
        head_sha: HEAD_SHA,
        content_sha256: exactEvidence.content_sha256,
        byte_length: exactEvidence.byte_length,
        changed_files_digest: exactEvidence.changed_files_digest,
        verification_method: exactEvidence.verification_method,
      },
    },
  };
  if (!overrides.taskAlreadyExists) {
    await pool.query(
      "INSERT INTO tasks(id,title,status) VALUES($1,$2,'in_progress')",
      [taskId, `planner recovery ${taskId}`],
    );
  }
  await seedOwnedActiveV2Run(pool, {
    runId,
    taskId,
    phase: 'planning',
    initiativeId: overrides.initiativeId,
  });
  await pool.query(
    `INSERT INTO harness_attempts(
       id,run_id,hop,phase,role,provider,task_bundle,status,
       callback_secret_hash,lease_owner,lease_generation,lease_expires_at,
       requested_machine_id,actual_machine_id,execution_transport,
       remote_job_id,machine_attestation_status
     ) VALUES(
       $1,$2,1,'planning','planner','codex',$3::jsonb,'running',
       $4,'worker:planner-recovery',3,NOW()+INTERVAL '5 minutes',
       'xian-mac-m4','xian-mac-m4','fleet-worker',$5,'verified'
     )`,
    [
      attemptId,
      runId,
      JSON.stringify({ inputs: {
        task_id: taskId,
        sprint_dir: sprintDir,
        planner_branch: branch,
        workspace_spec: { repo: REPO, base_sha: BASE_SHA },
      } }),
      'd'.repeat(64),
      `remote-${attemptId}`,
    ],
  );
  return {
    taskId,
    runId,
    attemptId,
    exactEvidence,
    result,
    store: createAttemptStore(pool),
    callback: (beforeCommit = (client, hook) => persistPlannerRecoveryReceipt(client, {
      terminalAttempt: hook.attempt,
      result: hook.result,
      exactEvidence,
    })) => createAttemptStore(pool).recordCallbackTerminal({
      attemptId,
      runId,
      leaseOwner: 'worker:planner-recovery',
      leaseGeneration: 3,
      result,
      beforeCommit,
    }),
  };
}

export function receiptInsertValues(fixture, overrides = {}) {
  const { exactEvidence: evidence } = fixture;
  return [
    overrides.predecessorRunId ?? fixture.runId,
    overrides.sourceTaskId ?? fixture.taskId,
    overrides.plannerAttemptId ?? fixture.attemptId,
    overrides.attemptHop ?? 1,
    overrides.leaseGeneration ?? 3,
    evidence.repo,
    evidence.base_sha,
    evidence.head_sha,
    evidence.prd_path,
    evidence.resolved_branch,
    evidence.content,
    evidence.content_sha256,
    evidence.byte_length,
    JSON.stringify(evidence.changed_files),
    evidence.changed_files_digest,
    evidence.verification_method,
    evidence.verified_at,
  ];
}

export const DIRECT_INSERT_SQL = `INSERT INTO planner_recovery_receipts(
  predecessor_run_id,source_task_id,planner_attempt_id,attempt_hop,lease_generation,
  repo,base_sha,head_sha,prd_path,resolved_branch,content,content_sha256,byte_length,
  changed_files,changed_files_digest,verification_method,verified_at
) VALUES(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::timestamptz
)`;

export async function dispatchPlannerRecoveryProposer({ observed, taskId, runId }) {
  const attemptId = randomUUID();
  let created;
  const attemptStore = {
    createAttempt: async (input) => {
      created = input;
      return { id: input.id, ...input, task_bundle: input.bundle };
    },
    markStarting: async (id) => ({
      id,
      status: 'starting',
      lease_owner: 'planner-recovery-pg:1',
      lease_generation: 0,
    }),
    recordLaunchReceipt: async (id, receipt) => ({ id, status: 'starting', ...receipt }),
    fail: async () => {},
    listFailedExecutionTargets: async () => [],
  };
  const result = await createDispatcher({
    attemptStore,
    registry: { resolve: () => ({
      name: 'codex',
      start: () => ({ provider: 'codex', command: 'codex', args: ['exec'], stdin: '{}' }),
    }) },
    launcher: {
      prepare: async () => ({
        actualMachineId: 'brain-pg',
        executionTransport: 'fleet-worker',
        remoteJobId: 'planner-recovery-proposer',
        attestationStatus: 'verified',
        containerId: null,
        jobId: 'planner-recovery-proposer',
      }),
      start: async ({ attempt }) => ({ status: 'running', attempt_id: attempt.id }),
    },
    loadSkill: (name) => ({
      name,
      version: '1.0.0',
      digest: `sha256:${'a'.repeat(64)}`,
      content: `${name} integration instructions`,
    }),
    randomUUID: () => attemptId,
    createCallbackSecret: () => 'planner-recovery-integration-secret',
    machineId: 'brain-pg',
    leaseOwner: 'planner-recovery-pg:1',
    resolveWorkspaceSpec: async () => ({
      repo: observed.plannerPrdArtifact.repo,
      base_sha: observed.routingReceipt.evidence.base_sha,
      branch: observed.routingReceipt.evidence.branch,
      expected_head_sha: null,
      mode: 'read-write',
      run_id: runId,
      attempt_id: attemptId,
    }),
  })('spawn:proposer', {
    taskId,
    runId,
    hop: 1,
    observed,
    decision: { phase: 'gan', reason: 'immutable_planner_receipt' },
  });
  return { result, created };
}
