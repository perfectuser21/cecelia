#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

import {
  assertRollbackExecutionCurrent,
  renewRollbackClaim,
  settleRollbackExecution,
} from '../../packages/brain/src/orchestrator/release-run-rollback-authorization.js';
import { planRollbackArtifactRoutes } from '../../packages/brain/src/orchestrator/release-run-rollback-routing.js';
import {
  cleanupPrivateReleaseWorkerConfig,
  readPrivateRollbackWorkerConfig,
} from '../../packages/brain/src/orchestrator/release-run-worker-secret.js';
import { digestTree } from './release-run-tree-digest.mjs';
import { buildReleaseWorkerEnvironment } from './release-run-worker-runtime.mjs';
import {
  buildIndependentRollbackSettlement,
  classifyRollbackRouteState,
  readWorkflowCurrentLinksDigest,
  runLeasedRollbackRoutes,
} from './release-run-rollback-worker-runtime.mjs';
import { acquireProductionMutationLock } from './release-run-production-lock.mjs';

const repoRoot = process.env.KERNEL_RELEASE_DEPLOY_ROOT;
const privateConfigFile = process.env.KERNEL_RELEASE_PRIVATE_CONFIG_FILE;
let pool = null;
let terminalPool = null;
const claimId = Number(process.env.KERNEL_RELEASE_ROLLBACK_CLAIM_ID);
const generation = Number(process.env.KERNEL_RELEASE_ROLLBACK_GENERATION);
const releaseRunId = process.env.KERNEL_RELEASE_RUN_ID;
let rollbackTargets;
let routes;
const completedRouteReadbacks = new Map();

function rollbackRouteEnvironment(route) {
  return buildReleaseWorkerEnvironment(process.env, {
    KERNEL_RELEASE_ROLLBACK_WORKER: '1',
    KERNEL_RELEASE_ROLLBACK_EXPECTED_DIGEST: route.expected_digest,
    KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_DIGEST:
      route.expected_current_digest,
    KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_VERSION:
      route.expected_current_version,
    KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_MERGE_SHA:
      route.expected_current_merge_sha,
    KERNEL_RELEASE_ROLLBACK_TARGET_MERGE_SHA: route.target_merge_sha,
    CECELIA_SKIP_BRAIN_PROMOTE: '1',
    CECELIA_SKIP_FINGERPRINT: '1',
  });
}

async function spawnRoute(route, signal, {
  acceptedExitCodes = [0],
} = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn('bash', [route.command, ...route.args], {
      cwd: repoRoot,
      env: rollbackRouteEnvironment(route),
      stdio: 'inherit',
      timeout: 15 * 60_000,
      signal,
    });
    child.once('error', reject);
    child.once('close', (code, closeSignal) => {
      if (acceptedExitCodes.includes(code)) resolve();
      else reject(Object.assign(
        new Error(`release_rollback_route_failed:${route.artifact}:${code ?? closeSignal}`),
        { code: 'release_rollback_route_failed' },
      ));
    });
  });
}

async function recoverInterruptedWorkflowRoute(route, signal) {
  if (route.artifact !== 'workflow-skills') return false;
  const transactionDir = join(
    repoRoot,
    'logs/release-rollbacks/workflow-skills/transactions',
    `${process.env.KERNEL_RELEASE_ROLLBACK_AUTHORITY_ID}-${claimId}-${generation}`,
  );
  let state;
  try {
    state = JSON.parse(readFileSync(join(transactionDir, 'state.json'), 'utf8'));
  } catch {
    return false;
  }
  if (!['applying', 'compensating', 'recovery_required'].includes(state?.phase)) {
    return false;
  }
  try {
    await spawnRoute(route, signal, { acceptedExitCodes: [78] });
  } catch (error) {
    throw Object.assign(
      new Error('release_rollback_recovery_failed', { cause: error }),
      { code: 'release_rollback_recovery_failed' },
    );
  }
  return true;
}

async function brainReadback() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['inspect', 'cecelia-node-brain', '--format', '{{.Image}}'],
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) reject(new Error('release_rollback_brain_readback_failed'));
      else resolve(stdout.trim());
    });
  });
}

async function observeRouteState(route) {
  if (route.readback_kind === 'brain-image') {
    return { digest: await brainReadback() };
  }
  if (route.readback_kind === 'dashboard-release') {
    const release = readFileSync(join(repoRoot, '.production-release'), 'utf8');
    return {
      digest: digestTree(join(repoRoot, 'apps/dashboard/dist')),
      version: release.match(/^current=(.+)$/m)?.[1] ?? null,
      merge_sha: release.match(/^commit=([0-9a-f]{40})$/m)?.[1] ?? null,
    };
  }
  if (route.readback_kind === 'workflow-links') {
    return {
      digest: readWorkflowCurrentLinksDigest(join(
        repoRoot,
        'logs/release-rollbacks/workflow-skills',
        `${releaseRunId}.links`,
      )),
    };
  }
  throw new Error('release_rollback_readback_kind_unknown');
}

async function runRoute(route, { signal }) {
  const completedReadback = completedRouteReadbacks.get(route.artifact);
  if (completedReadback) return completedReadback;
  try {
    await spawnRoute(route, signal);
  } catch (error) {
    if (route.artifact === 'workflow-skills' && !signal.aborted) {
      const recovered = await recoverInterruptedWorkflowRoute(route, signal);
      if (recovered) {
        throw Object.assign(
          new Error('release_rollback_workflow_compensated', { cause: error }),
          { code: 'release_rollback_workflow_compensated' },
        );
      }
    }
    throw error;
  }
  const observed = await observeRouteState(route);
  return { artifact: route.artifact, observed_digest: observed.digest };
}

const processAbort = new AbortController();
const abortProcess = () => processAbort.abort();
process.once('SIGTERM', abortProcess);
process.once('SIGINT', abortProcess);

let productionMutationLock = null;
let routesStarted = false;
let terminalConfirmed = false;
let preservePrivateConfig = false;
try {
  const config = readPrivateRollbackWorkerConfig(privateConfigFile);
  pool = new pg.Pool({ ...config.database, max: 1 });
  terminalPool = new pg.Pool({ ...config.database, max: 1 });
  productionMutationLock = await acquireProductionMutationLock(pool, {
    onWait: (client) => renewRollbackClaim(client, {
      claim_id: claimId,
      generation,
    }),
  });
  const authorityStore = productionMutationLock.client;
  try {
    rollbackTargets = JSON.parse(process.env.KERNEL_RELEASE_ROLLBACK_TARGETS || '');
    routes = planRollbackArtifactRoutes(rollbackTargets, {
      repoRoot,
      releaseRunId,
    });
  } catch (error) {
    await settleRollbackExecution(authorityStore, {
      claim_id: claimId,
      generation,
      status: 'failed',
      late_effect_risk: false,
      evidence: {
        source: 'release_rollback_worker_validation',
        error_code: error?.code ?? 'release_rollback_worker_targets_invalid',
      },
    });
    terminalConfirmed = true;
    throw error;
  }
  routesStarted = true;
  await runLeasedRollbackRoutes({
    routes,
    rollbackTargets,
    claimId,
    generation,
    renew: (exactClaimId, exactGeneration) => renewRollbackClaim(authorityStore, {
      claim_id: exactClaimId,
      generation: exactGeneration,
    }),
    settle: async (settlement, { signal } = {}) => {
      const result = await settleRollbackExecution(
        authorityStore,
        {
          ...settlement,
          abort_signal: signal,
          interrupt_store: terminalPool,
        },
        { connectionKind: 'client' },
      );
      terminalConfirmed = true;
      return result;
    },
    preflightRoutes: async (plannedRoutes, { signal }) => {
      await assertRollbackExecutionCurrent(authorityStore, {
        claim_id: claimId,
        generation,
      });
      for (const route of plannedRoutes) {
        await recoverInterruptedWorkflowRoute(route, signal);
      }
      await assertRollbackExecutionCurrent(authorityStore, {
        claim_id: claimId,
        generation,
      });
      for (const route of plannedRoutes) {
        if (signal.aborted) throw signal.reason;
        const observed = await observeRouteState(route);
        if (classifyRollbackRouteState(route, observed) === 'completed') {
          completedRouteReadbacks.set(route.artifact, {
            artifact: route.artifact,
            observed_digest: observed.digest,
          });
        }
      }
    },
    runRoute,
    abortSignal: AbortSignal.any([
      processAbort.signal,
      productionMutationLock.signal,
    ]),
  });
} catch (error) {
  if (!terminalConfirmed && terminalPool) {
    const lateEffectRisk = routesStarted;
    try {
      await settleRollbackExecution(
        terminalPool,
        buildIndependentRollbackSettlement({
          claimId,
          generation,
          effectMayHaveStarted: lateEffectRisk,
          errorCode: error?.code ?? 'release_rollback_worker_start_failed',
        }),
      );
      terminalConfirmed = true;
    } catch {
      preservePrivateConfig = true;
    }
  }
  throw error;
} finally {
  await productionMutationLock?.release().catch(() => {});
  process.off('SIGTERM', abortProcess);
  process.off('SIGINT', abortProcess);
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
