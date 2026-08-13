import { routeWork } from './work-router.js';

export async function createRoutedTask(db, request, repositoryFacts = [], options = {}) {
  const decision = routeWork(request, repositoryFacts);
  const ownsTransaction = options.transaction !== 'existing';
  const client = ownsTransaction && typeof db.connect === 'function'
    ? await db.connect()
    : db;
  const task = request.task ?? {};
  const payload = {
    ...(request.metadata || {}),
    ...(task.payload || {}),
    work_kind: decision.work_kind,
    change_kind: decision.change_kind,
    requested_task_type: request.requested_task_type ?? task.task_type ?? null,
    default_execution_profile: decision.default_execution_profile,
    execution_profile_override: decision.execution_profile_override ?? null,
    repo: decision.repo,
    map_scope: decision.map_scope,
    impact_contract_required: decision.impact_contract_required,
  };
  try {
    if (ownsTransaction) await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`work-route:${request.source}:${request.source_id}:${decision.router_version}`],
    );
    const existing = await client.query(
      `SELECT r.id AS routing_receipt_id, r.task_id, t.*
         FROM work_routing_receipts r
         JOIN tasks t ON t.id = r.task_id
        WHERE r.source=$1 AND r.source_id=$2 AND r.router_version=$3`,
      [request.source, request.source_id, decision.router_version],
    );
    if (existing.rows[0]) {
      if (ownsTransaction) await client.query('COMMIT');
      return {
        task_id: existing.rows[0].task_id,
        routing_receipt_id: existing.rows[0].routing_receipt_id,
        task: existing.rows[0],
        decision,
        deduplicated: true,
      };
    }
    const taskResult = await client.query(
      `INSERT INTO tasks (
         title, description, priority, task_type, status,
         project_id, area_id, goal_id, location, payload, trigger_source,
         domain, okr_initiative_id, ability_id, blocked_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15
       ) RETURNING *`,
      [
        request.title,
        request.description || null,
        task.priority ?? 'P2',
        decision.canonical_task_type,
        task.status ?? 'queued',
        task.project_id ?? null,
        task.area_id ?? null,
        task.goal_id ?? null,
        task.location ?? 'us',
        JSON.stringify(payload),
        task.trigger_source ?? request.source,
        task.domain ?? request.declared_domain ?? null,
        task.okr_initiative_id ?? null,
        task.ability_id ?? null,
        task.blocked_at ?? null,
      ],
    );
    const taskId = taskResult.rows[0].id;
    const receiptResult = await client.query(
      `INSERT INTO work_routing_receipts (task_id,source,source_id,work_kind,change_kind,pipeline,canonical_task_type,default_execution_profile,execution_profile_override,repo,map_scope,impact_contract_required,orchestrator,router_version,route_reason,evidence,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [taskId, request.source, request.source_id, decision.work_kind, decision.change_kind, decision.pipeline, decision.canonical_task_type, decision.default_execution_profile, decision.execution_profile_override ?? null, decision.repo, JSON.stringify(decision.map_scope), decision.impact_contract_required, decision.orchestrator, decision.router_version, decision.route_reason, JSON.stringify(decision.evidence), decision.decided_at],
    );
    const receiptId = receiptResult.rows[0].id;
    await client.query('UPDATE tasks SET payload = payload || $2::jsonb WHERE id=$1', [taskId, JSON.stringify({ routing_receipt_id: receiptId })]);
    if (ownsTransaction) await client.query('COMMIT');
    return {
      task_id: taskId,
      routing_receipt_id: receiptId,
      task: {
        ...taskResult.rows[0],
        payload: { ...payload, routing_receipt_id: receiptId },
      },
      decision,
    };
  } catch (error) {
    if (ownsTransaction) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (ownsTransaction && typeof client.release === 'function') client.release();
  }
}
