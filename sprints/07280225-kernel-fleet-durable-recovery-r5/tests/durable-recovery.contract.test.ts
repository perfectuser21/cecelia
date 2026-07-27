import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = 'dd424a61926009ac85a915b31187124b85f0ca98';
const SOURCE_PATH = 'packages/engine/regression-contract.yaml';
const SOURCE_BLOB = '7bb49c69e1af07bdaf7d69cf9ec286688b5f75d3';
const SOURCE_DIGEST = '4fcdf146ad08ab0ba349d789084fad6d85902b0e345993fb7ddf9057899a1e5f';
const ELEMENT_SOURCE_PATH = 'packages/brain/src/lib/eleven-elements-ledger.js';
const ELEMENT_SOURCE_BLOB = 'e4e3bb5b4b5cbbf26ad16b4048b2c3e6228f3d09';
const PROPOSAL = '4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13';
const IMPORTED_MAPPING_DIGEST = 'be80793527a817611ba0698654ea858eda7c77ea9e63da937cba7b885a4d9363';
const ELEMENTS = [
  'FR', 'NFR', 'Invariant', '判定点', '保质期', '死亡告警',
  '失败语义', '效果确认', '输入对抗面', '账本保鲜', '两轴衔接',
];
const ORIGIN_KIND = {
  S0: 'brain_task_event',
  S1: 'signed_intent_snapshot',
  S2: 'harness_attempt',
  S3: 'harness_attempt_quorum',
  S4: 'harness_attempt_with_pr',
  S5: 'github_check_suite',
  S6: 'harness_attempt',
  S7: 'harness_attempt',
  S8: 'github_owner_review',
  S9: 'github_merge_event',
  S10: 'deployment_receipt',
  S11: 'deployment_receipt',
  S12: 'brain_atomic_accounting',
} as const;
const RESULT_MUTATIONS = [
  'missing_descriptor', 'absolute_path', 'dotdot', 'wrong_attempt', 'wrong_run',
  'wrong_role', 'wrong_contract', 'wrong_head', 'erofs', 'symlink', 'oversize',
  'malformed', 'callback_failure', 'hash_replay',
];
const STARTUP_MUTATIONS = [
  'missing_worktree', 'relative_worktree', 'nonexistent_worktree', 'non_git_worktree',
  'unmounted_worktree', 'async_spawn_error', 'early_exit', 'no_ready',
  'handshake_timeout', 'lease_busy', 'stale_generation', 'spoof_ready_without_db',
];

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

async function loadProof(name: string) {
  // 该精确 planned module 尚未实现是本 Sprint 的产品 Red；依赖/DB/config 错误不得在模块加载前发生。
  const moduleUrl = pathToFileURL(resolve('packages/brain/src/kernel-fleet-proof', `${name}.js`)).href;
  return import(/* @vite-ignore */ moduleUrl);
}

describe('P0 durable recovery contract [BEHAVIOR]', () => {
  it('built image self-contained profiles', async () => {
    const { runBuiltImageProof } = await loadProof('built-image');
    const proof = await runBuiltImageProof({ network: 'none', readOnly: true, mounts: [] });
    expect(proof.loadedProfiles).toEqual(['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1']);
    expect(proof.importedEntrypoint).toBe('/app/src/orchestrator/run.js');
    expect(proof.missingConfig.reasonCode).toBe('brain_profile_config_missing');
  });

  it('immutable per-attempt profile snapshot across concurrent upgrade', async () => {
    const { runAtomicReleaseProof } = await loadProof('atomic-release');
    const proof = await runAtomicReleaseProof({ realPostgres: true, exactRunnerDigest: true });
    expect(proof.existingAttempt.snapshotDigest).toBe(proof.beforeUpgradeDigest);
    expect(proof.newAttempt.snapshotDigest).toBe(proof.afterUpgradeDigest);
    expect(proof.profileOnlyMutation.reasonCode).toBe('release_tuple_mismatch');
  });

  it('real Worker Runner seam before Agent execution', async () => {
    const { runWorkerRunnerProof } = await loadProof('worker-runner');
    const proof = await runWorkerRunnerProof({ realDocker: true, realOrbStack: true });
    expect(proof.positive.agentStarted).toBe(true);
    for (const key of ['unwritable_stdout', 'missing_github_auth', 'private_bind_root'])
      expect(proof.counterfactuals[key].agentStartCount).toBe(0);
    expect(proof.counterfactuals.unwritable_stdout.diagnosticBytes).toBeLessThanOrEqual(2048);
  });

  it('GitHub auth on success timeout crash and cancel', async () => {
    const { runGithubBrokerProof } = await loadProof('github-broker');
    const proof = await runGithubBrokerProof({ realRunner: true });
    expect(proof.ghAuthStatus).toBe('verified_before_agent');
    expect(proof.pushFetchShaMatch).toBe(true);
    for (const terminal of ['success', 'timeout', 'crash', 'cancel'])
      expect(proof.terminals[terminal].credentialResidualCount).toBe(0);
  });

  it('fleet-worker transport with production upgrade rollback and source enum parity', async () => {
    const { runTransportMigrationProof } = await loadProof('transport-migration');
    const proof = await runTransportMigrationProof({ realPostgres: true, minimumMigration: 368 });
    expect(proof.upgradeValues).toEqual(expect.arrayContaining(['local-docker', 'remote-bridge', 'fleet-worker']));
    expect(proof.rollbackValues).toEqual(['local-docker', 'remote-bridge']);
    expect(proof.sourceSchemaParity).toBe(true);
    expect(proof.migration366Collision.reasonCode).toBe('numeric_prefix_already_applied');
  });

  it('ownership frame plus persisted heartbeat', async () => {
    const { runKernelStartupProof } = await loadProof('kernel-startup');
    const proof = await runKernelStartupProof({ realEntrypoint: 'packages/brain/src/orchestrator/run.js', realPostgres: true });
    expect(proof.parentResolvedAfterDbHeartbeat).toBe(true);
    expect(new Set(proof.counterfactualKeys)).toEqual(new Set(STARTUP_MUTATIONS));
    expect(proof.counterfactuals.spoof_ready_without_db.reasonCode).toBe('controller_readiness_unpersisted');
  });

  it('authenticated callback commit before Worker cleanup', async () => {
    const { runArtifactTransferProof } = await loadProof('artifact-transfer');
    const proof = await runArtifactTransferProof({ authenticatedCallback: true, realGit: true });
    expect(proof.materializedSha).toBe(proof.remoteSha);
    expect(proof.cleanupStartedAt).toBeGreaterThan(proof.materializedAt);
    expect(proof.crossRun.reasonCode).toBe('artifact_run_mismatch');
  });

  it('reverse cleanup removes real Runner nested and ignored output', async () => {
    const { runReverseCleanupProof } = await loadProof('reverse-cleanup');
    const proof = await runReverseCleanupProof({ realRunner: true, deepUmask077: true });
    expect(proof.order).toEqual(['container_absent', 'normalize_descendants', 'workspace_admin', 'runtime_secret', 'state']);
    expect(proof.residual).toEqual({ workspace: 0, admin: 0, runtime: 0, secret: 0, state: 0, quarantine: 0 });
    expect(proof.concurrent.outcomes.sort()).toEqual(['already_clean', 'clean']);
    expect(proof.failureForensics.appendOnlyReceiptCount).toBe(1);
  });

  it('ESRCH-only local liveness death', async () => {
    const { runLivenessProof } = await loadProof('kernel-liveness');
    const proof = await runLivenessProof({ productionModule: 'packages/brain/src/lib/kernel-liveness.js', realChild: true });
    expect(proof.killedLocal.reasonCode).toBe('esrch_dead');
    expect(proof.liveLocal.alive).toBe(true);
    expect(proof.unknownHost.failOpen).toBe(true);
  });

  it('CI-only authorization and stale exact-head owner approval', async () => {
    const { runGithubAuthorityProof } = await loadProof('github-authority');
    const proof = await runGithubAuthorityProof({ realGithubApi: true, exactHead: process.env.PR_HEAD_SHA });
    expect(proof.normal.order).toEqual(['ci', 'evaluator', 'judge', 'owner', 'merge']);
    for (const key of ['ci_only', 'stale_head', 'title_change', 'label_removal', 'alternate_actor'])
      expect(proof.counterfactuals[key].mergeCount).toBe(0);
  });

  it('semantic anchor resolves journey golden-path step ownership', async () => {
    const { runAnchorProof } = await loadProof('semantic-anchor');
    const proof = await runAnchorProof({ realPostgres: true, taskId: process.env.TASK_ID, runId: process.env.RUN_ID });
    expect(proof.exists).toBe(true);
    expect(proof.ownershipConsistent).toBe(true);
    expect(proof.taskId).not.toBe(proof.runId);
  });

  it('P0 workflows enforce owner merge staging production order', async () => {
    const { runWorkflowProof } = await loadProof('workflow-authority');
    const proof = await runWorkflowProof({ realGithubRuns: true });
    expect(proof.order).toEqual(['draft', 'ci', 'evaluator', 'judge', 'owner', 'merge', 'staging', 'production']);
    expect(proof.preOwnerServingMutationCount).toBe(0);
    expect(proof.rollbackAnchorVerified).toBe(true);
  });

  it('attempt scoped result channel', async () => {
    const { runResultChannelProof } = await loadProof('result-channel');
    const proof = await runResultChannelProof({ realWorkerRunner: true, roleFromTaskBundle: true });
    expect(proof.positive.fileMode).toBe('0600');
    expect(proof.positive.brainAckHash).toBe(proof.positive.resultHash);
    expect(new Set(proof.counterfactualKeys)).toEqual(new Set(RESULT_MUTATIONS));
    expect(proof.sourceWorkspaceResultAuthority).toBe(false);
    expect(proof.preAgentFailures.every((x: any) => x.agentStartCount === 0 && x.semanticBudgetDelta === 0)).toBe(true);
  });

  it('authority inventory exact commit path blob and digest', async () => {
    const { verifySourceInventory } = await loadProof('authority-inventory');
    const blob = execFileSync('git', ['rev-parse', `${BASE}:${SOURCE_PATH}`], { encoding: 'utf8' }).trim();
    expect(blob).toBe(SOURCE_BLOB);
    const elementBlob = execFileSync('git', ['rev-parse', `${BASE}:${ELEMENT_SOURCE_PATH}`], { encoding: 'utf8' }).trim();
    expect(elementBlob).toBe(ELEMENT_SOURCE_BLOB);
    const proof = await verifySourceInventory({ commit: BASE, path: SOURCE_PATH, importBrainKernel: false });
    expect(proof).toMatchObject({ count: 129, p0: 66, p1: 63, duplicateCount: 0, digest: SOURCE_DIGEST });
    expect(proof.elevenElementsFromFrozenFixture).toEqual(ELEMENTS);
    expect(proof.importedBrainKernelModules).toEqual([]);
  });

  it('classification authority rejects imported family proposal', async () => {
    const { runClassificationProof } = await loadProof('classification-authority');
    const proof = await runClassificationProof({ proposalCommit: PROPOSAL, importedMappingDigest: IMPORTED_MAPPING_DIGEST });
    expect(proof.importedDistribution).toEqual([0, 2, 2, 8, 6, 0, 1, 110]);
    expect(proof.importedDistributionIsCanonical).toBe(false);
    expect(proof.decisions['H1-001'].approvedFamily).not.toBe('KH-F1-F08');
    expect(proof.decisions['H1-002'].approvedFamily).not.toBe('KH-F1-F08');
    expect(proof.unapprovedCreatesPassCount).toBe(0);
  });

  it('lifecycle migration preserves six historical rows in same Journey', async () => {
    const { runLifecycleProjectionProof } = await loadProof('lifecycle-projection');
    const proof = await runLifecycleProjectionProof({ realPostgres: true, minimumMigration: 368, proposalCommit: PROPOSAL });
    expect(proof.journeyCountBefore).toBe(1);
    expect(proof.journeyCountAfter).toBe(1);
    expect(proof.historicalFingerprintAfter).toBe(proof.historicalFingerprintBefore);
    expect(proof.historicalFingerprintAfterRollback).toBe(proof.historicalFingerprintBefore);
    expect(proof).toMatchObject({ historicBackbones: 4, aliases: 2, newRows: 9, backbones: 13, cells: 143 });
    expect(proof.initialCellStatuses).toEqual(['unverified']);
  });

  it('origin kind uses direct production evidence and existing Attempt columns', async () => {
    const { runOriginKindProof } = await loadProof('origin-kind');
    const proof = await runOriginKindProof({ realPostgres: true, realGithubApi: true, realDeploymentReceipts: true });
    expect(proof.originKind).toEqual(ORIGIN_KIND);
    expect(proof.attemptQueryColumns).toEqual([
      'id', 'run_id', 'role', 'provider', 'provider_session_id',
      'actual_machine_id', 'lease_generation', 'status', 'task_bundle', 'result',
    ]);
    expect(proof.nonexistentColumnQueries).toEqual([]);
    expect(proof.selfAssertedBooleanAccepted).toBe(false);
  });

  it('owner approval freezes authority but does not infer behavioral pass', async () => {
    const { runAuthorityFreezeProof } = await loadProof('authority-freeze');
    const proof = await runAuthorityFreezeProof({ exactHeadOwnerSignature: true });
    expect(proof.stageManifestAuthority).toBe('canonical_v1');
    expect(proof.behaviorPassInferredCount).toBe(0);
    expect(proof.unreviewedClassificationCanComplete).toBe(false);
    expect(proof.prefixUnifiedIdAccepted).toBe(false);
  });

  it('approved decisions derive exact obligations without fixed cardinality', async () => {
    const { runEquivalenceProof } = await loadProof('equivalence');
    const proof = await runEquivalenceProof({ deriveFromApprovedDecisions: true });
    expect(proof.requiredKeys).toEqual(proof.receiptDerivedObservedKeys);
    expect(proof.fixed1161ThresholdUsed).toBe(false);
    expect(proof.fixed18ThresholdUsed).toBe(false);
    expect(proof).toMatchObject({ unreviewed: 0, missing: 0, stale: 0, inferred: 0, duplicate: 0 });
  });

  it('S12 terminal accounting consumes dynamic obligations and direct origins', async () => {
    const { runTerminalAccountingProof } = await loadProof('terminal-accounting');
    const proof = await runTerminalAccountingProof({ realPostgres: true, directOriginKinds: true });
    expect(proof.consumedObligations).toEqual(proof.approvedAuthorityObligations);
    expect(proof.controllerTransactionCount).toBe(1);
    expect(proof.counterfactuals.unreviewed_authority.terminalComplete).toBe(false);
    expect(proof.counterfactuals.imported_distribution_only.terminalComplete).toBe(false);
    expect(proof.counterfactuals.wrong_origin_kind.terminalComplete).toBe(false);
  });
});
