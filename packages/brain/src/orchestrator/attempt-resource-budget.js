import { getNodeProfile, getRoleCapacity, ROLE_WEIGHTS } from './fleet-node/node-profile.js';

export const MACHINE_CAPACITY_CONTENDED = 'machine_capacity_contended';
export { ROLE_WEIGHTS };

// Called only after the machine transaction lock has been acquired. A role's
// available count cannot be converted back into a shared base-slot budget.
export function prepareResourceBudget(input, nowMs = Date.now()) {
  const denied = { valid: false, budget: 0, weight: 0, singleton: false };
  const snapshot = input?.capacitySnapshot;
  const capacity = snapshot?.capacity;
  if (snapshot?.verified !== true || snapshot.machine !== input.machineId
      || !Number.isFinite(snapshot.expires_at) || snapshot.expires_at <= nowMs
      || capacity?.ok !== true) return denied;
  const physical = capacity.physical_base_slots;
  const effective = capacity.effective_base_slots;
  if (![physical, effective].every((value) => Number.isInteger(value) && value > 0)) return denied;
  try {
    const profile = getNodeProfile(input.machineId);
    const { weight } = getRoleCapacity({ baseCapacity: 0, role: input.role });
    const budget = Math.min(profile.capacity, physical, effective);
    const singleton = weight > budget && capacity.available === 1
      && (capacity.autonomous_progress_floor === true || capacity.manual_capacity_override === true);
    return { valid: true, budget, weight, singleton };
  } catch { return denied; }
}

export const OCCUPIED_ATTEMPTS_SQL = `occupied AS MATERIALIZED (
  SELECT active.* FROM harness_attempts active
   WHERE (
     active.status IN ('queued','starting','running')
     AND ($8 IN (active.actual_machine_id, active.requested_machine_id, active.machine_id))
   ) OR EXISTS (
     SELECT 1 FROM harness_attempt_cleanup_outbox cleanup
      WHERE cleanup.attempt_id = active.id AND cleanup.status <> 'confirmed'
        AND cleanup.target_machine_id = $8
   )
)`;

export const RESOURCE_BUDGET_GUARD_SQL = `(
  NOT EXISTS (SELECT 1 FROM capacity_reservations WHERE machine_id = $8 AND status <> 'released')
  AND $25::boolean AND $26::double precision > EXTRACT(EPOCH FROM clock_timestamp()) * 1000
  AND NOT EXISTS (
    SELECT 1 FROM occupied WHERE NOT ($24::jsonb ? occupied.role)
  ) AND (
    ($22::boolean AND NOT EXISTS (SELECT 1 FROM occupied))
    OR (NOT $22::boolean
      AND NOT EXISTS (
        SELECT 1 FROM occupied WHERE
          task_bundle #>> '{inputs,_server_allocation,autonomous_progress_floor}' = 'true'
          OR task_bundle #>> '{inputs,_server_allocation,manual_capacity_override}' = 'true'
      )
      AND COALESCE((SELECT SUM(($24::jsonb ->> role)::integer) FROM occupied), 0)
        + ($24::jsonb ->> $5::text)::integer <= $23::integer
    )
  )
)`;
