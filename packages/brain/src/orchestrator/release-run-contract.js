export const RELEASE_POLICY_VERSION = 'kernel-release/v1';

export const RELEASE_STATES = Object.freeze([
  'merged',
  'staging_queued',
  'staging_running',
  'staging_passed',
  'production_deploying',
  'production_verified',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const ARTIFACT_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const STATE_INDEX = new Map(RELEASE_STATES.map((state, index) => [state, index]));

export class ReleaseRunError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReleaseRunError';
    this.code = code;
  }
}
function deny(code) {
  throw new ReleaseRunError(code);
}

function boundedString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function exactSha(value, code) {
  if (!SHA_RE.test(value ?? '')) deny(code);
  return value;
}

function exactUuid(value, code) {
  if (!UUID_RE.test(value ?? '')) deny(code);
  return value;
}

export function normalizeArtifactVersions(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    deny('release_artifact_versions_invalid');
  }
  const normalized = value.map((artifact) => {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      deny('release_artifact_invalid');
    }
    const keys = Object.keys(artifact).sort();
    if (keys.join(',') !== 'digest,name,version') deny('release_artifact_shape_invalid');
    if (!ARTIFACT_NAME_RE.test(artifact.name ?? '')) deny('release_artifact_name_invalid');
    if (!boundedString(artifact.version, 128)) deny('release_artifact_version_invalid');
    if (!DIGEST_RE.test(artifact.digest ?? '')) deny('release_artifact_digest_invalid');
    return Object.freeze({
      name: artifact.name,
      version: artifact.version,
      digest: artifact.digest,
    });
  }).sort((left, right) => left.name.localeCompare(right.name));

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].name === normalized[index].name) {
      deny('release_artifact_duplicate');
    }
  }
  return Object.freeze(normalized);
}

export function sameArtifactVersions(left, right) {
  try {
    return JSON.stringify(normalizeArtifactVersions(left))
      === JSON.stringify(normalizeArtifactVersions(right));
  } catch {
    return false;
  }
}

function validateRequiredE2EObservation(observation, expected, scope) {
  if (observation.required_e2e !== 'pass') {
    deny(`release_${scope}_e2e_not_passed`);
  }
  if (
    !DIGEST_RE.test(expected.e2e_manifest_digest ?? '')
    || observation.e2e_manifest_digest !== expected.e2e_manifest_digest
  ) {
    deny(`release_${scope}_e2e_manifest_mismatch`);
  }
  if (
    !Number.isInteger(expected.e2e_scenarios_total)
    || expected.e2e_scenarios_total < 1
    || observation.e2e_scenarios_total !== expected.e2e_scenarios_total
    || observation.e2e_scenarios_passed !== expected.e2e_scenarios_total
  ) {
    deny(`release_${scope}_e2e_count_mismatch`);
  }
  if (observation.e2e_environment !== expected.e2e_environment) {
    deny(`release_${scope}_e2e_environment_mismatch`);
  }
  if (!sameArtifactVersions(observation.e2e_artifact_readback, expected.artifact_versions)) {
    deny(`release_${scope}_e2e_artifacts_mismatch`);
  }
  if (
    !Array.isArray(observation.e2e_scenario_results)
    || observation.e2e_scenario_results.length !== expected.e2e_scenarios_total
    || observation.e2e_scenario_results.some((result, index) => (
      !result
      || typeof result !== 'object'
      || Array.isArray(result)
      || Object.keys(result).sort().join(',')
        !== 'finished_at,log_digest,name,started_at,status'
      || result.name !== expected.e2e_scenario_names[index]
      || result.status !== 'pass'
      || !DIGEST_RE.test(result.log_digest ?? '')
      || Number.isNaN(Date.parse(result.started_at))
      || Number.isNaN(Date.parse(result.finished_at))
      || Date.parse(result.finished_at) < Date.parse(result.started_at)
    ))
    || observation.e2e_started_at !== observation.e2e_scenario_results[0]?.started_at
    || observation.e2e_finished_at
      !== observation.e2e_scenario_results.at(-1)?.finished_at
  ) {
    deny(`release_${scope}_e2e_receipt_invalid`);
  }
  if (
    !Array.isArray(expected.e2e_probes)
    || !Array.isArray(observation.e2e_probe_results)
    || observation.e2e_probe_results.length !== expected.e2e_probes.length
    || observation.e2e_probe_results.some((result, index) => (
      !result
      || typeof result !== 'object'
      || Array.isArray(result)
      || Object.keys(result).sort().join(',')
        !== 'observation_digest,probe_id,scenario_name,status'
      || result.scenario_name !== expected.e2e_probes[index].scenario_name
      || result.probe_id !== expected.e2e_probes[index].probe_id
      || result.status !== 'pass'
      || !DIGEST_RE.test(result.observation_digest ?? '')
    ))
  ) {
    deny(`release_${scope}_e2e_probe_receipt_invalid`);
  }
  return {
    required_e2e: 'pass',
    e2e_manifest_digest: observation.e2e_manifest_digest,
    e2e_environment: observation.e2e_environment,
    e2e_scenarios_total: observation.e2e_scenarios_total,
    e2e_scenarios_passed: observation.e2e_scenarios_passed,
    e2e_scenario_results: Object.freeze(
      observation.e2e_scenario_results.map((result) => Object.freeze({ ...result })),
    ),
    e2e_probe_results: Object.freeze(
      observation.e2e_probe_results.map((result) => Object.freeze({ ...result })),
    ),
    e2e_started_at: observation.e2e_started_at,
    e2e_finished_at: observation.e2e_finished_at,
    e2e_artifact_readback: normalizeArtifactVersions(observation.e2e_artifact_readback),
  };
}

export function validateReleaseIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    deny('release_identity_invalid');
  }
  const identity = {
    run_id: exactUuid(value.run_id, 'release_identity_run_id_invalid'),
    task_id: exactUuid(value.task_id, 'release_identity_task_id_invalid'),
    merge_intent_id: exactUuid(
      value.merge_intent_id,
      'release_identity_merge_intent_id_invalid',
    ),
    merge_receipt_id: exactUuid(
      value.merge_receipt_id,
      'release_identity_merge_receipt_id_invalid',
    ),
    repository: value.repository,
    pr_number: value.pr_number,
    source_head_sha: exactSha(
      value.source_head_sha,
      'release_identity_source_head_sha_invalid',
    ),
    merge_sha: exactSha(value.merge_sha, 'release_identity_merge_sha_invalid'),
    artifact_versions: null,
    policy_version: value.policy_version,
  };
  if (!boundedString(identity.repository, 256) || !identity.repository.includes('/')) {
    deny('release_identity_repository_invalid');
  }
  if (!Number.isInteger(identity.pr_number) || identity.pr_number < 1) {
    deny('release_identity_pr_number_invalid');
  }
  if (identity.policy_version !== RELEASE_POLICY_VERSION) {
    deny('release_identity_policy_version_invalid');
  }
  try {
    identity.artifact_versions = normalizeArtifactVersions(value.artifact_versions);
  } catch {
    deny('release_identity_artifact_versions_invalid');
  }
  return Object.freeze(identity);
}

export function nextReleaseState(current) {
  if (current == null) return RELEASE_STATES[0];
  const index = STATE_INDEX.get(current);
  if (index == null) deny('release_state_invalid');
  return RELEASE_STATES[index + 1] ?? null;
}

export function validateStagingObservation(observation, expected) {
  if (observation?.status !== 'pass') deny('release_staging_not_passed');
  if (
    !Number.isSafeInteger(observation.dispatch_claim_id)
    || observation.dispatch_claim_id < 1
    || !Number.isSafeInteger(observation.dispatch_generation)
    || observation.dispatch_generation < 1
  ) {
    deny('release_staging_dispatch_claim_invalid');
  }
  const e2e = validateRequiredE2EObservation(observation, expected, 'staging');
  if (observation.merge_sha !== expected.merge_sha) deny('release_staging_sha_mismatch');
  if (!sameArtifactVersions(observation.artifact_versions, expected.artifact_versions)) {
    deny('release_staging_artifacts_mismatch');
  }
  return Object.freeze({
    status: 'pass',
    dispatch_claim_id: observation.dispatch_claim_id,
    dispatch_generation: observation.dispatch_generation,
    ...e2e,
    merge_sha: observation.merge_sha,
    artifact_versions: normalizeArtifactVersions(observation.artifact_versions),
  });
}

export function validateProductionObservation(observation, expected) {
  if (observation?.status !== 'pass') deny('release_production_not_passed');
  if (observation.health !== 'pass') deny('release_production_health_not_passed');
  if (
    !Number.isSafeInteger(observation.dispatch_claim_id)
    || observation.dispatch_claim_id < 1
    || !Number.isSafeInteger(observation.dispatch_generation)
    || observation.dispatch_generation < 1
  ) {
    deny('release_production_dispatch_claim_invalid');
  }
  const e2e = validateRequiredE2EObservation(observation, expected, 'production');
  if (observation.merge_sha !== expected.merge_sha) deny('release_production_sha_mismatch');

  let deployedVersions;
  try {
    deployedVersions = normalizeArtifactVersions(observation.deployed_versions);
  } catch (error) {
    if (error?.code === 'release_artifact_versions_invalid') throw error;
    deny('release_production_artifacts_invalid');
  }
  if (!sameArtifactVersions(deployedVersions, expected.artifact_versions)) {
    deny('release_production_artifacts_mismatch');
  }

  const rollback = observation.rollback_metadata;
  if (
    !rollback
    || typeof rollback !== 'object'
    || Array.isArray(rollback)
    || !boundedString(rollback.anchor, 256)
    || !boundedString(rollback.previous_version, 256)
  ) {
    deny('release_production_rollback_invalid');
  }

  return Object.freeze({
    status: 'pass',
    health: 'pass',
    dispatch_claim_id: observation.dispatch_claim_id,
    dispatch_generation: observation.dispatch_generation,
    ...e2e,
    merge_sha: observation.merge_sha,
    deployed_versions: deployedVersions,
    rollback_metadata: Object.freeze({
      anchor: rollback.anchor,
      previous_version: rollback.previous_version,
    }),
  });
}
