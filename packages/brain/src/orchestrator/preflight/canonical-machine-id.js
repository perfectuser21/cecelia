import { listComputeWorkerIds, resolvePrimaryWorkerId } from '../../machine-registry.js';

// 顺序保证：primary 必须排第一——execution-transport.js 用解构
// [LOCAL_MACHINE_ID, ...REMOTE] = listCanonicalMachineIds()，首位即本机语义。
const primaryId = resolvePrimaryWorkerId();
const CANONICAL_MACHINE_IDS = Object.freeze([
  primaryId,
  ...listComputeWorkerIds().filter((id) => id !== primaryId),
]);

const CANONICAL_MACHINE_SET = new Set(CANONICAL_MACHINE_IDS);

function registeredFleetIds(fleet) {
  return new Set((fleet ?? [])
    .filter((entry) => entry?.registered !== false)
    .map((entry) => entry?.machine_id ?? entry?.id)
    .filter(Boolean));
}

/**
 * Resolve the server-owned machine identity.
 *
 * Hostnames are deliberately ignored: Docker hostnames are ephemeral worker
 * identities, not schedulable Fleet identities.
 */
export function resolveCanonicalMachineId({
  envMachineId = process.env.CECELIA_MACHINE_ID,
  fleetMachineId,
  fleet = [],
} = {}) {
  const candidate = envMachineId ?? fleetMachineId;
  if (!candidate) {
    throw new Error('missing canonical machine id');
  }
  if (!CANONICAL_MACHINE_SET.has(candidate)) {
    throw new Error(`unknown canonical machine id: ${candidate}`);
  }

  if (fleetMachineId) {
    const registered = registeredFleetIds(fleet);
    if (!registered.has(fleetMachineId)) {
      throw new Error(`unknown Fleet canonical machine id: ${fleetMachineId}`);
    }
  }
  return candidate;
}

export function listCanonicalMachineIds() {
  return [...CANONICAL_MACHINE_IDS];
}

