import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { sameArtifactVersions } from './release-run-contract.js';

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

function exactE2EReceipt(receipt, request) {
  return receipt?.status === 'pass'
    && receipt.release_run_id === request.release_run_id
    && receipt.merge_sha === request.merge_sha
    && /^sha256:[0-9a-f]{64}$/.test(receipt.evidence_digest ?? '')
    && sameArtifactVersions(receipt.artifact_versions, request.artifact_versions);
}

export function createReleaseRunAdapters({
  fetchFn = globalThis.fetch,
  gitExecFile = (args) => execFileSync('git', args, { encoding: 'utf8' }),
  readDashboardRollback = () => readFileSync('.production-release', 'utf8'),
  brainUrl = process.env.BRAIN_URL ?? 'http://localhost:5221',
  stagingUrl = process.env.BRAIN_STAGING_URL ?? 'http://localhost:5222',
  dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:5211',
  deployToken = process.env.DEPLOY_TOKEN,
} = {}) {
  const resolveArtifactVersions = async ({ merge_sha: mergeSha }) => {
    const packageJson = JSON.parse(gitExecFile([
      'show',
      `${mergeSha}:packages/brain/package.json`,
    ]));
    const paths = gitExecFile(['diff-tree', '--no-commit-id', '--name-only', '-r', `${mergeSha}^`, mergeSha])
      .trim().split('\n').filter(Boolean);
    const artifacts = [];
    if (paths.some((path) => path.startsWith('packages/brain/')
      || ['DEFINITION.md', '.brain-versions'].includes(path))) {
      artifacts.push({
        name: 'brain',
        version: packageJson.version,
        digest: sha256(gitExecFile(['ls-tree', '-r', mergeSha, 'packages/brain'])),
      });
    }
    if (paths.some((path) => path.startsWith('apps/'))) {
      artifacts.push({
        name: 'workspace',
        version: mergeSha.slice(0, 12),
        digest: sha256(gitExecFile(['ls-tree', '-r', mergeSha, 'apps'])),
      });
    }
    if (paths.some((path) => path.startsWith('packages/workflows/skills/'))) {
      artifacts.push({
        name: 'workflow-skills',
        version: mergeSha.slice(0, 12),
        digest: sha256(gitExecFile(['ls-tree', '-r', mergeSha, 'packages/workflows/skills'])),
      });
    }
    if (artifacts.length === 0) {
      throw new Error('release_non_deployable_change_blocked');
    }
    return artifacts;
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
        changed_paths: request.artifact_versions.flatMap((artifact) => ({
          brain: ['packages/brain/'],
          workspace: ['apps/'],
          'workflow-skills': ['packages/workflows/skills/'],
        })[artifact.name] ?? []),
      }),
    });
  };

  const observeStaging = async (request) => {
    const status = await json(fetchFn, `${brainUrl}/api/brain/deploy/staging/status`);
    if (status.status === 'idle') return { status: 'not_applied' };
    if (status.status !== 'success' || !exactStatus(status, request)) {
      return { status: status.status ?? 'unknown' };
    }
    if (
      !exactE2EReceipt(status.e2e_receipt, request)
      || !sameArtifactVersions(status.deployed_artifact_versions, request.artifact_versions)
    ) return { status: 'fail' };
    const health = await json(fetchFn, `${stagingUrl}/api/brain/health`);
    const brain = request.artifact_versions.find((item) => item.name === 'brain');
    if (brain && (health.git_sha !== request.merge_sha
      || health.status !== 'healthy'
      || health.version !== brain.version)) return { status: 'fail' };
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
    const brain = request.artifact_versions.find((item) => item.name === 'brain');
    const dashboard = request.artifact_versions.find((item) => item.name === 'workspace');
    if (brain && (health.git_sha !== request.merge_sha
      || health.status !== 'healthy'
      || health.version !== brain.version)) {
      return { status: 'fail' };
    }
    if (full == null || full.error != null) return { status: 'fail' };
    if (
      !exactE2EReceipt(status.e2e_receipt, request)
      || !sameArtifactVersions(status.deployed_artifact_versions, request.artifact_versions)
    ) return { status: 'fail' };
    if (dashboard) {
      const build = await json(fetchFn, `${dashboardUrl}/build-info.json`);
      if (build.git_sha !== request.merge_sha) return { status: 'fail' };
    }
    const anchors = [];
    const previousVersions = [];
    if (brain) {
      if (
        !/^sha256:[0-9a-f]{64}$/.test(status.deployed_image_digest ?? '')
        || !/^sha256:[0-9a-f]{64}$/.test(status.rollback_image_digest ?? '')
        || status.rollback_image_reference !== status.rollback_image_digest
        || !/^cecelia-brain:rollback-[0-9a-f]{12}$/.test(status.rollback_image_tag ?? '')
        || status.rollback_image_exists !== true
        || status.rollback_probe !== 'pass'
        || typeof status.rollback_command !== 'string'
        || !status.rollback_command.includes(
          status.rollback_image_tag.replace('cecelia-brain:', ''),
        )
        || status.deployed_image_digest === status.rollback_image_digest
      ) return { status: 'fail' };
      anchors.push(`brain-image:${status.deployed_image_digest}`);
      previousVersions.push(`brain-image:${status.rollback_image_digest}`);
    }
    if (dashboard) {
      const rollback = Object.fromEntries(
        readDashboardRollback().split('\n')
          .filter((line) => line.includes('='))
          .map((line) => line.split('=', 2)),
      );
      if (
        !rollback.current
        || !rollback.history
        || rollback.commit !== request.merge_sha
      ) return { status: 'fail' };
      anchors.push(`dashboard:${rollback.current}`);
      previousVersions.push(`dashboard:${rollback.history.split(',').at(-1)}`);
    }
    return {
      status: 'pass',
      health: 'pass',
      required_e2e: 'pass',
      merge_sha: health.git_sha,
      deployed_versions: request.artifact_versions,
      rollback_metadata: {
        anchor: anchors.join('+'),
        previous_version: previousVersions.join('+'),
        ...(brain ? {
          image_reference: status.rollback_image_reference,
          image_tag: status.rollback_image_tag,
          rollback_command: status.rollback_command,
          probe: status.rollback_probe,
        } : {}),
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
