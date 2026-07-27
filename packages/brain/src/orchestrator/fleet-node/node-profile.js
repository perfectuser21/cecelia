import { readFileSync } from 'node:fs';

const REGISTRY_URL = new URL('../../../config/fleet-node-profiles.json', import.meta.url);
const CANONICAL_BASELINE = Object.freeze({
  capacities: Object.freeze({
    'us-mac-m4': 7,
    'xian-mac-m4': 8,
    'xian-mac-m1': 8,
  }),
  runner_image_digest: 'sha256:72afb77061714668276d4b47bce4554544afc0b862364ab2c646d28b785a3f36',
  resources: Object.freeze({
    cpu_cores: 6,
    memory_gib: 8,
    disk_min_free_gib: 40,
    disk_max_used_percent: 85,
    cpu_pressure_max_percent: 90,
    memory_pressure_max_percent: 90,
  }),
  launchd: Object.freeze({
    domain: 'system',
    kind: 'LaunchDaemon',
  }),
  version_policy: Object.freeze({
    os: '15.7.4',
    orbstack: '2.1.1',
    worker_protocol: 'kernel-harness/v1',
    worker_contract: 'fleet-node-health/v1',
    worker: '1.267.90',
    runner: 'cecelia-runner/v1',
    git: '2.39.5',
    node: '25.8.0',
    codex: '0.145.0',
  }),
});
const CANONICAL_IDS = Object.freeze(Object.keys(CANONICAL_BASELINE.capacities));
const PROFILE_KEYS = [
  'machine_id',
  'capacity',
  'runner_image_digest',
  'resources',
  'launchd',
  'version_policy',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, requiredKeys) {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === requiredKeys.length
    && requiredKeys.every((key) => Object.hasOwn(value, key));
}

function matchesCanonicalRecord(value, canonical) {
  const keys = Object.keys(canonical);
  return hasExactKeys(value, keys)
    && keys.every((key) => value[key] === canonical[key]);
}

export function validateNodeProfile(profile) {
  if (!hasExactKeys(profile, PROFILE_KEYS)) return false;
  if (!Object.hasOwn(CANONICAL_BASELINE.capacities, profile.machine_id)) return false;
  if (!Number.isInteger(profile.capacity)
    || profile.capacity !== CANONICAL_BASELINE.capacities[profile.machine_id]) {
    return false;
  }
  if (typeof profile.runner_image_digest !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(profile.runner_image_digest)
    || profile.runner_image_digest !== CANONICAL_BASELINE.runner_image_digest) {
    return false;
  }
  return matchesCanonicalRecord(profile.resources, CANONICAL_BASELINE.resources)
    && matchesCanonicalRecord(profile.launchd, CANONICAL_BASELINE.launchd)
    && matchesCanonicalRecord(profile.version_policy, CANONICAL_BASELINE.version_policy);
}

export function validateNodeProfileRegistry(candidateProfiles) {
  const valid = Array.isArray(candidateProfiles)
    && candidateProfiles.length === CANONICAL_IDS.length
    && candidateProfiles.every(validateNodeProfile)
    && candidateProfiles.every((profile, index) => profile.machine_id === CANONICAL_IDS[index])
    && new Set(candidateProfiles.map((profile) => profile.machine_id)).size
      === candidateProfiles.length;
  if (!valid) throw new Error('invalid_fleet_node_registry');
  return true;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

const registry = JSON.parse(readFileSync(REGISTRY_URL, 'utf8'));
validateNodeProfileRegistry(registry.profiles);
const profiles = deepFreeze(registry.profiles);
const profilesById = new Map(profiles.map((profile) => [profile.machine_id, profile]));

const ROLE_WEIGHTS = Object.freeze({
  commander: 1,
  planner: 1,
  reviewer: 1,
  proposer: 2,
  generator: 4,
  evaluator: 4,
  judge: 4,
});

export function listNodeProfiles() {
  return profiles;
}

export function getNodeProfile(machineId) {
  if (typeof machineId !== 'string' || !profilesById.has(machineId)) {
    throw new Error('unknown_fleet_node');
  }
  return profilesById.get(machineId);
}

export function getRoleCapacity({ baseCapacity, role } = {}) {
  if (typeof role !== 'string' || !Object.hasOwn(ROLE_WEIGHTS, role)) {
    throw new Error('unknown_fleet_role');
  }
  if (!Number.isInteger(baseCapacity) || baseCapacity < 0) {
    throw new Error('invalid_fleet_capacity');
  }

  const weight = ROLE_WEIGHTS[role];
  return {
    role,
    weight,
    capacity: Math.floor(baseCapacity / weight),
  };
}
