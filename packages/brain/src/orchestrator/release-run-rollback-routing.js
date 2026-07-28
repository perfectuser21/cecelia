import { existsSync as defaultExistsSync } from 'node:fs';
import { join } from 'node:path';
import { ReleaseRunError } from './release-run-contract.js';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BRAIN_TAG_RE = /^cecelia-brain:rollback-([0-9a-f]{12})$/;
const DASHBOARD_TAG_RE = /^prod-cecelia-v[1-9][0-9]*$/;
const IMMUTABLE_CONTROLLER_ROOT = '/repo';

function deny(code) {
  throw new ReleaseRunError(code);
}

function brainRoute(target) {
  const match = BRAIN_TAG_RE.exec(target.rollback_metadata?.image_tag ?? '');
  if (
    !match
    || !DIGEST_RE.test(target.previous_digest ?? '')
    || target.previous_version !== `brain-image:${target.previous_digest}`
    || target.rollback_metadata?.image_reference !== target.previous_digest
    || !DIGEST_RE.test(target.rollback_metadata?.current_image_digest ?? '')
    || !target.previous_digest.startsWith(`sha256:${match[1]}`)
  ) {
    deny('release_rollback_route_brain_invalid');
  }
  return {
    artifact: 'brain',
    command: join(IMMUTABLE_CONTROLLER_ROOT, 'scripts/brain-rollback.sh'),
    args: [`rollback-${match[1]}`],
    expected_digest: target.previous_digest,
    expected_current_digest: target.rollback_metadata.current_image_digest,
    readback_kind: 'brain-image',
  };
}

function workspaceRoute(target, _repoRoot, releaseRunId) {
  const oldTag = target.rollback_metadata?.old_tag;
  if (
    !DASHBOARD_TAG_RE.test(oldTag ?? '')
    || target.rollback_metadata?.schema_version !== 1
    || target.rollback_metadata?.release_run_id !== releaseRunId
    || target.rollback_metadata?.artifact_name !== 'workspace'
    || !/^[0-9a-f]{40}$/.test(target.rollback_metadata?.previous_merge_sha ?? '')
    || !/^[0-9a-f]{40}$/.test(target.rollback_metadata?.merge_sha ?? '')
    || !DIGEST_RE.test(target.rollback_metadata?.current_deployed_digest ?? '')
    || target.previous_version !== `dashboard:${oldTag}`
    || !DIGEST_RE.test(target.previous_digest ?? '')
  ) {
    deny('release_rollback_route_workspace_invalid');
  }
  return {
    artifact: 'workspace',
    command: join(IMMUTABLE_CONTROLLER_ROOT, 'scripts/promote-dashboard.sh'),
    args: ['--rollback', oldTag],
    expected_digest: target.previous_digest,
    expected_current_digest: target.rollback_metadata.current_deployed_digest,
    expected_current_version: target.rollback_metadata.new_tag,
    expected_current_merge_sha: target.rollback_metadata.merge_sha,
    readback_kind: 'dashboard-release',
    target_merge_sha: target.rollback_metadata.previous_merge_sha,
  };
}

function workflowRoute(target, _repoRoot, releaseRunId) {
  if (
    !DIGEST_RE.test(target.previous_digest ?? '')
    || target.previous_version !== `workflow-skills:${target.previous_digest}`
    || !DIGEST_RE.test(target.rollback_metadata?.current_links_digest ?? '')
  ) {
    deny('release_rollback_route_workflow_invalid');
  }
  return {
    artifact: 'workflow-skills',
    command: join(
      IMMUTABLE_CONTROLLER_ROOT,
      'packages/workflows/scripts/deploy-workflow-skills.sh',
    ),
    args: ['--rollback', releaseRunId],
    expected_digest: target.previous_digest,
    expected_current_digest: target.rollback_metadata.current_links_digest,
    readback_kind: 'workflow-links',
  };
}

const ROUTERS = Object.freeze({
  brain: brainRoute,
  workspace: workspaceRoute,
  'workflow-skills': workflowRoute,
});

export function planRollbackArtifactRoutes(rollbackTargets, {
  repoRoot,
  releaseRunId,
  existsSync = defaultExistsSync,
} = {}) {
  if (
    !Array.isArray(rollbackTargets)
    || rollbackTargets.length === 0
    || typeof repoRoot !== 'string'
    || !repoRoot.startsWith('/')
    || !UUID_RE.test(releaseRunId ?? '')
  ) {
    deny('release_rollback_route_request_invalid');
  }
  const seen = new Set();
  return rollbackTargets.map((target) => {
    const name = target?.artifact_name;
    if (seen.has(name)) deny('release_rollback_route_duplicate');
    seen.add(name);
    const route = ROUTERS[name];
    if (!route) deny('release_rollback_route_unknown');
    const planned = route(target, repoRoot, releaseRunId);
    if (!existsSync(planned.command)) deny('release_rollback_route_unavailable');
    return Object.freeze(planned);
  });
}

export const __test__ = {
  DIGEST_RE,
  UUID_RE,
  BRAIN_TAG_RE,
  DASHBOARD_TAG_RE,
  IMMUTABLE_CONTROLLER_ROOT,
  ROUTERS,
};
