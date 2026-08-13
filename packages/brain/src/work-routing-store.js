import { routeWork } from './work-router.js';

async function loadRepositoryFacts(client) {
  const result = await client.query(
    `SELECT scope_key, repo, adapter_config
       FROM map_scope_repositories
      ORDER BY scope_key, repo`,
  );
  return result.rows.map((row) => ({
    scope_key: row.scope_key,
    repo: row.repo,
    path: row.adapter_config?.path ?? null,
    aliases: Array.isArray(row.adapter_config?.aliases) ? row.adapter_config.aliases : [],
  }));
}

export async function createRoutedTask(db, request, repositoryFacts = null, options = {}) {
  const ownsTransaction = options.transaction !== 'existing';
  const client = ownsTransaction && typeof db.connect === 'function'
    ? await db.connect()
    : db;
  try {
    if (ownsTransaction) await client.query('BEGIN');
    const facts = repositoryFacts ?? await loadRepositoryFacts(client);
    const decision = routeWork(request, facts);
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
      ...(decision.pipeline === 'harness' ? {
        orchestrator: 'skill-relay',
        harness_runtime: 'kernel-v1',
      } : {}),
    };
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
         domain, okr_initiative_id, ability_id, blocked_at,
         tags, prd_content, execution_profile, owner_role, delivery_type,
         created_by, dept, phase, executor_kind
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,
         $16,$17,$18,$19,$20,$21,$22,$23,$24
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
        task.tags ?? [],
        task.prd_content ?? null,
        task.execution_profile ?? null,
        task.owner_role ?? null,
        task.delivery_type ?? 'code-only',
        task.created_by ?? null,
        task.dept ?? null,
        task.phase ?? 'dev',
        task.executor_kind ?? null,
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
    await client.query(
      `INSERT INTO cecelia_events (event_type,source,payload)
       VALUES ($1,'work-router',$2::jsonb)`,
      ['work_routed', JSON.stringify({
        task_id: taskId,
        routing_receipt_id: receiptId,
        source: request.source,
        work_kind: decision.work_kind,
        change_kind: decision.change_kind,
        pipeline: decision.pipeline,
        repo: decision.repo,
        route_reason: decision.route_reason,
      })],
    );
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
    if (ownsTransaction) {
      try {
        await client.query(
          `INSERT INTO cecelia_events (event_type,source,payload)
           VALUES ($1,'work-router',$2::jsonb)`,
          ['work_route_blocked', JSON.stringify({
            source: request?.source ?? null,
            source_id: request?.source_id ?? null,
            reason_code: error?.code ?? error?.message ?? 'work_route_blocked',
          })],
        );
      } catch { /* 路由原错误保持权威，事件写入不得覆盖它。 */ }
    }
    throw error;
  } finally {
    if (ownsTransaction && typeof client.release === 'function') client.release();
  }
}
