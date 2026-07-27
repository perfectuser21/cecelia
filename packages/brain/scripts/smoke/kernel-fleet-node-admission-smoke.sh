#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

node --input-type=module <<'NODE'
import {
  getNodeProfile,
  getRoleCapacity,
} from './packages/brain/src/orchestrator/fleet-node/node-profile.js';
import {
  evaluateBaseAdmission,
} from './packages/brain/src/orchestrator/fleet-node/node-admission.js';

const NOW_MS = Date.parse('2026-07-27T08:00:00.000Z');
const GIB = 1024 ** 3;

function reportFor(machineId) {
  const profile = getNodeProfile(machineId);
  const policy = profile.version_policy;
  return {
    schema_version: 'fleet-node-health/v1',
    machine_id: machineId,
    observed_at: new Date(NOW_MS - 1_000).toISOString(),
    worker: {
      protocol_version: policy.worker_protocol,
      contract_version: policy.worker_contract,
      version: policy.worker,
    },
    runner: { version: policy.runner, image_digest: profile.runner_image_digest },
    os: { version: policy.os },
    orbstack: { version: policy.orbstack },
    docker: { available: true, observed_at: new Date(NOW_MS - 1_000).toISOString() },
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
}

function evaluate(machineId, patch = {}) {
  const report = reportFor(machineId);
  for (const [key, value] of Object.entries(patch)) {
    report[key] = value && typeof value === 'object' && report[key]
      ? { ...report[key], ...value }
      : value;
  }
  return evaluateBaseAdmission(report, {
    profile: getNodeProfile(machineId),
    nowMs: NOW_MS,
  });
}

const admitted = evaluate('xian-mac-m4');
if (admitted.state !== 'base_admitted'
    || admitted.base_admitted !== true
    || admitted.dispatch_ready !== false) {
  throw new Error(`valid report was not base-admitted: ${JSON.stringify(admitted)}`);
}

const m1WithoutDocker = evaluate('xian-mac-m1', { docker: { available: false } });
if (m1WithoutDocker.state !== 'draining' || m1WithoutDocker.base_admitted !== false) {
  throw new Error(`M1 without Docker was admitted: ${JSON.stringify(m1WithoutDocker)}`);
}

const wrongDigest = evaluate('us-mac-m4', {
  runner: { image_digest: `sha256:${'0'.repeat(64)}` },
});
if (wrongDigest.state !== 'draining' || wrongDigest.base_admitted !== false) {
  throw new Error(`wrong Runner digest was admitted: ${JSON.stringify(wrongDigest)}`);
}

const capacities = Object.fromEntries(
  ['commander', 'proposer', 'generator'].map((role) => [
    role,
    getRoleCapacity({ baseCapacity: 8, role }).capacity,
  ]),
);
if (JSON.stringify(capacities) !== JSON.stringify({
  commander: 8,
  proposer: 4,
  generator: 2,
})) {
  throw new Error(`role-weight capacity drift: ${JSON.stringify(capacities)}`);
}

console.log('PASS: Fleet Node base-admission contract regression');
NODE

bash "$ROOT/packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh"
bash "$ROOT/packages/brain/scripts/fleet-worker/fleet-nodectl.test.sh"
