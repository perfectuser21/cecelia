#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import pg from 'pg';

import {
  appendDispatchOutcome,
  renewReleaseEffectClaim,
} from '../../packages/brain/src/orchestrator/release-run-authorization.js';
import { planReleaseArtifactRoutes } from '../../packages/brain/src/orchestrator/release-run-routing.js';
import {
  cleanupPrivateReleaseWorkerConfig,
  readPrivateReleaseWorkerConfig,
} from '../../packages/brain/src/orchestrator/release-run-worker-secret.js';
import {
  cleanupReleaseExecutionWorkspace,
  prepareReleaseArtifactSnapshot,
  prepareReleaseExecutionWorkspace,
} from './release-run-artifact-snapshot.mjs';
import {
  buildReleaseWorkerEnvironment,
  runLeasedReleaseRoutes,
} from './release-run-worker-runtime.mjs';
import { acquireProductionMutationLock } from './release-run-production-lock.mjs';
import { isProductionRouteComplete } from './release-run-production-progress.mjs';

const effectKind = process.env.KERNEL_RELEASE_EFFECT_KIND;
const repoRoot = process.env.KERNEL_RELEASE_DEPLOY_ROOT;
const privateConfigFile = process.env.KERNEL_RELEASE_PRIVATE_CONFIG_FILE;
let pool = null;
let terminalPool = null;
let artifactVersions = [];
let artifactStore;
let snapshotRoot;
let routes;

async function inspectBrainDeployment() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['inspect', 'cecelia-node-brain', '--format', '{{json .}}'],
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error('release_worker_brain_readback_failed'));
        return;
      }
      try {
        const observed = JSON.parse(stdout);
        const gitShaEntries = (observed?.Config?.Env ?? []).filter(
          (entry) => entry.startsWith('GIT_SHA='),
        );
        resolve({
          imageDigest: observed?.Image,
          gitSha: gitShaEntries.length === 1
            ? gitShaEntries[0].slice('GIT_SHA='.length)
            : null,
          running: observed?.State?.Running === true,
        });
      } catch {
        reject(new Error('release_worker_brain_readback_failed'));
      }
    });
  });
}

async function routeIsComplete(route, artifact) {
  if (effectKind !== 'production') return false;
  return isProductionRouteComplete({
    route,
    artifact,
    repoRoot,
    releaseRunId: process.env.KERNEL_RELEASE_RUN_ID,
    mergeSha: process.env.KERNEL_RELEASE_MERGE_SHA,
    skillsDeployRoots: process.env.CECELIA_SKILLS_DEPLOY_ROOTS,
    workflowSourceRoot: join(snapshotRoot, 'packages/workflows/skills'),
    inspectBrainDeployment,
    brainReceiptPath: process.env.DEPLOY_STATUS_FILE,
  });
}

async function runRoute(route, { signal }) {
  const artifact = artifactVersions.find((item) => item.name === route.artifact);
  if (await routeIsComplete(route, artifact)) return;
  const artifactRoot = prepareReleaseExecutionWorkspace({
    artifactStore,
    snapshotRoot,
    mergeSha: process.env.KERNEL_RELEASE_MERGE_SHA,
  });
  if (!route.command.startsWith(`${snapshotRoot}/`)) {
    cleanupReleaseExecutionWorkspace(artifactRoot, { artifactStore });
    throw new Error('release_worker_route_outside_snapshot');
  }
  const routeCommand = `${artifactRoot}${route.command.slice(snapshotRoot.length)}`;
  const env = buildReleaseWorkerEnvironment(process.env, {
    ...route.env,
    KERNEL_RELEASE_ARTIFACT_ROOT: artifactRoot,
    KERNEL_RELEASE_ARTIFACT_NAME: artifact.name,
    KERNEL_RELEASE_ARTIFACT_VERSION: artifact.version,
    KERNEL_RELEASE_ARTIFACT_DIGEST: artifact.digest,
  });
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('bash', [routeCommand, ...route.args], {
        cwd: artifactRoot,
        env,
        stdio: 'inherit',
        timeout: 15 * 60_000,
        signal,
      });
      child.once('error', reject);
      child.once('close', (code, closeSignal) => {
        if (code === 0) resolve();
        else reject(new Error(
          `release_worker_route_failed:${route.artifact}:${code ?? closeSignal ?? 'unknown'}`,
        ));
      });
    });
  } finally {
    cleanupReleaseExecutionWorkspace(artifactRoot, { artifactStore });
  }
  if (effectKind === 'production' && !(await routeIsComplete(route, artifact))) {
    throw Object.assign(
      new Error('release_worker_route_readback_mismatch'),
      { code: 'release_worker_route_readback_mismatch' },
    );
  }
}

async function persistEffectStatus(resultStatus = 'success', errorCode = null) {
  if (!['production', 'staging'].includes(effectKind)) return;
  const statusPath = effectKind === 'production'
    ? (process.env.DEPLOY_STATUS_FILE
      || join(repoRoot, 'logs/cecelia-deploy-status.json'))
    : join(repoRoot, 'logs/cecelia-staging-deploy-status.json');
  let priorStatus = {};
  try {
    priorStatus = JSON.parse(readFileSync(statusPath, 'utf8'));
  } catch {
    // A non-Brain route has no pre-existing status file.
  }
  const workflow = artifactVersions.find((artifact) => artifact.name === 'workflow-skills');
  if (effectKind === 'production' && workflow) {
    priorStatus.workflow_rollback_metadata = JSON.parse(readFileSync(
      join(
        repoRoot,
        'logs/release-rollbacks/workflow-skills',
        `${process.env.KERNEL_RELEASE_RUN_ID}.json`,
      ),
      'utf8',
    ));
  }
  const dashboard = artifactVersions.find((artifact) => artifact.name === 'workspace');
  if (effectKind === 'production' && dashboard) {
    priorStatus.dashboard_rollback_metadata = JSON.parse(readFileSync(
      join(
        repoRoot,
        'logs/release-rollbacks/dashboard',
        `${process.env.KERNEL_RELEASE_RUN_ID}.json`,
      ),
      'utf8',
    ));
  }
  delete priorStatus.release_authorization;
  mkdirSync(dirname(statusPath), { recursive: true });
  writeFileSync(statusPath, JSON.stringify({
    ...priorStatus,
    status: resultStatus,
    error: errorCode,
    release_run_id: process.env.KERNEL_RELEASE_RUN_ID,
    merge_sha: process.env.KERNEL_RELEASE_MERGE_SHA,
    dispatch_claim_id: Number(process.env.KERNEL_RELEASE_DISPATCH_CLAIM_ID),
    dispatch_generation: Number(process.env.KERNEL_RELEASE_DISPATCH_GENERATION),
    deployed_artifact_versions: artifactVersions,
    finished_at: new Date().toISOString(),
  }), { mode: 0o600 });
  chmodSync(statusPath, 0o600);
}

async function resolveWorkerActionReceipt(queryable, status, evidence = {}) {
  const receiptId = process.env.KERNEL_RELEASE_ACTION_RECEIPT_ID;
  if (!receiptId || !['confirmed', 'failed'].includes(status)) return;
  await queryable.query(
    `UPDATE action_receipts
        SET receipt_status = $2,
            evidence = evidence || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1
        AND receipt_status = 'pending'`,
    [receiptId, status, JSON.stringify(evidence)],
  );
}

let productionMutationLock = null;
let terminalConfirmed = false;
let preservePrivateConfig = false;
try {
  const privateConfig = readPrivateReleaseWorkerConfig(privateConfigFile);
  pool = new pg.Pool({ ...privateConfig.database, max: 1 });
  terminalPool = new pg.Pool({ ...privateConfig.database, max: 1 });
  try {
    artifactVersions = JSON.parse(process.env.KERNEL_RELEASE_ARTIFACT_VERSIONS || '');
  } catch {
    throw Object.assign(
      new Error('release_effect_worker_artifacts_invalid'),
      { code: 'release_effect_worker_artifacts_invalid' },
    );
  }
  artifactStore = process.env.KERNEL_RELEASE_ARTIFACT_STORE
    || join(repoRoot, '.release-artifacts');
  snapshotRoot = prepareReleaseArtifactSnapshot({
    repoRoot,
    artifactStore,
    mergeSha: process.env.KERNEL_RELEASE_MERGE_SHA,
  });
  routes = planReleaseArtifactRoutes(effectKind, artifactVersions, {
    repoRoot: snapshotRoot,
    mergeSha: process.env.KERNEL_RELEASE_MERGE_SHA,
  });
  if (effectKind === 'production') {
    productionMutationLock = await acquireProductionMutationLock(pool, {
      onWait: (client) => renewReleaseEffectClaim(client, {
        dispatch_claim_id: Number(process.env.KERNEL_RELEASE_DISPATCH_CLAIM_ID),
        generation: Number(process.env.KERNEL_RELEASE_DISPATCH_GENERATION),
      }),
    });
  }
  const authorityStore = productionMutationLock?.client ?? pool;
  await runLeasedReleaseRoutes({
    routes,
    claimId: Number(process.env.KERNEL_RELEASE_DISPATCH_CLAIM_ID),
    generation: Number(process.env.KERNEL_RELEASE_DISPATCH_GENERATION),
    renew: (claimId, generation) => renewReleaseEffectClaim(authorityStore, {
      dispatch_claim_id: claimId,
      generation,
    }),
    appendOutcome: async (claimId, generation, outcome, evidence) => {
      const result = await appendDispatchOutcome(
        authorityStore,
        claimId,
        generation,
        outcome,
        evidence,
      );
      terminalConfirmed = true;
      return result;
    },
    runRoute,
    abortSignal: productionMutationLock?.signal,
    afterTerminal: async () => {
      await persistEffectStatus('success').catch(() => {});
      await resolveWorkerActionReceipt(authorityStore, 'confirmed', {
        source: 'release_effect_worker_terminal',
      }).catch(() => {});
    },
  });
} catch (error) {
  const terminalStore = terminalPool ?? pool;
  const terminalOutcome = effectKind === 'production' ? 'unknown' : 'failed';
  if (terminalStore && !terminalConfirmed) {
    try {
      await appendDispatchOutcome(
        terminalStore,
        Number(process.env.KERNEL_RELEASE_DISPATCH_CLAIM_ID),
        Number(process.env.KERNEL_RELEASE_DISPATCH_GENERATION),
        terminalOutcome,
        {
          source: 'release_effect_worker_terminal',
          error_code: error?.code ?? 'release_worker_route_failed',
        },
      );
      terminalConfirmed = true;
    } catch {
      preservePrivateConfig = true;
    }
  }
  await persistEffectStatus(
    terminalOutcome,
    error?.code ?? 'release_worker_route_failed',
  )
    .catch(() => {});
  if (terminalStore && terminalOutcome === 'failed') {
    await resolveWorkerActionReceipt(terminalStore, 'failed', {
      source: 'release_effect_worker_terminal',
      error_code: error?.code ?? 'release_worker_route_failed',
    }).catch(() => {});
  }
  throw error;
} finally {
  await productionMutationLock?.release().catch(() => {});
  await pool?.end().catch(() => {});
  await terminalPool?.end().catch(() => {});
  if (!preservePrivateConfig) {
    try {
      cleanupPrivateReleaseWorkerConfig(privateConfigFile);
    } catch {
      // The config reader may have failed before ownership was established.
    }
  }
}
