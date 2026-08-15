const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function invalidAuthority() {
  const error = new Error('planner_recovery_run_authority_invalid');
  error.code = 'planner_recovery_run_authority_invalid';
  return error;
}

export async function resolvePlannerRecoveryRunAuthority(client, { task, input }) {
  const payload = asObject(task?.payload);
  const receiptId = payload.planner_recovery_receipt_id;
  const result = await client.query(
    `SELECT receipt.id AS receipt_id,
            receipt.predecessor_run_id,
            receipt.source_task_id,
            consumption.successor_task_id,
            consumption.routing_receipt_id,
            predecessor.initiative_id,
            predecessor.current_task_id AS predecessor_task_id,
            predecessor.phase AS predecessor_phase,
            predecessor.orchestrator_version,
            predecessor.record_trust_status,
            source_task.status AS source_task_status
       FROM planner_recovery_receipts receipt
       JOIN planner_recovery_consumptions consumption
         ON consumption.receipt_id=receipt.id
       JOIN initiative_runs predecessor
         ON predecessor.id=receipt.predecessor_run_id
       JOIN tasks source_task
         ON source_task.id=receipt.source_task_id
      WHERE consumption.successor_task_id=$1::uuid
      FOR KEY SHARE OF receipt,consumption,predecessor,source_task`,
    [task.id],
  );
  if (result.rows.length === 0) {
    if (
      input.createdSource === 'planner_recovery'
      || receiptId != null
      || payload.predecessor_run_id != null
    ) throw invalidAuthority();
    return null;
  }
  const authority = result.rows[0];
  if (
    result.rows.length !== 1
    || !UUID_PATTERN.test(receiptId ?? '')
    || !UUID_PATTERN.test(payload.predecessor_run_id ?? '')
    || !UUID_PATTERN.test(payload.routing_receipt_id ?? '')
    || authority.receipt_id !== receiptId
    || authority.predecessor_run_id !== payload.predecessor_run_id
    || authority.routing_receipt_id !== payload.routing_receipt_id
    || authority.successor_task_id !== task.id
    || authority.source_task_id !== authority.predecessor_task_id
    || authority.initiative_id !== input.initiativeId
    || authority.predecessor_phase !== 'failed'
    || authority.orchestrator_version !== 'v2'
    || authority.record_trust_status !== 'trusted'
    || authority.source_task_status !== 'failed'
  ) {
    throw invalidAuthority();
  }
  return Object.freeze({
    receiptId: authority.receipt_id,
    predecessorRunId: authority.predecessor_run_id,
    phase: 'gan',
    createdSource: 'planner_recovery',
  });
}
