import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sameArtifactVersions } from './release-run-contract.js';
import { executeRequiredE2EManifest } from './release-run-e2e.js';
import { resolveReleaseArtifactVersions } from './release-run-artifacts.js';

async function json(fetchFn, url, options) {
  const response = await fetchFn(url, options);
  if (!response.ok) throw new Error(`release_http_${response.status}`);
  return response.json();
}

function exactStatus(status, request) {
  return status?.release_run_id === request.release_run_id
    && status?.merge_sha === request.merge_sha;
}

export function createReleaseRunAdapters({
  fetchFn = globalThis.fetch,
  e2eFetchFn = fetchFn,
  gitExecFile = (args) => execFileSync('git', args, { encoding: 'utf8' }),
  repoRoot = process.env.REPO_ROOT
    ?? fileURLToPath(new URL('../../../..', import.meta.url)),
  brainUrl = process.env.BRAIN_URL ?? 'http://localhost:5221',
  stagingUrl = process.env.BRAIN_STAGING_URL ?? 'http://localhost:5222',
  dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:5211',
  dashboardStagingUrl = process.env.DASHBOARD_STAGING_URL
    ?? 'http://localhost:5212',
  deployToken = process.env.DEPLOY_TOKEN,
} = {}) {
  const runRequiredE2E = async (request, environment, artifactReadback) => {
    const { id: _manifestId, ...manifest } = request.e2e_manifest ?? {};
    const receipt = await executeRequiredE2EManifest(manifest, {
      environment,
      artifact_readback: artifactReadback,
      fetchFn: e2eFetchFn,
      endpoints: {
        brain: environment === 'staging' ? stagingUrl : brainUrl,
        dashboard: environment === 'staging'
          ? dashboardStagingUrl
          : dashboardUrl,
      },
    });
    return {
      required_e2e: 'pass',
      e2e_manifest_digest: receipt.manifest_digest,
      e2e_environment: receipt.environment,
      e2e_scenarios_total: receipt.scenarios_total,
      e2e_scenarios_passed: receipt.scenarios_passed,
      e2e_scenario_results: receipt.scenario_results,
      e2e_probe_results: receipt.probe_results,
      e2e_started_at: receipt.started_at,
      e2e_finished_at: receipt.finished_at,
      e2e_artifact_readback: receipt.artifact_readback,
    };
  };
  const resolveArtifactVersions = (request) => resolveReleaseArtifactVersions(
    request,
    { gitExecFile },
  );
  const claimVerification = async (request, effectKind) => {
    if (!deployToken) throw new Error('release_deploy_token_unavailable');
    const claim = await json(
      fetchFn,
      `${brainUrl}/api/brain/release-runs/verification-claim`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${deployToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          release_run_id: request.release_run_id,
          merge_sha: request.merge_sha,
          release_authorization: request.idempotency_key,
          effect_kind: effectKind,
        }),
      },
    );
    if (
      !Number.isInteger(Number(claim.dispatch_claim_id))
      || !Number.isInteger(Number(claim.generation))
    ) {
      throw new Error('release_verification_claim_invalid');
    }
    return {
      dispatch_claim_id: Number(claim.dispatch_claim_id),
      dispatch_generation: Number(claim.generation),
    };
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
    if (!sameArtifactVersions(
      status.deployed_artifact_versions,
      request.artifact_versions,
    )) return { status: 'fail' };
    const health = await json(fetchFn, `${stagingUrl}/api/brain/health`);
    const brain = request.artifact_versions.find((item) => item.name === 'brain');
    if (brain && (health.git_sha !== request.merge_sha
      || health.status !== 'healthy'
      || health.version !== brain.version)) return { status: 'fail' };
    try {
      const e2e = await runRequiredE2E(
        request,
        'staging',
        status.deployed_artifact_versions,
      );
      const verificationClaim = await claimVerification(request, 'staging');
      return {
        status: 'pass',
        ...e2e,
        ...verificationClaim,
        merge_sha: brain ? health.git_sha : status.merge_sha,
        artifact_versions: request.artifact_versions,
      };
    } catch {
      return { status: 'fail' };
    }
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
    const workflowSkills = request.artifact_versions.find(
      (item) => item.name === 'workflow-skills',
    );
    if (brain && (health.git_sha !== request.merge_sha
      || health.status !== 'healthy'
      || health.version !== brain.version)) {
      return { status: 'fail' };
    }
    if (full == null || full.error != null) return { status: 'fail' };
    if (!sameArtifactVersions(
      status.deployed_artifact_versions,
      request.artifact_versions,
    )) return { status: 'fail' };
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
      const rollback = status.dashboard_rollback_metadata;
      if (
        rollback?.schema_version !== 1
        || rollback.release_run_id !== request.release_run_id
        || rollback.merge_sha !== request.merge_sha
        || rollback.artifact_name !== 'workspace'
        || rollback.current_version !== dashboard.version
        || rollback.current_digest !== dashboard.digest
        || !/^prod-cecelia-v[0-9]+$/.test(rollback.old_tag ?? '')
        || !/^prod-cecelia-v[0-9]+$/.test(rollback.new_tag ?? '')
        || rollback.anchor !== `dashboard:${rollback.new_tag}`
        || rollback.previous_version !== `dashboard:${rollback.old_tag}`
        || !/^sha256:[0-9a-f]{64}$/.test(rollback.previous_digest ?? '')
      ) return { status: 'fail' };
      anchors.push(rollback.anchor);
      previousVersions.push(rollback.previous_version);
    }
    if (workflowSkills) {
      const workflowRollback = status.workflow_rollback_metadata;
      if (
        workflowRollback?.anchor !== `workflow-skills:${workflowSkills.digest}`
        || !/^workflow-skills:sha256:[0-9a-f]{64}$/.test(
          workflowRollback?.previous_version ?? '',
        )
      ) return { status: 'fail' };
      anchors.push(workflowRollback.anchor);
      previousVersions.push(workflowRollback.previous_version);
    }
    try {
      const e2e = await runRequiredE2E(
        request,
        'production',
        status.deployed_artifact_versions,
      );
      const verificationClaim = await claimVerification(request, 'production');
      return {
        status: 'pass',
        health: 'pass',
        ...e2e,
        ...verificationClaim,
        merge_sha: brain ? health.git_sha : status.merge_sha,
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
    } catch {
      return { status: 'fail' };
    }
  };

  return Object.freeze({
    resolveArtifactVersions,
    observeStaging,
    runStaging: run(true),
    observeProduction,
    runProduction: run(false),
  });
}

export const __test__ = { exactStatus };
