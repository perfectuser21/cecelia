function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function summarizeWorkRouting({
  coding = 0,
  receipts = 0,
  directDev = 0,
  legacyExempt = 0,
  mapQueries = 0,
  codingRuns = 0,
  missingBusinessReceipts = 0,
  workRouteBlocked = 0,
  routeViolation = 0,
  mapPreflightFailed = 0,
}) {
  return {
    coding_mutation_total: Number(coding),
    coding_receipt_coverage: ratio(Number(receipts), Number(coding)),
    missing_business_receipts: Number(missingBusinessReceipts),
    coding_dev_direct: Number(directDev),
    harness_map_query_coverage: ratio(Number(mapQueries), Number(codingRuns)),
    legacy_exempt: Number(legacyExempt),
    events: {
      work_route_blocked: Number(workRouteBlocked),
      route_violation: Number(routeViolation),
      map_preflight_failed: Number(mapPreflightFailed),
    },
  };
}

export async function loadWorkRoutingObservability(db, { days = 7 } = {}) {
  const { rows } = await db.query(
    `WITH recent_tasks AS (
       SELECT task.id,task.task_type,task.payload,receipt.id AS receipt_id,
              receipt.work_kind
         FROM tasks task
         LEFT JOIN work_routing_receipts receipt ON receipt.task_id=task.id
        WHERE task.created_at > NOW() - ($1 || ' days')::interval
     ), coding_tasks AS (
       SELECT * FROM recent_tasks
        WHERE work_kind='coding_mutation'
           OR payload->>'work_kind'='coding_mutation'
           OR task_type IN ('harness_initiative','dev')
     ), recent_runs AS (
       SELECT run.id,run.current_task_id,run.impact_contract_policy
         FROM initiative_runs run
        WHERE run.created_at > NOW() - ($1 || ' days')::interval
          AND run.current_task_id IN (SELECT id FROM coding_tasks)
     ), recent_events AS (
       SELECT event_type FROM cecelia_events
        WHERE created_at > NOW() - ($1 || ' days')::interval
          AND event_type IN ('work_route_blocked','route_violation','map_preflight_failed')
     )
     SELECT
       (SELECT count(*)::int FROM coding_tasks) AS coding,
       (SELECT count(*)::int FROM coding_tasks WHERE receipt_id IS NOT NULL) AS receipts,
       (SELECT count(*)::int FROM coding_tasks WHERE task_type='dev') AS direct_dev,
       (SELECT count(*)::int FROM recent_tasks WHERE receipt_id IS NULL) AS missing_business_receipts,
       (SELECT count(*)::int FROM recent_runs) AS coding_runs,
       (SELECT count(*)::int FROM recent_runs run
         WHERE EXISTS (SELECT 1 FROM harness_impact_contracts contract
                        WHERE contract.task_id=run.current_task_id)) AS map_queries,
       (SELECT count(*)::int FROM recent_runs
         WHERE impact_contract_policy='legacy_exempt') AS legacy_exempt,
       (SELECT count(*)::int FROM recent_events WHERE event_type='work_route_blocked') AS work_route_blocked,
       (SELECT count(*)::int FROM recent_events WHERE event_type='route_violation') AS route_violation,
       (SELECT count(*)::int FROM recent_events WHERE event_type='map_preflight_failed') AS map_preflight_failed`,
    [String(days)],
  );
  const row = rows[0] ?? {};
  return summarizeWorkRouting({
    coding: row.coding,
    receipts: row.receipts,
    directDev: row.direct_dev,
    legacyExempt: row.legacy_exempt,
    mapQueries: row.map_queries,
    codingRuns: row.coding_runs,
    missingBusinessReceipts: row.missing_business_receipts,
    workRouteBlocked: row.work_route_blocked,
    routeViolation: row.route_violation,
    mapPreflightFailed: row.map_preflight_failed,
  });
}

export async function loadTaskRoutingAudit(db, taskIds) {
  if (!Array.isArray(taskIds) || taskIds.length === 0) return {};
  const { rows } = await db.query(
    `SELECT task.id AS task_id,
            receipt.work_kind,receipt.change_kind,receipt.pipeline,
            receipt.default_execution_profile,receipt.repo,receipt.map_scope,
            receipt.route_reason,receipt.router_version,
            run.impact_contract_policy,
            CASE
              WHEN receipt.work_kind IS NULL THEN 'missing'
              WHEN receipt.work_kind <> 'coding_mutation' THEN 'not_applicable'
              WHEN contract.id IS NULL THEN 'missing'
              ELSE COALESCE(contract.contract_body->'freshness_evidence'->>'status','unknown')
            END AS map_status,
            CASE
              WHEN receipt.work_kind IS NULL THEN 'missing'
              WHEN receipt.work_kind <> 'coding_mutation' THEN 'not_applicable'
              ELSE COALESCE(contract.status,'missing')
            END AS impact_contract_status,
            CASE
              WHEN task.status='blocked' THEN COALESCE(task.error_message,'task_blocked')
              WHEN run.phase='failed' THEN COALESCE(run.failure_reason,'kernel_failed')
              WHEN receipt.id IS NULL THEN 'routing_receipt_missing'
              ELSE NULL
            END AS blocking_gate
       FROM tasks task
       LEFT JOIN work_routing_receipts receipt ON receipt.task_id=task.id
       LEFT JOIN LATERAL (
         SELECT candidate.* FROM initiative_runs candidate
          WHERE candidate.current_task_id=task.id
          ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1
       ) run ON true
       LEFT JOIN LATERAL (
         SELECT candidate.* FROM harness_impact_contracts candidate
          WHERE candidate.task_id=task.id
          ORDER BY (candidate.status='active') DESC,candidate.version DESC LIMIT 1
       ) contract ON true
      WHERE task.id=ANY($1::uuid[])`,
    [taskIds],
  );
  return Object.fromEntries(rows.map(({ task_id: taskId, ...audit }) => [taskId, audit]));
}
