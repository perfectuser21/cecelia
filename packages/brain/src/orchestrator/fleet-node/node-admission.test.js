import { describe, expect, it } from 'vitest';

const NOW_MS = Date.parse('2026-07-27T08:00:00.000Z');
const GIB = 1024 ** 3;
const REQUIRED_SECTIONS = [
  'worker',
  'runner',
  'os',
  'orbstack',
  'docker',
  'resources',
  'git',
  'node',
  'codex',
  'tailscale',
  'callback',
  'time_sync',
  'power',
  'launchd',
  'worktree',
  'container',
  'drain',
];
const REQUIRED_LEAVES = [
  'schema_version',
  'machine_id',
  'observed_at',
  'worker.protocol_version',
  'worker.contract_version',
  'worker.version',
  'runner.version',
  'runner.image_digest',
  'os.version',
  'orbstack.version',
  'docker.available',
  'docker.observed_at',
  'resources.cpu_cores',
  'resources.memory_bytes',
  'resources.disk_free_bytes',
  'resources.disk_used_percent',
  'resources.cpu_pressure_percent',
  'resources.memory_pressure_percent',
  'git.available',
  'git.version',
  'node.available',
  'node.version',
  'codex.available',
  'codex.version',
  'tailscale.connected',
  'callback.reachable',
  'time_sync.synchronized',
  'power.sleep_disabled',
  'power.auto_power_on',
  'launchd.loaded',
  'launchd.domain',
  'launchd.kind',
  'worktree.root_ready',
  'container.probe_succeeded',
  'drain.active',
];
const REQUIRED_EVIDENCE_PATHS = [...REQUIRED_SECTIONS, ...REQUIRED_LEAVES];

async function loadContract() {
  const profileModule = await import('./node-profile.js').catch(() => ({}));
  const admissionModule = await import('./node-admission.js').catch(() => ({}));
  expect(admissionModule.evaluateBaseAdmission, 'missing base-admission evaluator').toBeTypeOf('function');
  expect(profileModule.getNodeProfile, 'missing NodeProfile lookup').toBeTypeOf('function');
  return { ...profileModule, ...admissionModule };
}

function completeReport(profile, overrides = {}) {
  const policy = profile.version_policy;
  const report = {
    schema_version: 'fleet-node-health/v1',
    machine_id: profile.machine_id,
    observed_at: new Date(NOW_MS - 5_000).toISOString(),
    worker: {
      protocol_version: policy.worker_protocol,
      contract_version: policy.worker_contract,
      version: policy.worker,
    },
    runner: {
      version: policy.runner,
      image_digest: profile.runner_image_digest,
    },
    os: { version: policy.os },
    orbstack: { version: policy.orbstack },
    docker: {
      available: true,
      observed_at: new Date(NOW_MS - 4_000).toISOString(),
    },
    resources: {
      cpu_cores: 6,
      memory_bytes: 8 * GIB,
      disk_free_bytes: 40 * GIB,
      disk_used_percent: 85,
      cpu_pressure_percent: profile.resources.cpu_pressure_max_percent - 1,
      memory_pressure_percent: profile.resources.memory_pressure_max_percent - 1,
    },
    git: { available: true, version: policy.git },
    node: { available: true, version: policy.node },
    codex: { available: true, version: policy.codex },
    tailscale: { connected: true },
    callback: { reachable: true },
    time_sync: { synchronized: true },
    power: { sleep_disabled: true, auto_power_on: true },
    launchd: { loaded: true, domain: 'system', kind: 'LaunchDaemon' },
    worktree: { root_ready: true },
    container: { probe_succeeded: true },
    drain: { active: false },
  };
  return merge(report, overrides);
}

function merge(base, patch) {
  const output = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && output[key] && typeof output[key] === 'object') {
      output[key] = { ...output[key], ...value };
    } else {
      output[key] = value;
    }
  }
  return output;
}

function withoutPath(value, dottedPath) {
  const output = structuredClone(value);
  const parts = dottedPath.split('.');
  const leaf = parts.pop();
  let parent = output;
  for (const part of parts) parent = parent[part];
  delete parent[leaf];
  return output;
}

async function fixture(machineId = 'xian-mac-m4', overrides = {}) {
  const contract = await loadContract();
  const profile = contract.getNodeProfile(machineId);
  return {
    contract,
    profile,
    report: completeReport(profile, overrides),
  };
}

function expectDraining(result, code) {
  expect(result).toMatchObject({
    state: 'draining',
    base_admitted: false,
    dispatch_ready: false,
    reasons: expect.any(Array),
  });
  expect(result.reasons.map((reason) => reason.code)).toContain(code);
}

function expectInvalid(result, field) {
  expectDraining(result, 'invalid_evidence');
  expect(result.reasons).toContainEqual(expect.objectContaining({
    code: 'invalid_evidence',
    field,
    message: expect.any(String),
  }));
}

describe('pure Fleet Node base admission', () => {
  it('base-admits one complete fresh report without ever declaring dispatch readiness', async () => {
    const { contract, profile, report } = await fixture();
    const inputBefore = structuredClone(report);

    const result = contract.evaluateBaseAdmission(report, { profile, nowMs: NOW_MS });

    expect(result).toEqual({
      machine_id: profile.machine_id,
      state: 'base_admitted',
      base_admitted: true,
      dispatch_ready: false,
      observed_at: report.observed_at,
      reasons: [],
    });
    expect(report).toEqual(inputBefore);
  });

  it.each([
    ['a missing report', null, 'health_report_missing'],
    ['a malformed report', 'not-an-object', 'health_report_malformed'],
    ['a stale report', { observed_at: new Date(NOW_MS - 90_001).toISOString() }, 'health_report_stale'],
    ['a future report', { observed_at: new Date(NOW_MS + 30_001).toISOString() }, 'health_report_clock_skew'],
    ['an identity mismatch', { machine_id: 'us-mac-m4' }, 'machine_identity_mismatch'],
    ['an active drain marker', { drain: { active: true } }, 'node_drained'],
  ])('fails closed for %s', async (_name, reportOrPatch, code) => {
    const { contract, profile, report } = await fixture();
    const input = reportOrPatch === null || typeof reportOrPatch !== 'object'
      ? reportOrPatch
      : merge(report, reportOrPatch);
    expectDraining(
      contract.evaluateBaseAdmission(input, { profile, nowMs: NOW_MS }),
      code,
    );
  });

  it.each(REQUIRED_EVIDENCE_PATHS)(
    'drains with a structured generic reason when required evidence %s is omitted',
    async (missingPath) => {
      const { contract, profile, report } = await fixture();
      const result = contract.evaluateBaseAdmission(
        withoutPath(report, missingPath),
        { profile, nowMs: NOW_MS },
      );

      expectDraining(result, 'required_evidence_missing');
      expect(result.reasons).toContainEqual(expect.objectContaining({
        code: 'required_evidence_missing',
        field: missingPath,
        message: expect.any(String),
      }));
    },
  );

  it.each([
    ['wrong schema', { schema_version: 'fleet-node-health/v999' }, 'schema_version'],
    ['invalid report timestamp', { observed_at: 'yesterday-ish' }, 'observed_at'],
    ['non-finite report timestamp', { observed_at: 'Infinity' }, 'observed_at'],
    ['invalid Docker timestamp', { docker: { observed_at: 'not-a-time' } }, 'docker.observed_at'],
    ['string Docker availability', { docker: { available: 'true' } }, 'docker.available'],
    ['string Git availability', { git: { available: 'true' } }, 'git.available'],
    ['string Tailscale state', { tailscale: { connected: 'true' } }, 'tailscale.connected'],
    ['string callback state', { callback: { reachable: 'true' } }, 'callback.reachable'],
    ['string time-sync state', { time_sync: { synchronized: 'true' } }, 'time_sync.synchronized'],
    ['string sleep state', { power: { sleep_disabled: 'true' } }, 'power.sleep_disabled'],
    ['string auto-power state', { power: { auto_power_on: 'true' } }, 'power.auto_power_on'],
    ['string launchd state', { launchd: { loaded: 'true' } }, 'launchd.loaded'],
    ['string worktree state', { worktree: { root_ready: 'true' } }, 'worktree.root_ready'],
    ['string container state', { container: { probe_succeeded: 'true' } }, 'container.probe_succeeded'],
    ['string drain state', { drain: { active: 'false' } }, 'drain.active'],
    ['wrong worker type', { worker: [] }, 'worker'],
    ['wrong runner type', { runner: 'runner' }, 'runner'],
    ['wrong resources type', { resources: [] }, 'resources'],
    ['wrong power type', { power: 7 }, 'power'],
    ['NaN CPU count', { resources: { cpu_cores: Number.NaN } }, 'resources.cpu_cores'],
    ['infinite memory', { resources: { memory_bytes: Number.POSITIVE_INFINITY } }, 'resources.memory_bytes'],
    ['negative disk free', { resources: { disk_free_bytes: -1 } }, 'resources.disk_free_bytes'],
    ['NaN disk use', { resources: { disk_used_percent: Number.NaN } }, 'resources.disk_used_percent'],
    ['infinite CPU pressure', {
      resources: { cpu_pressure_percent: Number.POSITIVE_INFINITY },
    }, 'resources.cpu_pressure_percent'],
    ['negative memory pressure', {
      resources: { memory_pressure_percent: -1 },
    }, 'resources.memory_pressure_percent'],
  ])('drains with structured invalid evidence for %s', async (_name, patch, field) => {
    const { contract, profile, report } = await fixture('xian-mac-m4', patch);
    expectInvalid(
      contract.evaluateBaseAdmission(report, { profile, nowMs: NOW_MS }),
      field,
    );
  });

  it.each([
    ['worker.protocol_version', { worker: { protocol_version: 'v999' } }, 'worker_protocol_drift'],
    ['worker.contract_version', { worker: { contract_version: 'v999' } }, 'worker_contract_drift'],
    ['worker.version', { worker: { version: '0.0.0-drift' } }, 'worker_version_drift'],
    ['runner.version', { runner: { version: '0.0.0-drift' } }, 'runner_version_drift'],
    ['runner.image_digest', { runner: { image_digest: `sha256:${'0'.repeat(64)}` } }, 'runner_digest_drift'],
    ['os.version', { os: { version: '0.0-drift' } }, 'os_version_drift'],
    ['orbstack.version', { orbstack: { version: '0.0-drift' } }, 'orbstack_version_drift'],
    ['git.version', { git: { version: '0.0-drift' } }, 'git_version_drift'],
    ['node.version', { node: { version: '0.0-drift' } }, 'node_version_drift'],
    ['codex.version', { codex: { version: '0.0-drift' } }, 'codex_version_drift'],
  ])('rejects version-policy drift at %s', async (_field, patch, code) => {
    const { contract, profile, report } = await fixture('xian-mac-m4', patch);
    expectDraining(
      contract.evaluateBaseAdmission(report, { profile, nowMs: NOW_MS }),
      code,
    );
  });

  it.each([
    ['Docker unavailable', { docker: { available: false } }, 'docker_unavailable'],
    ['Docker observation stale', {
      docker: { observed_at: new Date(NOW_MS - 90_001).toISOString() },
    }, 'docker_observation_stale'],
    ['Git unavailable', { git: { available: false } }, 'git_unavailable'],
    ['Tailscale disconnected', { tailscale: { connected: false } }, 'tailscale_disconnected'],
    ['callback unreachable', { callback: { reachable: false } }, 'callback_unreachable'],
    ['time unsynchronized', { time_sync: { synchronized: false } }, 'time_unsynchronized'],
    ['sleep enabled', { power: { sleep_disabled: false } }, 'sleep_not_disabled'],
    ['auto-power disabled', { power: { auto_power_on: false } }, 'auto_power_off'],
    ['CPU below floor', { resources: { cpu_cores: 5 } }, 'cpu_below_floor'],
    ['memory below floor', { resources: { memory_bytes: 8 * GIB - 1 } }, 'memory_below_floor'],
    ['CPU pressure above ceiling', {
      resources: { cpu_pressure_percent: 100 },
    }, 'cpu_pressure_above_ceiling'],
    ['memory pressure above ceiling', {
      resources: { memory_pressure_percent: 100 },
    }, 'memory_pressure_above_ceiling'],
    ['disk free below floor', { resources: { disk_free_bytes: 40 * GIB - 1 } }, 'disk_free_below_floor'],
    ['disk use above ceiling', { resources: { disk_used_percent: 85.01 } }, 'disk_usage_above_ceiling'],
    ['non-system launchd', { launchd: { domain: 'gui/501' } }, 'launchd_not_system'],
    ['LaunchAgent used', { launchd: { kind: 'LaunchAgent' } }, 'launchd_not_daemon'],
    ['launchd unloaded', { launchd: { loaded: false } }, 'launchd_unloaded'],
    ['worktree root not ready', { worktree: { root_ready: false } }, 'worktree_unavailable'],
    ['container probe failed', { container: { probe_succeeded: false } }, 'container_probe_failed'],
  ])('drains when %s', async (_name, patch, code) => {
    const { contract, profile, report } = await fixture('xian-mac-m4', patch);
    expectDraining(
      contract.evaluateBaseAdmission(report, { profile, nowMs: NOW_MS }),
      code,
    );
  });

  it('emits structured, bounded, duplicate-free reasons for a hostile report', async () => {
    const { contract, profile, report } = await fixture('xian-mac-m4', {
      machine_id: `wrong-${'x'.repeat(1_000)}`,
      docker: { available: false },
      tailscale: { connected: false },
      callback: { reachable: false },
    });

    const result = contract.evaluateBaseAdmission(report, { profile, nowMs: NOW_MS });

    expect(result.reasons.length).toBeGreaterThan(1);
    expect(result.reasons.length).toBeLessThanOrEqual(32);
    expect(new Set(result.reasons.map(({ code }) => code)).size).toBe(result.reasons.length);
    for (const reason of result.reasons) {
      expect(Object.keys(reason).sort()).toEqual(['code', 'field', 'message']);
      expect(reason.code).toMatch(/^[a-z0-9_]{1,64}$/);
      expect(reason.field.length).toBeLessThanOrEqual(80);
      expect(reason.message.length).toBeLessThanOrEqual(160);
      expect(JSON.stringify(reason)).not.toContain('x'.repeat(200));
    }
  });
});
