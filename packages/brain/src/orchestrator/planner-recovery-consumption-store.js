import { createRoutedTask } from '../work-routing-store.js';

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function recoveryError(code, httpStatus) {
  const error = new Error(code);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function validateRequest(predecessorRunId, idempotencyKey) {
  if (!UUID_PATTERN.test(predecessorRunId ?? '')) {
    throw recoveryError('planner_recovery_predecessor_invalid', 400);
  }
  if (
    idempotencyKey !== null
    && idempotencyKey !== undefined
    && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
  ) {
    throw recoveryError('planner_recovery_idempotency_key_invalid', 400);
  }
}

function winner(row, deduplicated) {
  return Object.freeze({
    receipt_id: row.receipt_id,
    successor_task_id: row.successor_task_id,
    routing_receipt_id: row.routing_receipt_id,
    idempotency_key: row.idempotency_key ?? null,
    deduplicated,
  });
}

function recoveryBranch(receiptId) {
  return `cp-planner-recovery-${receiptId.replaceAll('-', '').slice(0, 12)}`;
}

export async function consumePlannerRecoveryReceipt(
  db,
  { predecessorRunId, idempotencyKey = null },
  { createRoutedTaskFn = createRoutedTask } = {},
) {
  validateRequest(predecessorRunId, idempotencyKey);
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  const ownsClient = client !== db;
  try {
    await client.query('BEGIN');
    const identity = await client.query(
      `SELECT current_task_id
         FROM initiative_runs
        WHERE id=$1::uuid`,
      [predecessorRunId],
    );
    const sourceTaskId = identity.rows[0]?.current_task_id;
    if (!sourceTaskId) {
      throw recoveryError('planner_recovery_source_not_found', 404);
    }

    const sourceTaskResult = await client.query(
      `SELECT id,status,okr_initiative_id
         FROM tasks
        WHERE id=$1::uuid
        FOR UPDATE`,
      [sourceTaskId],
    );
    const sourceTask = sourceTaskResult.rows[0];
    if (!sourceTask) throw recoveryError('planner_recovery_source_not_found', 404);

    const runResult = await client.query(
      `SELECT id,initiative_id,okr_initiative_id,current_task_id,phase,
              orchestrator_version,record_trust_status
         FROM initiative_runs
        WHERE id=$1::uuid
        FOR UPDATE`,
      [predecessorRunId],
    );
    const run = runResult.rows[0];
    if (!run) throw recoveryError('planner_recovery_source_not_found', 404);
    if (
      run.current_task_id !== sourceTask.id
      || run.phase !== 'failed'
      || run.orchestrator_version !== 'v2'
      || run.record_trust_status !== 'trusted'
      || sourceTask.status !== 'failed'
      || (
        run.okr_initiative_id
        && sourceTask.okr_initiative_id
        && run.okr_initiative_id !== sourceTask.okr_initiative_id
      )
    ) {
      throw recoveryError('planner_recovery_source_not_eligible', 409);
    }

    const receiptResult = await client.query(
      `SELECT recovery.id,recovery.predecessor_run_id,recovery.source_task_id,
              recovery.repo,recovery.head_sha,recovery.verification_method,
              route.change_kind,route.execution_profile_override,route.map_scope
         FROM planner_recovery_receipts recovery
         JOIN work_routing_receipts route
           ON route.task_id=recovery.source_task_id
          AND route.work_kind='coding_mutation'
        WHERE recovery.predecessor_run_id=$1::uuid
          AND recovery.source_task_id=$2::uuid
          AND recovery.verification_method='remote_exact_commit_blob'
        FOR UPDATE OF recovery`,
      [predecessorRunId, sourceTask.id],
    );
    if (receiptResult.rows.length === 0) {
      throw recoveryError('planner_recovery_receipt_not_found', 409);
    }
    if (receiptResult.rows.length !== 1) {
      throw recoveryError('planner_recovery_receipt_ambiguous', 409);
    }
    const receipt = receiptResult.rows[0];

    const consumptionResult = await client.query(
      `SELECT receipt_id,successor_task_id,routing_receipt_id,idempotency_key
         FROM planner_recovery_consumptions
        WHERE receipt_id=$1::uuid
        FOR UPDATE`,
      [receipt.id],
    );
    if (consumptionResult.rows[0]) {
      await client.query('COMMIT');
      return winner(consumptionResult.rows[0], true);
    }

    if (
      !receipt.change_kind
      || !Array.isArray(receipt.map_scope)
      || receipt.map_scope.length === 0
    ) {
      throw recoveryError('planner_recovery_route_invalid', 409);
    }
    const routed = await createRoutedTaskFn(client, {
      source: 'child',
      source_id: `planner-recovery:${receipt.id}`,
      title: `Recover Planner receipt ${receipt.id}`,
      description: `Resume initiative ${run.initiative_id} from immutable Planner receipt ${receipt.id}.`,
      mutation_intent: 'write',
      declared_change_kind: receipt.change_kind,
      execution_profile_override_request: receipt.execution_profile_override ?? null,
      repo_hint: receipt.repo,
      map_scope_hint: receipt.map_scope,
      branch: recoveryBranch(receipt.id),
      base_sha: receipt.head_sha,
      metadata: {
        planner_recovery_receipt_id: receipt.id,
        predecessor_run_id: run.id,
        initiative_id: run.initiative_id,
      },
      task: {
        status: 'queued',
        okr_initiative_id: run.okr_initiative_id ?? sourceTask.okr_initiative_id ?? null,
        trigger_source: 'planner_recovery',
      },
    }, null, { transaction: 'existing' });
    const inserted = await client.query(
      `INSERT INTO planner_recovery_consumptions(
         receipt_id,successor_task_id,routing_receipt_id,idempotency_key
       ) VALUES($1::uuid,$2::uuid,$3::uuid,$4)
       RETURNING receipt_id,successor_task_id,routing_receipt_id,idempotency_key`,
      [receipt.id, routed.task_id, routed.routing_receipt_id, idempotencyKey],
    );
    await client.query('COMMIT');
    return winner(inserted.rows[0], false);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (ownsClient && typeof client.release === 'function') client.release();
  }
}
