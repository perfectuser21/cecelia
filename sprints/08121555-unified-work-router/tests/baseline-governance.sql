\set ON_ERROR_STOP on

\if :{?task_ids_csv}
\else
  \error 'task_ids_csv is required (exact API, Intent, Capture smoke task ids)'
\endif

WITH target AS (
  SELECT t.id AS task_id, r.id AS receipt_id, r.repo
  FROM tasks t
  JOIN work_routing_receipts r ON r.task_id = t.id
  WHERE t.id::text = ANY(string_to_array(:'task_ids_csv', ','))
    AND t.task_type = 'harness_initiative'
    AND t.created_at > NOW() - interval '5 minutes'
), checks AS (
  SELECT
    (SELECT count(DISTINCT target.task_id) FROM target) = 3 AS has_exact_three_tasks,
    (SELECT count(*) FROM target JOIN work_routing_receipts r ON r.id = target.receipt_id WHERE r.base_sha = :'baseline') = 3 AS receipt_ok,
    (SELECT count(*) FROM target WHERE NOT EXISTS (
      SELECT 1 FROM fact_snapshot_headers h
      WHERE h.repo = target.repo AND h.kind IN ('api','db_schema','graph','test')
        AND h.source_revision = :'baseline'
      GROUP BY h.repo HAVING count(DISTINCT h.kind) = 4
    )) = 0 AS map_ok,
    (SELECT count(DISTINCT target.task_id) FROM target JOIN harness_impact_contracts c ON c.task_id = target.task_id WHERE c.status = 'active' AND c.base_revision = :'baseline') = 3 AS contract_ok
)
SELECT 1 / CASE WHEN has_exact_three_tasks AND receipt_ok AND map_ok AND contract_ok THEN 1 ELSE 0 END
FROM checks;
