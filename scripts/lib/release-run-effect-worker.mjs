#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  chmodSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
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
import { prepareReleaseArtifactSnapshot } from './release-run-artifact-snapshot.mjs';
import {
  buildReleaseWorkerEnvironment,
  runLeasedReleaseRoutes,
} from './release-run-worker-runtime.mjs';

const effectKind = process.env.KERNEL_RELEASE_EFFECT_KIND;
const repoRoot = process.env.KERNEL_RELEASE_DEPLOY_ROOT;
const privateConfigFile = process.env.KERNEL_RELEASE_PRIVATE_CONFIG_FILE;
const privateConfig = readPrivateReleaseWorkerConfig(privateConfigFile);
const pool = new pg.Pool({ ...privateConfig.database, max: 1 });
let artifactVersions;
try {
  artifactVersions = JSON.parse(process.env.KERNEL_RELEASE_ARTIFACT_VERSIONS || '');
} catch {
  throw new Error('release_effect_worker_artifacts_invalid');
}

const artifactRoot = prepareReleaseArtifactSnapshot({
  repoRoot,
  artifactStore: process.env.KERNEL_RELEASE_ARTIFACT_STORE
    || join(repoRoot, '.release-artifacts'),
  mergeSha: process.env.KERNEL_RELEASE_MERGE_SHA,
});
const routes = planReleaseArtifactRoutes(effectKind, artifactVersions, {
  repoRoot: artifactRoot,
  mergeSha: process.env.KERNEL_RELEASE_MERGE_SHA,
});

async function runRoute(route, { signal }) {
  const artifact = artifactVersions.find((item) => item.name === route.artifact);
  const env = buildReleaseWorkerEnvironment(process.env, {
    ...route.env,
    KERNEL_RELEASE_ARTIFACT_ROOT: artifactRoot,
    KERNEL_RELEASE_ARTIFACT_NAME: artifact.name,
    KERNEL_RELEASE_ARTIFACT_VERSION: artifact.version,
    KERNEL_RELEASE_ARTIFACT_DIGEST: artifact.digest,
  });
  await new Promise((resolve, reject) => {
    const child = spawn('bash', [route.command, ...route.args], {
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
}

async function persistProductionStatus() {
  if (effectKind !== 'production') return;
  const statusPath = process.env.DEPLOY_STATUS_FILE
    || join(repoRoot, 'logs/cecelia-deploy-status.json');
  let status = {};
  try {
    status = JSON.parse(readFileSync(statusPath, 'utf8'));
  } catch {
    // A non-Brain route has no pre-existing status file.
  }
  const workflow = artifactVersions.find((artifact) => artifact.name === 'workflow-skills');
  if (workflow) {
    status.workflow_rollback_metadata = JSON.parse(readFileSync(
      join(
        repoRoot,
        'logs/release-rollbacks/workflow-skills',
        `${process.env.KERNEL_RELEASE_RUN_ID}.json`,
      ),
      'utf8',
    ));
  }
  const dashboard = artifactVersions.find((artifact) => artifact.name === 'workspace');
  if (dashboard) {
    status.dashboard_rollback_metadata = JSON.parse(readFileSync(
      join(
        repoRoot,
        'logs/release-rollbacks/dashboard',
        `${process.env.KERNEL_RELEASE_RUN_ID}.json`,
      ),
      'utf8',
    ));
  }
  delete status.release_authorization;
  writeFileSync(statusPath, JSON.stringify({
    ...status,
    status: 'success',
    release_run_id: process.env.KERNEL_RELEASE_RUN_ID,
    merge_sha: process.env.KERNEL_RELEASE_MERGE_SHA,
    deployed_artifact_versions: artifactVersions,
    finished_at: new Date().toISOString(),
  }), { mode: 0o600 });
  chmodSync(statusPath, 0o600);
}

try {
  await runLeasedReleaseRoutes({
    routes,
    claimId: Number(process.env.KERNEL_RELEASE_DISPATCH_CLAIM_ID),
    generation: Number(process.env.KERNEL_RELEASE_DISPATCH_GENERATION),
    renew: (claimId, generation) => renewReleaseEffectClaim(pool, {
      dispatch_claim_id: claimId,
      generation,
    }),
    appendOutcome: (claimId, generation, outcome, evidence) => (
      appendDispatchOutcome(pool, claimId, generation, outcome, evidence)
    ),
    runRoute,
    beforeTerminal: persistProductionStatus,
  });
} finally {
  await pool.end();
  cleanupPrivateReleaseWorkerConfig(privateConfigFile);
}
