import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

const DB_URL = process.env.DB_URL;

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

  it('pins an immutable per-attempt profile snapshot across concurrent upgrade', async () => {
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

  it('rejects unwritable stdout at the real Worker Runner seam before Agent execution', async () => {
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
    expect(proof.agentStartedCount).toBe(0);
    expect(proof.durableDiagnosticBytes).toBeGreaterThan(0);
    expect(proof.durableDiagnosticBytes).toBeLessThanOrEqual(2048);
    expect(proof.durableDiagnostic).not.toContain(process.env.SECRET_SENTINEL);
    expect(proof.runtimeResidualCount).toBe(0);
  });

  it('revokes attempt-scoped GitHub auth on success timeout crash and cancel', async () => {
    const mod = await import(
      '../../../packages/brain/scripts/fleet-worker/github-auth-lifecycle-proof.cjs'
    );
    const proof = await mod.runAttemptScopedGitHubAuthLifecycleProof({
      workerUrl: process.env.US_WORKER_URL,
      tokenFile: process.env.FLEET_TOKEN_FILE,
      runnerDigest: process.env.CANDIDATE_RUNNER_REF,
      terminalPaths: ['success', 'timeout', 'crash', 'cancel'],
    });
    expect(proof.preAgentDeliveryVerified).toBe(true);
    expect(proof.ghAuthAndPushFetchVerified).toBe(true);
    expect(proof.terminalPaths).toEqual({
      success: { revoked: true, attemptCopyDeleted: true, residueCount: 0 },
      timeout: { revoked: true, attemptCopyDeleted: true, residueCount: 0 },
      crash: { revoked: true, attemptCopyDeleted: true, residueCount: 0 },
      cancel: { revoked: true, attemptCopyDeleted: true, residueCount: 0 },
    });
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

  it('launches a real child and requires ownership frame plus persisted heartbeat', async () => {
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

  it('materializes an authenticated callback commit before Worker cleanup', async () => {
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

  it('uses ESRCH-only local liveness death and fails open for live or unknown host PID', async () => {
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

  it('rejects CI-only authorization and stale exact-head owner approval', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/exact-head-owner-gate.js'
    );
    const audit = await mod.evaluateReleaseSequence({
      prNumber: Number(process.env.PR_NUMBER),
      expectedHead: process.env.PR_HEAD_SHA,
      requiredStages: ['ci', 'evaluator', 'judge', 'owner', 'merge', 'staging', 'production'],
    });
    expect(audit.autoMergeEnabled).toBe(false);
    expect(audit.sequence).toEqual(['ci', 'evaluator', 'judge', 'owner', 'merge', 'staging', 'production']);
    expect(audit.staleHeadApprovalAccepted).toBe(false);
    expect(audit.productionBeforeMergeObserved).toBe(false);
  });

  it('semantic anchor resolves journey golden-path step ownership and distinguishes task from run', async () => {
    const mod = await import('../../../packages/brain/src/anchor-check.js');
    const result = await mod.validateSemanticAnchor({
      databaseUrl: DB_URL,
      journeyId: process.env.REAL_JOURNEY_ID,
      goldenPathId: process.env.REAL_GP_ID,
      stepId: process.env.REAL_STEP_ID,
      taskId: process.env.TASK_ID,
      runId: process.env.RUN_ID,
    });
    expect(result).toMatchObject({ exists: true, ownershipMatches: true });
    expect(result.taskId).not.toBe(result.runId);
    expect(result.taskId).toBe('4a530430-00c5-46bc-8a4f-c0ec38025391');
    expect(result.journeyId).toBe('2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6');
    expect(result.goldenPathId).toBe('4e5fd7eb-3823-4c57-a817-081b7fdd2eed');
    expect(result.stepId).toBe('817f59f5-02ff-4a70-bd81-f7ae65f77e02');
  });
});
