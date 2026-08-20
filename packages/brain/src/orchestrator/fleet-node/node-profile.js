import { readFileSync } from 'node:fs';

const REGISTRY_URL = new URL('../../../config/fleet-node-profiles.json', import.meta.url);
const CANONICAL_BASELINE = Object.freeze({
  capacities: Object.freeze({
    'us-mac-m4': 7,
    'xian-mac-m4': 8,
    'xian-mac-m1': 8,
  }),
  worker_bind_hosts: Object.freeze({
    'us-mac-m4': '127.0.0.1',
    'xian-mac-m4': '100.86.57.69',
    'xian-mac-m1': '100.88.166.55',
  }),
  brain_health_urls: Object.freeze({
    'us-mac-m4': 'http://127.0.0.1:5221/api/brain/health',
    'xian-mac-m4': 'http://100.71.151.105:5221/api/brain/health',
    'xian-mac-m1': 'http://100.71.151.105:5221/api/brain/health',
  }),
  runner_image_digest: 'sha256:2210233ba868b0230f07180cabf8fc382d024b56df3649c9d2f9c2c26bb3a7c9',
  runtime_resources: Object.freeze({
    postgres: Object.freeze({
      image_digest: 'pgvector/pgvector:pg15@sha256:a20a57d7aa5217a6af0a391ccf69f4a8512406d6c14be08132f801468cc3cc62',
    }),
  }),
  resources: Object.freeze({
    cpu_cores: 6,
    memory_gib: 8,
    disk_min_free_gib: 10,
    disk_max_used_percent: 85,
    cpu_pressure_max_percent: 90,
    memory_pressure_max_percent: 90,
  }),
  launchd: Object.freeze({
    domain: 'system',
    kind: 'LaunchDaemon',
  }),
  version_policy: Object.freeze({
    os: '15.6.1',
    orbstack: '2.2.1',
    worker_protocol: 'kernel-harness/v1',
    worker_contract: 'fleet-node-health/v1',
    worker: '1.272.20',
    runner: 'cecelia-runner/v1',
    git: '2.39.5',
    node: '25.8.0',
    codex: '0.147.0',
  }),
});
const CANONICAL_IDS = Object.freeze(Object.keys(CANONICAL_BASELINE.capacities));
const PROFILE_KEYS = [
  'machine_id',
  'capacity',
  'worker_bind_host',
  'brain_health_url',
  'runner_image_digest',
  'runtime_resources',
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
  if (profile.worker_bind_host !== CANONICAL_BASELINE.worker_bind_hosts[profile.machine_id]) {
    return false;
  }
  if (profile.brain_health_url !== CANONICAL_BASELINE.brain_health_urls[profile.machine_id]) {
    return false;
  }
  if (typeof profile.runner_image_digest !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(profile.runner_image_digest)
    || profile.runner_image_digest !== CANONICAL_BASELINE.runner_image_digest) {
    return false;
  }
  if (!hasExactKeys(profile.runtime_resources, ['postgres'])
    || !hasExactKeys(profile.runtime_resources.postgres, ['image_digest'])
    || profile.runtime_resources.postgres.image_digest
      !== CANONICAL_BASELINE.runtime_resources.postgres.image_digest) {
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
  reporter: 1,
  // Publisher 只做 git 发布（把 Judge 批准的精确候选 ref 推到远端），不跑测试、
  // 不起 Provider 推理，与 reporter 同为最轻档。
  // 2026-08-18 生产实证：Judge 首次 PASS 后 dispatcher 走 publish:approved_ref
  // （role:'publisher'），而这张表没有它 → getRoleCapacity 抛 unknown_fleet_role →
  // 容量算 0 → all_execution_targets_exhausted。Publisher 在设计上一直存在
  // （有 objective，Generator/Judge 的 objective 也都写明"Publisher owns remote
  // publication after Judge PASS"），只是从没有 run 走到 Judge PASS，这个漏注册
  // 就一直没被发现——产线走得越远，暴露得越晚。
  publisher: 1,
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
