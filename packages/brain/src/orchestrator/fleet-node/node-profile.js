import { readFileSync } from 'node:fs';

const REGISTRY_URL = new URL('../../../config/fleet-node-profiles.json', import.meta.url);
const RUNNER_IMAGE_DIGEST = 'sha256:72afb77061714668276d4b47bce4554544afc0b862364ab2c646d28b785a3f36';
const CANONICAL_IDS = ['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1'];
const CANONICAL_CAPACITIES = Object.freeze({
  'us-mac-m4': 7,
  'xian-mac-m4': 8,
  'xian-mac-m1': 8,
});
const PROFILE_KEYS = [
  'machine_id',
  'capacity',
  'runner_image_digest',
  'resources',
  'launchd',
  'version_policy',
];
const RESOURCE_KEYS = [
  'cpu_cores',
  'memory_gib',
  'disk_min_free_gib',
  'disk_max_used_percent',
  'cpu_pressure_max_percent',
  'memory_pressure_max_percent',
];
const LAUNCHD_KEYS = ['domain', 'kind'];
const VERSION_POLICY_KEYS = [
  'os',
  'orbstack',
  'worker_protocol',
  'worker_contract',
  'worker',
  'runner',
  'git',
  'node',
  'codex',
];
const MAX_POLICY_LENGTH = 128;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, requiredKeys) {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === requiredKeys.length
    && requiredKeys.every((key) => Object.hasOwn(value, key));
}

export function validateNodeProfile(profile) {
  if (!hasExactKeys(profile, PROFILE_KEYS)) return false;
  if (!Object.hasOwn(CANONICAL_CAPACITIES, profile.machine_id)) return false;
  if (!Number.isInteger(profile.capacity)
    || profile.capacity !== CANONICAL_CAPACITIES[profile.machine_id]) {
    return false;
  }
  if (typeof profile.runner_image_digest !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(profile.runner_image_digest)
    || profile.runner_image_digest !== RUNNER_IMAGE_DIGEST
    || profile.runner_image_digest.includes('latest')) {
    return false;
  }

  const resources = profile.resources;
  if (!hasExactKeys(resources, RESOURCE_KEYS)
    || resources.cpu_cores !== 6
    || resources.memory_gib !== 8
    || resources.disk_min_free_gib !== 40
    || resources.disk_max_used_percent !== 85
    || !Number.isFinite(resources.cpu_pressure_max_percent)
    || resources.cpu_pressure_max_percent <= 0
    || resources.cpu_pressure_max_percent >= 100
    || !Number.isFinite(resources.memory_pressure_max_percent)
    || resources.memory_pressure_max_percent <= 0
    || resources.memory_pressure_max_percent >= 100) {
    return false;
  }

  if (!hasExactKeys(profile.launchd, LAUNCHD_KEYS)
    || profile.launchd.domain !== 'system'
    || profile.launchd.kind !== 'LaunchDaemon') {
    return false;
  }

  if (!hasExactKeys(profile.version_policy, VERSION_POLICY_KEYS)) return false;
  return VERSION_POLICY_KEYS.every((key) => {
    const value = profile.version_policy[key];
    return typeof value === 'string'
      && value.trim().length > 0
      && value.length <= MAX_POLICY_LENGTH;
  });
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
