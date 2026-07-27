import { readFileSync } from 'node:fs';

const REGISTRY_URL = new URL('../../../config/fleet-node-profiles.json', import.meta.url);

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
