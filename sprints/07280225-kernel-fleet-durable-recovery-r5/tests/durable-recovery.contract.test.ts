import { describe, expect, it } from 'vitest';

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

  it('fleet-worker transport migration parity', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/fleet-release-contract.js'
    );
    await expect(mod.verifyExecutionTransportParity({
      databaseUrl: process.env.DB_URL,
      required: ['local-docker', 'remote-bridge', 'fleet-worker'],
    })).resolves.toMatchObject({ compatible: true, rollbackVerified: true });
  });

  it('rejects invalid worktree before spawn', async () => {
    const mod = await import(
      '../../../packages/brain/src/kernel-launch-readiness.js'
    );
    await expect(mod.validateKernelWorktree({
      worktreePath: 'relative/worktree',
      expectedMountRoot: '/workspace',
    })).rejects.toThrow('kernel_worktree_not_absolute');
  });

  it('records resumed only after ready heartbeat', async () => {
    const mod = await import(
      '../../../packages/brain/src/kernel-launch-readiness.js'
    );
    const receipt = await mod.awaitKernelReadiness({
      pid: 4242,
      readyFrame: null,
      initialHeartbeatPersisted: false,
      timeoutMs: 1,
    }).catch((error: Error) => ({ error: error.message }));
    expect(receipt).toEqual({ error: 'kernel_ready_timeout' });
    expect(mod.isRecoverySuccess(receipt)).toBe(false);
  });

  it('materializes authenticated commit before cleanup', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/canonical-artifact-transfer.js'
    );
    await expect(mod.acceptRemoteArtifact({
      callbackVerified: true,
      taskId: '0f71e189-5328-4dce-bfc7-d66ba7f90fb8',
      branch: 'cp-harness-propose-r1-0f71e189-a1',
      commitSha: 'a'.repeat(40),
      cleanupStarted: true,
    })).rejects.toThrow('artifact_cleanup_started_before_materialization');
  });

  it('rejects CI-only merge authorization', async () => {
    const mod = await import(
      '../../../packages/brain/src/orchestrator/exact-head-owner-gate.js'
    );
    expect(mod.canTransitionDraftToReady({
      exactHead: 'a'.repeat(40),
      ciHead: 'a'.repeat(40),
      evaluatorHead: 'a'.repeat(40),
      judgeHead: 'a'.repeat(40),
      ciGreen: true,
      ownerApproval: null,
      autoMergeEnabled: false,
    })).toEqual({ allowed: false, reason: 'owner_approval_required' });
  });
});

