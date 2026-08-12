import { routeWork } from './work-router.js';

export async function createRoutedTask(client, request, repositoryFacts = []) {
  const decision = routeWork(request, repositoryFacts);
  await client.query('BEGIN');
  try {
    const taskResult = await client.query(
      `INSERT INTO tasks (title, description, task_type, status, payload, trigger_source)
       VALUES ($1,$2,$3,'queued',$4,$5) RETURNING id`,
      [request.title, request.description || null, decision.canonical_task_type, JSON.stringify({ ...(request.metadata || {}), work_kind: decision.work_kind, change_kind: decision.change_kind }), request.source],
    );
    const taskId = taskResult.rows[0].id;
    const receiptResult = await client.query(
      `INSERT INTO work_routing_receipts (task_id,source,source_id,work_kind,change_kind,pipeline,canonical_task_type,default_execution_profile,repo,map_scope,impact_contract_required,orchestrator,router_version,route_reason,evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [taskId, request.source, request.source_id, decision.work_kind, decision.change_kind, decision.pipeline, decision.canonical_task_type, decision.default_execution_profile, decision.repo, JSON.stringify(decision.map_scope), decision.impact_contract_required, decision.orchestrator, decision.router_version, decision.route_reason, JSON.stringify(decision.evidence)],
    );
    const receiptId = receiptResult.rows[0].id;
    await client.query('UPDATE tasks SET payload = payload || $2::jsonb WHERE id=$1', [taskId, JSON.stringify({ routing_receipt_id: receiptId })]);
    await client.query('COMMIT');
    return { task_id: taskId, routing_receipt_id: receiptId, decision };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
