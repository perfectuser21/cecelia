#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { planReleaseArtifactRoutes } from '../../packages/brain/src/orchestrator/release-run-routing.js';

const effectKind = process.env.KERNEL_RELEASE_EFFECT_KIND;
const repoRoot = process.env.KERNEL_RELEASE_DEPLOY_ROOT;
let artifactVersions;
try {
  artifactVersions = JSON.parse(process.env.KERNEL_RELEASE_ARTIFACT_VERSIONS || '');
} catch {
  throw new Error('release_effect_worker_artifacts_invalid');
}

let routes = planReleaseArtifactRoutes(effectKind, artifactVersions, {
  repoRoot,
  mergeSha: process.env.KERNEL_RELEASE_MERGE_SHA,
});
const checkoutScript = join(repoRoot, 'scripts/lib/release-run-checkout.sh');
if (!existsSync(checkoutScript)) {
  throw new Error('release_effect_worker_checkout_unavailable');
}
execFileSync('bash', [checkoutScript, effectKind, repoRoot], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
  timeout: 5 * 60_000,
});
routes = planReleaseArtifactRoutes(effectKind, artifactVersions, {
  repoRoot,
  mergeSha: process.env.KERNEL_RELEASE_MERGE_SHA,
});
for (const route of routes) {
  execFileSync('bash', [route.command, ...route.args], {
    cwd: repoRoot,
    env: { ...process.env, ...route.env },
    stdio: 'inherit',
    timeout: 15 * 60_000,
  });
}

if (effectKind === 'production') {
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
