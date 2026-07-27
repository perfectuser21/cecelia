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
const CURRENT_ATTEMPT_ID = requireEnv('ATTEMPT_ID');
const CURRENT_CONTRACT_SHA = requireEnv('CONTRACT_SHA');
const REAL_JOURNEY_ID = requireEnv('REAL_JOURNEY_ID');
const REAL_GP_ID = requireEnv('REAL_GP_ID');
const REAL_STEP_ID = requireEnv('REAL_STEP_ID');
const LOCAL_HOST_ID = requireEnv('LOCAL_HOST_ID');

describe('P0 durable Kernel Fleet recovery contract [BEHAVIOR]', () => {
  it('built image self-contained profiles', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/fleet-release-contract.js'
    );
    await expect(mod.verifyBuiltBrainImage({
      image: process.env.CANDIDATE_BRAIN_IMAGE,
      expectedMachines: ['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1'],
      allowWorktreeMount: false,
      network: 'none',
      readOnlyRoot: true,
      importUrl: 'file:///app/src/orchestrator/run.js',
      requiredConsumers: [
        'smoke-glob-runner',
        'ci-real-env-smoke',
        'brain-deploy-pre-swap',
        'brain-rollback-pre-start',
      ],
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
    const ownerMod = await import(
      '../../../packages/brain/src/kernel-controller-ownership.js'
    );
    const owner = await ownerMod.ensureKernelController({
      databaseUrl: DB_URL,
      runId: CURRENT_RUN_ID,
      contender: 'contract-owner-a',
    });
    const raced = await Promise.all([
      ownerMod.ensureKernelController({ databaseUrl: DB_URL, runId: CURRENT_RUN_ID, contender: 'startup-sync' }),
      ownerMod.ensureKernelController({ databaseUrl: DB_URL, runId: CURRENT_RUN_ID, contender: 'watchdog' }),
      ownerMod.ensureKernelController({ databaseUrl: DB_URL, runId: CURRENT_RUN_ID, contender: 'manual' }),
    ]);
    expect(new Set(raced.map((x) => `${x.ownerId}:${x.generation}`)).size).toBe(1);
    const child = spawn(process.execPath, [
      '-e',
      'process.send?.({type:"kernel-ready",ownership_nonce:process.env.NONCE});setInterval(()=>{},1000)',
    ], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, NONCE: 'contract-real-child' } });
    try {
      const receipt = await mod.awaitKernelReadiness({
        child,
        ownershipNonce: 'contract-real-child',
        databaseUrl: DB_URL,
        controllerOwnerId: owner.ownerId,
        controllerGeneration: owner.generation,
        timeoutMs: 5000,
      });
      expect(receipt.ready).toBe(true);
      expect(receipt.initialHeartbeatPersisted).toBe(true);
      expect(receipt.pid).toBe(child.pid);
      await expect(ownerMod.writeFencedHeartbeat({
        databaseUrl: DB_URL,
        runId: CURRENT_RUN_ID,
        ownerId: owner.ownerId,
        generation: owner.generation - 1,
      })).rejects.toThrow(/stale_controller_generation/);
      const blocked = await ownerMod.runRecoverableInfrastructureBlockProof({
        databaseUrl: DB_URL,
        runId: CURRENT_RUN_ID,
        reasons: ['node_not_base_admitted', 'execution_transport_unavailable'],
      });
      expect(blocked.semanticBlockedStreak).toBe(0);
      expect(blocked.semanticNoProgressStreak).toBe(0);
      expect(blocked.runStatus).not.toBe('failed');
      expect(blocked.recoveredOwnerCount).toBe(1);
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
      workerOwnedControlFiles: ['runtime/task-bundle.json'],
      terminalRaces: ['terminal', 'cancel', 'docker.wait', 'startup-reconcile'],
      restartBeforeCleanup: true,
      legacyAttempt: true,
    });
    expect(proof.runnerWritesVerified).toBe(true);
    expect(proof.precreateHelperBeforeDocker).toBe(true);
    expect(proof.precreateHelperFailureDockerCreateCount).toBe(0);
    expect(proof.attemptAcl).toMatchObject({
      rwRoots: ['workspace', 'admin', 'runtime'],
      sharedRootWrite: false,
      inherited: true,
    });
    expect(proof.containerAbsenceConfirmedBeforeNormalize).toBe(true);
    expect(proof.cleanupOrder).toEqual([
      'container_absent',
      'reverse_normalize',
      'workspace_admin_cleanup',
      'runtime_secret_cleanup',
      'state_delete',
    ]);
    expect(proof.residualCount).toBe(0);
    expect(proof.quarantinedCount).toBe(0);
    expect(proof.sharedRootMutations).toEqual([]);
    expect(proof.preexistingAclRemoved).toBe(false);
    expect(proof.workerControlFilesNormalized).toBe(false);
    expect(proof.idempotentOutcomes).toEqual(['clean', 'already_clean', 'already_clean', 'already_clean']);
    expect(proof.duplicateQuarantineCount).toBe(0);
    expect(proof.pathAttackResults).toMatchObject({
      symlink: 'rejected',
      outOfRoot: 'rejected',
      wrongUuid: 'rejected',
      groupMismatch: 'rejected',
    });
    expect(proof.failureForensics.firstReceiptOverwritten).toBe(false);
    expect(proof.failureForensics.statusSurvivesRestart).toBe(true);
    expect(proof.failureForensics.normalizerFailureHostCleanupAttempted).toBe(true);
    expect(proof.failureForensics.quarantineIncludes)
      .toEqual(['workspace', 'admin', 'runtime', 'state']);
    expect(proof.failureForensics.firstReceiptPath).toBe(
      proof.failureForensics.stateIndexedReceiptPath
    );
  });

  it('ESRCH-only local liveness death keeps live and unknown host PID fail-open', async () => {
    const mod = await import(
      '../../../packages/brain/src/lib/kernel-liveness.js'
    );
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
    const task = { id: CURRENT_TASK_ID, payload: { harness_runtime: 'kernel-v1' } };
    const liveRun = {
      id: CURRENT_RUN_ID,
      orchestrator_pid: child.pid,
      orchestrator_host: LOCAL_HOST_ID,
      orchestrator_heartbeat_at: new Date(0),
    };
    await expect(mod.assessKernelLiveness({
      task, run: liveRun, hostFn: () => LOCAL_HOST_ID,
    })).resolves.toMatchObject({ verdict: 'alive', reason: 'pid_alive' });
    await expect(mod.assessKernelLiveness({
      task, run: { ...liveRun, orchestrator_host: 'unknown-remote-host' },
      hostFn: () => LOCAL_HOST_ID,
    })).resolves.toMatchObject({ verdict: 'unknown', reason: 'host_mismatch' });
    child.kill('SIGTERM');
    await once(child, 'exit');
    await expect(mod.assessKernelLiveness({
      task, run: liveRun, hostFn: () => LOCAL_HOST_ID,
    })).resolves.toMatchObject({ verdict: 'dead', reason: 'pid_gone' });
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
    expect(audit.p0ClassificationSource).toBe('signed_task_pr_receipt');
    expect(audit.titleOrLabelCanChangeClassification).toBe(false);
    expect(audit.requiredCheck).toMatchObject({
      headSha: process.env.PR_HEAD_SHA,
      ownerSignatureVerified: true,
      repositoryRulesSnapshotVerified: true,
    });
    expect(audit.branchProtection).toMatchObject({
      approvingReviewCount: 1,
      dismissStaleReviews: true,
      requireLastPushApproval: true,
      enforceAdmins: true,
    });
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
        'title_changed',
        'label_removed',
        'old_harness_green',
        'missing_owner_receipt',
        'alternate_merge_actor',
        'direct_admin_write',
        'title_auto_merge',
        'main_push_production',
        'fast_lane',
        'staging_skipped',
        'staging_idle',
        'remote_disabled',
        'callback_missing',
        'callback_unreachable',
        'unattested_rollback_image',
      ],
    });
    expect(proof.positive.eventOrder).toEqual([
      'ci',
      'evaluator',
      'judge',
      'owner',
      'merge',
      'worker_admitted',
      'brain_published',
      'staging_passed',
      'production_canary_started',
      'production_canary_passed',
    ]);
    expect(proof.positive.mergeHead).toBe(process.env.PR_HEAD_SHA);
    expect(proof.positive.candidateServingStateBefore)
      .toEqual(proof.positive.candidateServingStateAfter);
    expect(proof.positive.callbackValidatedFromRealRunner).toBe(true);
    expect(proof.positive.cleanupResidualCount).toBe(0);
    for (const mutation of proof.counterfactuals) {
      expect(mutation.exitCode).not.toBe(0);
      expect(mutation.unauthorizedMergeCount).toBe(0);
      expect(mutation.unauthorizedProductionCount).toBe(0);
      expect(mutation.semanticAttemptAllocatedCount).toBe(0);
    }
  });

  it('semantic anchor resolves journey golden-path step ownership and distinguishes task from run', async () => {
    const mod = await import('../../../packages/brain/src/anchor-check.js');
    expect(CURRENT_RUN_ID).toBe('fda8bfd7-fbbc-4260-a657-ea7f3b51bd16');
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
    const mutations = await mod.verifyRunBindingCounterfactuals({
      databaseUrl: DB_URL,
      taskId: CURRENT_TASK_ID,
      runId: CURRENT_RUN_ID,
      attemptId: CURRENT_ATTEMPT_ID,
      contractSha: CURRENT_CONTRACT_SHA,
      headSha: requireEnv('PR_HEAD_SHA'),
      historicalFailedRunId: '4bbe35de-63c1-4cfe-9b55-fea8c01a0647',
      cases: [
        'terminal_historical_run',
        'task_id_as_run_id',
        'taskbundle_receipt_run_mismatch',
        'stale_contract_round',
        'stale_head',
        'cross_run_artifact',
        'cross_run_result',
      ],
    });
    for (const mutation of mutations) {
      expect(mutation.accepted).toBe(false);
      expect(mutation.semanticBudgetDelta).toBe(0);
      expect(mutation.ganBudgetDelta).toBe(0);
      expect(mutation.historicalReceiptMutated).toBe(false);
    }
  });

  it('attempt scoped result channel ignores stale source and binds exact callback receipt', async () => {
    const mod = await import(
      '../../../packages/brain/scripts/fleet-worker/result-channel-proof.cjs'
    );
    const proof = await mod.runRealResultChannelProof({
      workerUrl: process.env.US_WORKER_URL,
      tokenFile: process.env.FLEET_TOKEN_FILE,
      runnerDigest: process.env.CANDIDATE_RUNNER_REF,
      role: 'reviewer',
      workspaceMode: 'read-only',
      exactHead: process.env.PR_HEAD_SHA,
      taskId: CURRENT_TASK_ID,
      runId: CURRENT_RUN_ID,
      mutations: [
        'missing',
        'erofs',
        'wrong_attempt',
        'wrong_run',
        'wrong_role',
        'wrong_contract_sha',
        'wrong_head',
        'symlink',
        'oversize',
        'malformed',
      ],
      terminalPaths: ['success', 'timeout', 'crash', 'cancel'],
    });
    expect(proof.positive.injectedEnvName).toBe('BRAIN_RESULT_FILE');
    expect(proof.positive.pathUnderAttemptRuntime).toBe(true);
    expect(proof.positive.sourceStaleResultIgnored).toBe(true);
    expect(proof.positive.readOnlyWorkspaceWriteSucceeded).toBe(true);
    expect(proof.positive.receiptPersistedBeforeCleanup).toBe(true);
    expect(proof.positive.receipt).toMatchObject({
      attemptId: proof.positive.attemptId,
      runId: CURRENT_RUN_ID,
      role: 'reviewer',
      headSha: process.env.PR_HEAD_SHA,
    });
    expect(proof.positive.receipt.resultSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    for (const mutation of proof.mutations) {
      expect(mutation.accepted).toBe(false);
      expect(mutation.machineCode).toMatch(/^result_channel_/);
      expect(mutation.semanticBudgetDelta).toBe(0);
      expect(mutation.ganBudgetDelta).toBe(0);
      expect(mutation.diagnosticBytes).toBeGreaterThan(0);
      expect(mutation.diagnosticBytes).toBeLessThanOrEqual(2048);
    }
    for (const terminal of ['success', 'timeout', 'crash', 'cancel']) {
      expect(proof.terminalPaths[terminal].durableReceiptKept).toBe(true);
      expect(proof.terminalPaths[terminal].resultResidualCount).toBe(0);
      expect(proof.terminalPaths[terminal].credentialResidualCount).toBe(0);
    }
  });

  it('canonical S0-S12 by eleven elements manifest has no implicit gray cells', async () => {
    const mod = await import(
      '../../../packages/brain/src/lib/kernel-harness-lifecycle.js'
    );
    const proof = await mod.verifyCanonicalLifecycleManifest({
      databaseUrl: DB_URL,
      manifestPath: 'packages/brain/config/kernel-harness-lifecycle-s0-s12.json',
      regressionContractPath: 'regression-contract.yaml',
      exactHead: process.env.PR_HEAD_SHA,
      canonicalElements: [
        'FR', 'NFR', 'Invariant', '判定点', '保质期', '死亡告警',
        '失败语义', '效果确认', '输入对抗面', '账本保鲜', '两轴衔接',
      ],
    });
    expect(proof.stageIds).toEqual([
      'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6',
      'S7', 'S8', 'S9', 'S10', 'S11', 'S12',
    ]);
    expect(proof.stages).toMatchObject([
      { id: 'S0', stepId: '4540991e-17ca-4f31-a318-8ab18f856b31', name: 'Task Born', promise: '每个任务有稳定身份、来源、仓库、环境、风险和锚点' },
      { id: 'S1', stepId: 'a5ce672f-2202-4eae-a74d-2da323dc64ff', name: 'Intent / PrepPRD', promise: '用户意图、成功标准、真实旅程和依赖被冻结' },
      { id: 'S2', stepId: 'c5bae104-da5e-483d-b5ea-c295c90a3f28', name: 'Planner', promise: '计划覆盖 FR/NFR/Invariant/真实 E2E，范围足够薄' },
      { id: 'S3', stepId: 'd6dcdfaf-4b98-4717-bbe3-522f03f70757', name: 'Contract GAN', promise: '对抗审核后的合同可执行且批准后不可偷改' },
      { id: 'S4', stepId: '0cdadc1a-e3a0-46a1-8333-ebbc102883f7', name: 'Generator', promise: '在受控工作树先 Red 后 Green，创建 Harness-owned PR' },
      { id: 'S5', stepId: 'f12be1d5-ae65-4813-b2d8-cfde24ac5ac6', name: 'CI', promise: '客观检查全绿，只产证据，不持有 Harness merge 权' },
      { id: 'S6', stepId: '1a738e05-99a7-421c-a52d-c2bb80bf19be', name: 'Evaluator', promise: '新 session 真跑合同、反作弊和真实 E2E' },
      { id: 'S7', stepId: '9a8b4080-97f5-46a0-848e-6428ac881d1b', name: 'Independent Judge', promise: '独立复核 Evaluator 证据并给最终机器裁决' },
      { id: 'S8', stepId: 'de269b2e-46aa-4d5a-afea-1bc4558b0fef', name: 'Risk-based Human Review', promise: '首次/高风险变更在 merge 前由主理人查看' },
      { id: 'S9', stepId: 'd6f3c80a-5e48-4058-b7e5-f972f1a23ee1', name: 'Merge', promise: '只有唯一 Merge Authority 在全部门禁满足后合并' },
      { id: 'S10', stepId: '004993cf-01ff-422d-b45a-14328361279b', name: 'Staging', promise: '部署并验证刚合并的精确 artifact' },
      { id: 'S11', stepId: '0e7a817c-d8ef-4f9a-8561-4300fe6b547a', name: 'Production', promise: '按发布策略 promote、验活并留回滚锚点' },
      { id: 'S12', stepId: '4d0ed49c-4949-4e8b-90f3-6840d58f39fe', name: 'Report / Learning / Complete', promise: '更新承诺地图、回归、学习和外部状态后才收账' },
    ]);
    for (const mutation of proof.stageIdentityCounterfactuals) {
      expect(['rename', 'merge', 'split', 'shift', 'insert']).toContain(mutation.kind);
      expect(mutation.parityAccepted).toBe(false);
    }
    expect(proof.elementCount).toBe(11);
    expect(proof.cellCount).toBe(143);
    expect(proof.grayCount).toBe(0);
    expect(proof.nullStateCount).toBe(0);
    expect(proof.manifestSha).toBe(proof.databaseManifestSha);
    expect(proof.manifestSha).toBe(proof.regressionContractManifestSha);
    expect(proof.manifestSha).toBe(proof.runtimeReportManifestSha);
    for (const cell of proof.cells) {
      expect(['pass', 'na_with_reason', 'typed_pending', 'typed_blocked'])
        .toContain(cell.state);
      expect(cell.owner).toBeTruthy();
      expect(cell.construct).toBeTruthy();
      expect(cell.positiveOracle).toBeTruthy();
      expect(cell.violationOracle).toBeTruthy();
      expect(cell.recoveryOracle).toBeTruthy();
      expect(cell.failureSemantics).toBeTruthy();
      expect(cell.effectConfirmation).toBeTruthy();
    }
  });

  it('lifecycle migration upgrades existing F1 rows in place and rolls back provenance', async () => {
    const mod = await import(
      '../../../packages/brain/src/lib/kernel-harness-lifecycle.js'
    );
    const proof = await mod.runLifecycleMigrationProof({
      databaseUrl: DB_URL,
      minimumMigration: 368,
      provenance: {
        pullRequest: 4372,
        branch: 'cp-07271751-51836fb2',
        sha: '4dc3b69a',
      },
      rejectMigrationNumber: 366,
      modes: ['fresh', 'production_like'],
    });
    expect(proof.existingF1JourneyCountBefore).toBe(1);
    expect(proof.existingF1JourneyCountAfter).toBe(1);
    expect(proof.legacySixRowsUpgradedInPlace).toBe(true);
    expect(proof.secondJourneyCreated).toBe(false);
    expect(proof.migrationNumber).toBeGreaterThanOrEqual(368);
    expect(proof.migration366Untouched).toBe(true);
    expect(proof.upgrade.schemaParity).toBe(true);
    expect(proof.rollback.priorRowsRestored).toBe(true);
    expect(proof.rollback.priorConstraintsRestored).toBe(true);
    expect(proof.rollback.evidenceLostCount).toBe(0);
    expect(proof.rollback.provenanceRestored).toBe(true);
  });

  it('S0 born through S12 terminal accounting consumes authenticated stage receipts', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/kernel-harness-lifecycle.js'
    );
    const proof = await mod.runRealLifecycleReceiptProof({
      databaseUrl: DB_URL,
      repository: process.env.GITHUB_REPOSITORY,
      taskId: CURRENT_TASK_ID,
      runId: CURRENT_RUN_ID,
      exactHead: process.env.PR_HEAD_SHA,
      productAnchor: {
        journeyId: REAL_JOURNEY_ID,
        goldenPathId: REAL_GP_ID,
        stepId: REAL_STEP_ID,
      },
      lifecycleSsotRef: 'kernel_harness_f1_baseline/S0-S12',
    });
    expect(proof.stageOrder).toEqual([
      'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6',
      'S7', 'S8', 'S9', 'S10', 'S11', 'S12',
    ]);
    expect(proof.receipts.S0.type).toBe('task_born_receipt');
    expect(proof.receipts.S1.type).toBe('intent_receipt');
    expect(proof.receipts.S2.type).toBe('planner_artifact_receipt');
    expect(proof.receipts.S2.plannerArtifactSha).toMatch(/^[0-9a-f]{40}$/);
    expect(proof.receipts.S3.type).toBe('contract_approval_receipt');
    expect(proof.receipts.S3.contractApprovalSignature).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(proof.receipts.S4.type).toBe('generator_draft_pr_receipt');
    expect(proof.receipts.S4.implementationCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(proof.receipts.S4.draft).toBe(true);
    expect(proof.receipts.S5.mergeMutationCount).toBe(0);
    expect(proof.receipts.S6.attemptId).not.toBe(proof.receipts.S7.attemptId);
    expect(proof.receipts.S6.nonMutating).toBe(true);
    expect(proof.receipts.S7.nonMutating).toBe(true);
    expect(proof.receipts.S8.headSha).toBe(process.env.PR_HEAD_SHA);
    expect(proof.receipts.S9.controllerFenced).toBe(true);
    expect(proof.receipts.S10.isolatedStaging).toBe(true);
    expect(proof.receipts.S11.rollbackAnchor).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(proof.receipts.S12.accountingWrites).toEqual([
      'task', 'run', 'promise_map', 'regression_result',
      'report', 'learning_handoff', 'external_status',
    ]);
    expect(proof.receipts.S12.transactionCommittedOnce).toBe(true);
    expect(proof.terminalComplete).toBe(true);
    for (const mutation of proof.missingReceiptCounterfactuals) {
      expect(mutation.terminalComplete).toBe(false);
      expect(mutation.stageAdvanced).toBe(false);
    }
  });

  it('canonical legacy behavior families preserve exact inventory and proven fire evidence', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/kernel-harness-lifecycle.js'
    );
    const proof = await mod.verifyLegacyEquivalenceReceipts({
      databaseUrl: DB_URL,
      exactHead: process.env.PR_HEAD_SHA,
      providers: ['claude', 'codex', 'grok'],
      modes: ['normal', 'violation', 'recovery'],
      familyIds: [
        'KH-F1-F01', 'KH-F1-F02', 'KH-F1-F03', 'KH-F1-F04',
        'KH-F1-F05', 'KH-F1-F06', 'KH-F1-F07', 'KH-F1-F08',
      ],
      provenanceSha: '4dc3b69a',
    });
    expect(proof.legacyBehaviorCount).toBe(129);
    expect(proof.priorityCounts).toEqual({ P0: 66, P1: 63 });
    expect(proof.familyCounts).toEqual({
      'KH-F1-F01': 0,
      'KH-F1-F02': 2,
      'KH-F1-F03': 2,
      'KH-F1-F04': 8,
      'KH-F1-F05': 6,
      'KH-F1-F06': 0,
      'KH-F1-F07': 1,
      'KH-F1-F08': 110,
    });
    expect(proof.zeroMappingTypedGaps).toEqual(['KH-F1-F01', 'KH-F1-F06']);
    expect(proof.exactIdsByFamily['KH-F1-F02']).toEqual(['H1-017', 'H3-002']);
    expect(proof.exactIdsByFamily['KH-F1-F03']).toEqual(['W1-005', 'C1-005']);
    expect(proof.exactIdsByFamily['KH-F1-F04']).toEqual([
      'C8-101', 'S1-007', 'S1-008', 'S1-009',
      'S1-010', 'S2-001', 'S2-002', 'S2-003',
    ]);
    expect(proof.exactIdsByFamily['KH-F1-F05']).toEqual([
      'H7-002', 'H7-006', 'H7-009', 'H7-029', 'W1-004', 'S3-001',
    ]);
    expect(proof.exactIdsByFamily['KH-F1-F07']).toEqual(['C4-001']);
    expect(proof.f08BulkInferredPassCount).toBe(0);
    expect(proof.inferredPassCount).toBe(0);
    for (const receipt of proof.receipts) {
      expect(receipt.signatureVerified).toBe(true);
      expect(receipt.headSha).toBe(process.env.PR_HEAD_SHA);
      expect(receipt.positiveOrViolationOrRecoveryFired).toBe(true);
      expect(receipt).toMatchObject({
        runId: CURRENT_RUN_ID,
        familyId: expect.stringMatching(/^KH-F1-F0[1-8]$/),
        legacyBehaviorId: expect.any(String),
        evidenceDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      });
    }
  });
});
