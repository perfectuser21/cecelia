import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const DB_URL = process.env.DB_URL;
const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`required environment missing: ${name}`);
  return value;
};
const CURRENT_TASK_ID = requireEnv('TASK_ID');
const CURRENT_RUN_ID = requireEnv('RUN_ID');
const REAL_JOURNEY_ID = requireEnv('REAL_JOURNEY_ID');
const REAL_GP_ID = requireEnv('REAL_GP_ID');
const REAL_STEP_ID = requireEnv('REAL_STEP_ID');

describe('P0 durable Kernel Fleet recovery contract [BEHAVIOR]', () => {
  it('built image self-contained profiles', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/fleet-release-contract.js'
    );
    await expect(mod.verifyBuiltBrainImage({
      image: process.env.CANDIDATE_BRAIN_IMAGE,
      expectedMachines: ['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1'],
      allowWorktreeMount: false,
    })).resolves.toMatchObject({ profileCount: 3, importOk: true });
  });

  it('immutable per-attempt profile snapshot across concurrent upgrade', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/fleet-release-contract.js'
    );
    const attempt = await mod.reserveAttemptFromCurrentProfile({
      databaseUrl: DB_URL,
      machine: 'us-mac-m4',
    });
    await mod.installProfileGeneration({
      databaseUrl: DB_URL,
      machine: 'us-mac-m4',
      generation: `${attempt.profileGeneration}-next`,
    });
    const loaded = await mod.loadAttemptReleaseSnapshot({
      databaseUrl: DB_URL,
      attemptId: attempt.attemptId,
    });
    expect(loaded).toMatchObject({
      profileGeneration: attempt.profileGeneration,
      runnerDigest: attempt.runnerDigest,
      workerGeneration: attempt.workerGeneration,
    });
  });

  it('real Worker Runner seam before Agent execution rejects unwritable stdout', async () => {
    const mod = await import(
      '../../../packages/brain/scripts/fleet-worker/real-runner-preflight-proof.cjs'
    );
    const proof = await mod.runRealWorkerStdoutPreflightProof({
      workerUrl: process.env.US_WORKER_URL,
      tokenFile: process.env.FLEET_TOKEN_FILE,
      runnerDigest: process.env.CANDIDATE_RUNNER_REF,
      mutation: 'runtime_stdout_unwritable',
      secretSentinel: process.env.SECRET_SENTINEL,
    });
    expect(proof.machineCode).toBe('attempt_stdout_not_writable');
    expect(proof.executionTransport).toBe('fleet-worker');
    expect(proof.attemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(proof.runnerImageId).toBe(process.env.CANDIDATE_RUNNER_REF);
    expect(proof.workerAttestation).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(proof.agentStartedCount).toBe(0);
    expect(proof.durableDiagnosticBytes).toBeGreaterThan(0);
    expect(proof.durableDiagnosticBytes).toBeLessThanOrEqual(2048);
    expect(proof.durableDiagnostic).not.toContain(process.env.SECRET_SENTINEL);
    expect(proof.runtimeResidualCount).toBe(0);
  });

  it('GitHub auth on success timeout crash and cancel is verified then revoked', async () => {
    const mod = await import(
      '../../../packages/brain/scripts/fleet-worker/github-auth-lifecycle-proof.cjs'
    );
    const proof = await mod.runAttemptScopedGitHubAuthLifecycleProof({
      workerUrl: process.env.US_WORKER_URL,
      tokenFile: process.env.FLEET_TOKEN_FILE,
      runnerDigest: process.env.CANDIDATE_RUNNER_REF,
      terminalPaths: ['success', 'timeout', 'crash', 'cancel'],
    });
    expect(proof.preAgentReceipt.signature).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(proof.preAgentReceipt.runnerImageId).toBe(process.env.CANDIDATE_RUNNER_REF);
    expect(proof.pushCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(proof.fetchedCommit).toBe(proof.pushCommit);
    for (const terminal of ['success', 'timeout', 'crash', 'cancel']) {
      expect(proof.terminalPaths[terminal].revocationReceipt).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(proof.terminalPaths[terminal].attemptCopyDeleted).toBe(true);
      expect(proof.terminalPaths[terminal].residueCount).toBe(0);
    }
    expect(proof.secretInEnvArgvLogCount).toBe(0);
  });

  it('adds fleet-worker transport with production upgrade rollback and source enum parity', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/fleet-release-contract.js'
    );
    const proof = await mod.verifyFleetWorkerTransportMigration({
      databaseUrl: DB_URL,
      minimumMigration: 367,
      preserveExisting: ['local-docker', 'remote-bridge'],
      add: 'fleet-worker',
    });
    expect(proof.productionUpgradeAccepted).toBe(true);
    expect(proof.rollbackRestoredPreviousConstraint).toBe(true);
    expect(proof.sourceSchemaEnumParity).toBe(true);
    expect(proof.manualSchemaDriftRequired).toBe(false);
  });

  it('ownership frame plus persisted heartbeat is required for a real child', async () => {
    const mod = await import(
      '../../../packages/brain/src/kernel-launch-readiness.js'
    );
    const child = spawn(process.execPath, [
      '-e',
      'process.send?.({type:"kernel-ready",ownership_nonce:process.env.NONCE});setInterval(()=>{},1000)',
    ], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, NONCE: 'contract-real-child' } });
    try {
      const receipt = await mod.awaitKernelReadiness({
        child,
        ownershipNonce: 'contract-real-child',
        databaseUrl: DB_URL,
        timeoutMs: 5000,
      });
      expect(receipt.ready).toBe(true);
      expect(receipt.initialHeartbeatPersisted).toBe(true);
      expect(receipt.pid).toBe(child.pid);
    } finally {
      child.kill('SIGTERM');
    }
  });

  it('authenticated callback commit before Worker cleanup is materialized and fetched', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/canonical-artifact-transfer.js'
    );
    const result = await mod.acceptSignedAttemptArtifact({
      databaseUrl: DB_URL,
      attemptId: process.env.REAL_ATTEMPT_ID,
      callbackEnvelopePath: process.env.SIGNED_CALLBACK_PATH,
      bundlePath: process.env.SIGNED_GIT_BUNDLE_PATH,
      controllerRepo: process.cwd(),
    });
    expect(result.signatureVerified).toBe(true);
    expect(result.taskOwnershipVerified).toBe(true);
    expect(result.fetchedCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.fetchedCommit).toBe(result.callbackArtifactSha);
    expect(result.branchHead).toBe(result.fetchedCommit);
    execFileSync('git', ['cat-file', '-e', `${result.fetchedCommit}^{commit}`], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });
    expect(Date.parse(result.cleanupAuthorizedAt))
      .toBeGreaterThanOrEqual(Date.parse(result.materializedAt));
    expect(result.cleanupAuthorized).toBe(true);
  });

  it('reverse cleanup removes real Runner nested and ignored output without broad mutation', async () => {
    const mod = await import(
      '../../../packages/brain/scripts/fleet-worker/reverse-cleanup-proof.cjs'
    );
    const proof = await mod.runExactRunnerCleanupProof({
      runnerDigest: process.env.CANDIDATE_RUNNER_REF,
      workerUrl: process.env.US_WORKER_URL,
      tokenFile: process.env.FLEET_TOKEN_FILE,
      createPaths: ['node_modules/pkg/cache', '.ignored/deep/file', 'dist/untracked/output'],
    });
    expect(proof.runnerWritesVerified).toBe(true);
    expect(proof.residualCount).toBe(0);
    expect(proof.quarantinedCount).toBe(0);
    expect(proof.sharedRootMutations).toEqual([]);
    expect(proof.preexistingAclRemoved).toBe(false);
  });

  it('ESRCH-only local liveness death keeps live and unknown host PID fail-open', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/kernel-liveness.js'
    );
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
    await expect(mod.classifyProcessLiveness({ pid: child.pid, host: mod.localHostId() }))
      .resolves.toEqual({ dead: false, reason: 'same_host_pid_live' });
    await expect(mod.classifyProcessLiveness({ pid: child.pid, host: 'unknown-remote-host' }))
      .resolves.toEqual({ dead: false, reason: 'liveness_unknown_fail_open' });
    child.kill('SIGTERM');
    await once(child, 'exit');
    await expect(mod.classifyProcessLiveness({ pid: child.pid, host: mod.localHostId() }))
      .resolves.toEqual({ dead: true, reason: 'same_host_pid_esrch' });
  });

  it('CI-only authorization and stale exact-head owner approval cannot merge', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/exact-head-owner-gate.js'
    );
    const audit = await mod.evaluateReleaseSequence({
      prNumber: Number(process.env.PR_NUMBER),
      expectedHead: process.env.PR_HEAD_SHA,
      requiredStages: ['ci', 'evaluator', 'judge', 'owner', 'merge', 'staging', 'production'],
    });
    expect(audit.autoMergeEnabled).toBe(false);
    expect(audit.requiredSequence).toEqual(['ci', 'evaluator', 'judge', 'owner', 'merge', 'staging', 'production']);
    expect(audit.observedSequence).toEqual(['ci', 'evaluator', 'judge']);
    expect(audit.mergeAuthorized).toBe(false);
    expect(audit.stagingMutationCount).toBe(0);
    expect(audit.productionMutationCount).toBe(0);
    expect(audit.staleHeadApprovalAccepted).toBe(false);
    expect(audit.productionBeforeMergeObserved).toBe(false);
  });

  it('P0 workflows enforce owner merge staging production order and reject bypasses', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/workflow-release-gate.js'
    );
    const proof = await mod.runP0WorkflowIntegration({
      repository: process.env.GITHUB_REPOSITORY,
      prNumber: Number(process.env.PR_NUMBER),
      exactHead: process.env.PR_HEAD_SHA,
      workflowFiles: [
        '.github/workflows/ci.yml',
        '.github/workflows/kernel-fleet-p0-gate.yml',
        '.github/workflows/brain-ci-deploy.yml',
        '.github/workflows/auto-staging-deploy.yml',
        '.github/workflows/deploy.yml',
      ],
      counterfactuals: [
        'ci_only',
        'stale_owner_head',
        'title_auto_merge',
        'main_push_production',
        'fast_lane',
        'staging_skipped',
        'staging_idle',
      ],
    });
    expect(proof.positive.eventOrder).toEqual([
      'ci',
      'evaluator',
      'judge',
      'owner',
      'merge',
      'staging_passed',
      'production_canary_started',
      'production_canary_passed',
    ]);
    expect(proof.positive.mergeHead).toBe(process.env.PR_HEAD_SHA);
    for (const mutation of proof.counterfactuals) {
      expect(mutation.exitCode).not.toBe(0);
      expect(mutation.unauthorizedMergeCount).toBe(0);
      expect(mutation.unauthorizedProductionCount).toBe(0);
    }
  });

  it('semantic anchor resolves journey golden-path step ownership and distinguishes task from run', async () => {
    const mod = await import('../../../packages/brain/src/anchor-check.js');
    const result = await mod.validateSemanticAnchor({
      databaseUrl: DB_URL,
      journeyId: REAL_JOURNEY_ID,
      goldenPathId: REAL_GP_ID,
      stepId: REAL_STEP_ID,
      taskId: CURRENT_TASK_ID,
      runId: CURRENT_RUN_ID,
    });
    expect(result).toMatchObject({ exists: true, ownershipMatches: true });
    expect(result.taskId).not.toBe(result.runId);
    expect(result.taskId).toBe(CURRENT_TASK_ID);
    expect(result.runId).toBe(CURRENT_RUN_ID);
    expect(result.journeyId).toBe(REAL_JOURNEY_ID);
    expect(result.goldenPathId).toBe(REAL_GP_ID);
    expect(result.stepId).toBe(REAL_STEP_ID);
  });
});
