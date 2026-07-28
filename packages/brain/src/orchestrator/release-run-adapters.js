import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function json(fetchFn, url, options) {
  const response = await fetchFn(url, options);
  if (!response.ok) throw new Error(`release_http_${response.status}`);
  return response.json();
}

function exactStatus(status, request) {
  return status?.release_run_id === request.release_run_id
    && status?.merge_sha === request.merge_sha
    && status?.release_authorization === request.idempotency_key;
}

export function createReleaseRunAdapters({
  fetchFn = globalThis.fetch,
  gitExecFile = (args) => execFileSync('git', args, { encoding: 'utf8' }),
  readRollbackFile = () => readFileSync('.production-release', 'utf8'),
  brainUrl = process.env.BRAIN_URL ?? 'http://localhost:5221',
  stagingUrl = process.env.BRAIN_STAGING_URL ?? 'http://localhost:5222',
  deployToken = process.env.DEPLOY_TOKEN,
} = {}) {
  const resolveArtifactVersions = async ({ merge_sha: mergeSha }) => {
    const packageJson = JSON.parse(gitExecFile([
      'show',
      `${mergeSha}:packages/brain/package.json`,
    ]));
    const tree = gitExecFile(['ls-tree', '-r', mergeSha]);
    return [{
      name: 'cecelia-source',
      version: packageJson.version,
      digest: sha256(tree),
    }];
  };

  const run = (staging) => async (request) => {
    if (!deployToken) throw new Error('release_deploy_token_unavailable');
    await json(fetchFn, `${brainUrl}/api/brain/deploy`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deployToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        staging,
        release_run_id: request.release_run_id,
        merge_sha: request.merge_sha,
        release_authorization: request.idempotency_key,
        artifact_versions: request.artifact_versions,
        changed_paths: ['packages/brain/', 'apps/dashboard/'],
      }),
    });
  };

  const observeStaging = async (request) => {
    const status = await json(fetchFn, `${brainUrl}/api/brain/deploy/staging/status`);
    if (status.status === 'idle') return { status: 'not_applied' };
    if (status.status !== 'success' || !exactStatus(status, request)) {
      return { status: status.status ?? 'unknown' };
    }
    const health = await json(fetchFn, `${stagingUrl}/api/brain/health`);
    if (health.git_sha !== request.merge_sha) return { status: 'fail' };
    return {
      status: 'pass',
      merge_sha: health.git_sha,
      artifact_versions: request.artifact_versions,
    };
  };

  const observeProduction = async (request) => {
    const status = await json(fetchFn, `${brainUrl}/api/brain/deploy/status`);
    if (status.status === 'idle') return { status: 'not_applied' };
    if (status.status !== 'success' || !exactStatus(status, request)) {
      return { status: status.status ?? 'unknown' };
    }
    const [health, full] = await Promise.all([
      json(fetchFn, `${brainUrl}/api/brain/health`),
      json(fetchFn, `${brainUrl}/api/brain/status/full`),
    ]);
    if (
      health.git_sha !== request.merge_sha
      || health.ok !== true
      || full == null
      || full.error != null
    ) {
      return { status: 'fail' };
    }
    const rollback = Object.fromEntries(
      readRollbackFile().split('\n')
        .filter((line) => line.includes('='))
        .map((line) => line.split('=', 2)),
    );
    if (!rollback.current || !rollback.history) return { status: 'fail' };
    return {
      status: 'pass',
      health: 'pass',
      required_e2e: 'pass',
      merge_sha: health.git_sha,
      deployed_versions: request.artifact_versions,
      rollback_metadata: {
        anchor: rollback.current,
        previous_version: rollback.history.split(',').at(-1),
      },
    };
  };

  return Object.freeze({
    resolveArtifactVersions,
    observeStaging,
    runStaging: run(true),
    observeProduction,
    runProduction: run(false),
  });
}

export const __test__ = { exactStatus, sha256 };
