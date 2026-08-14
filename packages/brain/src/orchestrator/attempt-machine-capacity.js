export const AUTONOMOUS_SINGLETON_CAPACITY_CONTENDED =
  'autonomous_singleton_capacity_contended';

const AUTONOMOUS_SINGLETON_ROLES = new Set([
  'proposer',
  'generator',
  'evaluator',
  'judge',
]);

export const MACHINE_CAPACITY_LOCK_SQL = `
  SELECT pg_advisory_xact_lock(
    hashtextextended('harness_attempt_machine:' || $1::text, 0)
  )
`;

export function prepareAttemptMachineCapacity(input) {
  const snapshot = input?.capacitySnapshot;
  const autonomousSingleton = AUTONOMOUS_SINGLETON_ROLES.has(input?.role)
    && snapshot?.verified === true
    && snapshot.machine === input.machineId
    && snapshot.capacity?.ok === true
    && snapshot.capacity.autonomous_progress_floor === true
    && Number(snapshot.capacity.available) === 1
    && Number(snapshot.capacity.physical_capacity) >= 1;
  const bundle = input?.bundle ?? {};
  const inputs = bundle.inputs ?? {};
  if (autonomousSingleton) {
    return {
      autonomousSingleton,
      bundle: {
        ...bundle,
        inputs: {
          ...inputs,
          _server_allocation: {
            autonomous_progress_floor: true,
            machine_id: input.machineId,
            capability_snapshot_id: snapshot.capability_snapshot_id ?? null,
          },
        },
      },
    };
  }
  if (!Object.hasOwn(inputs, '_server_allocation')) {
    return { autonomousSingleton, bundle };
  }
  const sanitizedInputs = { ...inputs };
  delete sanitizedInputs._server_allocation;
  return {
    autonomousSingleton,
    bundle: { ...bundle, inputs: sanitizedInputs },
  };
}

export function readAttemptCreationOutcome(result) {
  const row = result?.rows?.[0] ?? null;
  if (row?.machine_capacity_contended === true) {
    throw new Error(AUTONOMOUS_SINGLETON_CAPACITY_CONTENDED);
  }
  if (row && Object.hasOwn(row, 'attempt')) return row.attempt;
  return row;
}
