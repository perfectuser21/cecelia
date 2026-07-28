import { createHash } from 'node:crypto';
import {
  ReleaseRunError,
  normalizeArtifactVersions,
  sameArtifactVersions,
} from './release-run-contract.js';
import {
  executeRegisteredReleaseE2EProbes,
  isRegisteredReleaseE2EProbe,
} from './release-run-e2e-registry.js';

export const RELEASE_E2E_POLICY_VERSION = 'kernel-release-e2e/v2';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MANIFEST_KEYS = Object.freeze([
  'artifact_set_digest',
  'artifact_versions',
  'contract_approved_at',
  'contract_digest',
  'contract_id',
  'contract_version',
  'e2e_acceptance',
  'e2e_acceptance_digest',
  'manifest_digest',
  'merge_sha',
  'policy_version',
  'release_run_id',
  'repository',
  'run_id',
  'scenarios_total',
]);

function deny(code) {
  throw new ReleaseRunError(code);
}

function exactKeys(value, expected, code) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')
  ) {
    deny(code);
  }
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalJson(value));
}

function exactUuid(value) {
  return UUID_RE.test(value ?? '');
}

function exactIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length > 64) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function normalizeAcceptance(value) {
  exactKeys(value, ['scenarios'], 'release_e2e_manifest_acceptance_shape_invalid');
  if (
    !Array.isArray(value.scenarios)
    || value.scenarios.length < 1
    || value.scenarios.length > 64
  ) {
    deny('release_e2e_manifest_acceptance_invalid');
  }

  const names = new Set();
  const scenarios = value.scenarios.map((scenario) => {
    exactKeys(
      scenario,
      ['commands', 'covered_tasks', 'name'],
      'release_e2e_manifest_scenario_shape_invalid',
    );
    if (
      typeof scenario.name !== 'string'
      || scenario.name.trim() !== scenario.name
      || scenario.name.length < 1
      || scenario.name.length > 256
      || names.has(scenario.name)
      || !Array.isArray(scenario.covered_tasks)
      || scenario.covered_tasks.length < 1
      || scenario.covered_tasks.length > 128
      || !scenario.covered_tasks.every(exactUuid)
      || new Set(scenario.covered_tasks).size !== scenario.covered_tasks.length
      || !Array.isArray(scenario.commands)
      || scenario.commands.length < 1
      || scenario.commands.length > 32
    ) {
      deny('release_e2e_manifest_scenario_invalid');
    }
    names.add(scenario.name);
    const commands = scenario.commands.map((command) => {
      exactKeys(command, ['id', 'type'], 'release_e2e_manifest_command_shape_invalid');
      if (
        command.type !== 'probe'
        || !isRegisteredReleaseE2EProbe(command.id)
      ) {
        deny('release_e2e_manifest_command_invalid');
      }
      return Object.freeze({ type: 'probe', id: command.id });
    });
    return Object.freeze({
      name: scenario.name,
      covered_tasks: Object.freeze([...scenario.covered_tasks]),
      commands: Object.freeze(commands),
    });
  });

  return Object.freeze({ scenarios: Object.freeze(scenarios) });
}

function manifestPayload(value) {
  return Object.fromEntries(
    MANIFEST_KEYS
      .filter((key) => key !== 'manifest_digest')
      .map((key) => [key, value[key]]),
  );
}

function digestManifest(value) {
  return sha256(canonicalStringify(manifestPayload(value)));
}

function validateManifestScalars(value) {
  if (value.policy_version !== RELEASE_E2E_POLICY_VERSION) {
    deny('release_e2e_manifest_policy_invalid');
  }
  if (!exactUuid(value.release_run_id)) {
    deny('release_e2e_manifest_release_run_id_invalid');
  }
  if (!exactUuid(value.run_id)) deny('release_e2e_manifest_run_id_invalid');
  if (!REPOSITORY_RE.test(value.repository ?? '')) {
    deny('release_e2e_manifest_repository_invalid');
  }
  if (!SHA_RE.test(value.merge_sha ?? '')) deny('release_e2e_manifest_merge_sha_invalid');
  if (!exactUuid(value.contract_id)) deny('release_e2e_manifest_contract_id_invalid');
  if (!Number.isInteger(value.contract_version) || value.contract_version < 1) {
    deny('release_e2e_manifest_contract_version_invalid');
  }
  if (!exactIsoTimestamp(value.contract_approved_at)) {
    deny('release_e2e_manifest_contract_approval_invalid');
  }
}

export function createRequiredE2EManifest({
  release_run_id: releaseRunId,
  run_id: runId,
  repository,
  merge_sha: mergeSha,
  artifact_versions: artifactVersions,
  contract,
}) {
  exactKeys(
    contract,
    ['approved_at', 'contract_content', 'e2e_acceptance', 'id', 'version'],
    'release_e2e_manifest_contract_shape_invalid',
  );
  const base = {
    policy_version: RELEASE_E2E_POLICY_VERSION,
    release_run_id: releaseRunId,
    run_id: runId,
    repository,
    merge_sha: mergeSha,
    contract_id: contract.id,
    contract_version: contract.version,
    contract_approved_at: contract.approved_at,
  };
  validateManifestScalars(base);
  if (
    typeof contract.contract_content !== 'string'
    || contract.contract_content.length < 1
    || contract.contract_content.length > 1024 * 1024
  ) {
    deny('release_e2e_manifest_contract_content_invalid');
  }
  const artifacts = normalizeArtifactVersions(artifactVersions);
  const e2eAcceptance = normalizeAcceptance(contract.e2e_acceptance);
  const manifest = {
    ...base,
    artifact_versions: artifacts,
    artifact_set_digest: sha256(canonicalStringify(artifacts)),
    contract_digest: sha256(contract.contract_content),
    e2e_acceptance: e2eAcceptance,
    e2e_acceptance_digest: sha256(canonicalStringify(e2eAcceptance)),
    scenarios_total: e2eAcceptance.scenarios.length,
  };
  return Object.freeze({
    ...manifest,
    manifest_digest: digestManifest(manifest),
  });
}

export function validateRequiredE2EManifest(value, expected = {}) {
  exactKeys(value, MANIFEST_KEYS, 'release_e2e_manifest_shape_invalid');
  validateManifestScalars(value);
  const artifacts = normalizeArtifactVersions(value.artifact_versions);
  const e2eAcceptance = normalizeAcceptance(value.e2e_acceptance);
  if (
    value.scenarios_total !== e2eAcceptance.scenarios.length
    || value.scenarios_total < 1
    || !DIGEST_RE.test(value.artifact_set_digest ?? '')
    || value.artifact_set_digest !== sha256(canonicalStringify(artifacts))
    || !DIGEST_RE.test(value.contract_digest ?? '')
    || !DIGEST_RE.test(value.e2e_acceptance_digest ?? '')
    || value.e2e_acceptance_digest !== sha256(canonicalStringify(e2eAcceptance))
    || !DIGEST_RE.test(value.manifest_digest ?? '')
    || value.manifest_digest !== digestManifest({ ...value, artifact_versions: artifacts })
  ) {
    deny('release_e2e_manifest_digest_mismatch');
  }

  for (const key of [
    'release_run_id',
    'run_id',
    'repository',
    'merge_sha',
    'contract_id',
    'contract_version',
    'contract_approved_at',
    'contract_digest',
    'e2e_acceptance_digest',
  ]) {
    if (expected[key] != null && value[key] !== expected[key]) {
      deny('release_e2e_manifest_authority_mismatch');
    }
  }
  if (
    expected.artifact_versions != null
    && !sameArtifactVersions(artifacts, expected.artifact_versions)
  ) {
    deny('release_e2e_manifest_artifacts_mismatch');
  }
  return Object.freeze({
    ...value,
    artifact_versions: artifacts,
    e2e_acceptance: e2eAcceptance,
  });
}

function validateScenarioResults(result, manifest) {
  if (
    result?.verdict !== 'PASS'
    || result.scenariosTotal !== manifest.scenarios_total
    || result.scenariosPassed !== manifest.scenarios_total
    || !Array.isArray(result.scenarioResults)
    || result.scenarioResults.length !== manifest.scenarios_total
  ) {
    deny('release_e2e_execution_not_passed');
  }
  const scenarioResults = result.scenarioResults.map((scenario, index) => {
    exactKeys(
      scenario,
      ['finished_at', 'log_digest', 'name', 'started_at', 'status'],
      'release_e2e_execution_not_passed',
    );
    if (
      scenario.name !== manifest.e2e_acceptance.scenarios[index].name
      || scenario.status !== 'pass'
      || !exactIsoTimestamp(scenario.started_at)
      || !exactIsoTimestamp(scenario.finished_at)
      || new Date(scenario.finished_at) < new Date(scenario.started_at)
      || !DIGEST_RE.test(scenario.log_digest ?? '')
    ) {
      deny('release_e2e_execution_not_passed');
    }
    return Object.freeze({ ...scenario });
  });
  return Object.freeze(scenarioResults);
}

function validateProbeResults(result, manifest) {
  const expected = manifest.e2e_acceptance.scenarios.flatMap(
    (scenario) => scenario.commands.map((command) => ({
      scenario_name: scenario.name,
      probe_id: command.id,
    })),
  );
  if (
    !Array.isArray(result.probeResults)
    || result.probeResults.length !== expected.length
  ) {
    deny('release_e2e_execution_probe_evidence_invalid');
  }
  return Object.freeze(result.probeResults.map((probe, index) => {
    exactKeys(
      probe,
      ['observation_digest', 'probe_id', 'scenario_name', 'status'],
      'release_e2e_execution_probe_evidence_invalid',
    );
    if (
      probe.scenario_name !== expected[index].scenario_name
      || probe.probe_id !== expected[index].probe_id
      || probe.status !== 'pass'
      || !DIGEST_RE.test(probe.observation_digest ?? '')
    ) {
      deny('release_e2e_execution_probe_evidence_invalid');
    }
    return Object.freeze({ ...probe });
  }));
}

export async function executeRequiredE2EManifest(value, {
  environment,
  artifact_readback: artifactReadback,
  fetchFn,
  endpoints,
  now,
} = {}) {
  const manifest = validateRequiredE2EManifest(value);
  if (!['staging', 'production'].includes(environment)) {
    deny('release_e2e_execution_environment_invalid');
  }
  if (!sameArtifactVersions(artifactReadback, manifest.artifact_versions)) {
    deny('release_e2e_execution_artifacts_mismatch');
  }
  let result;
  try {
    result = await executeRegisteredReleaseE2EProbes(
      manifest.e2e_acceptance,
      {
        environment,
        artifactVersions: manifest.artifact_versions,
        mergeSha: manifest.merge_sha,
        fetchFn,
        endpoints,
        now,
      },
    );
  } catch {
    deny('release_e2e_runner_unavailable');
  }
  const scenarioResults = validateScenarioResults(result, manifest);
  const probeResults = validateProbeResults(result, manifest);
  return Object.freeze({
    status: 'pass',
    environment,
    merge_sha: manifest.merge_sha,
    manifest_digest: manifest.manifest_digest,
    artifact_readback: normalizeArtifactVersions(artifactReadback),
    scenarios_total: result.scenariosTotal,
    scenarios_passed: result.scenariosPassed,
    scenario_results: scenarioResults,
    probe_results: probeResults,
    started_at: scenarioResults[0].started_at,
    finished_at: scenarioResults.at(-1).finished_at,
  });
}

export const __test__ = {
  digestManifest,
  canonicalStringify,
  normalizeAcceptance,
  sha256,
};
