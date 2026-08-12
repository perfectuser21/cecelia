\set ON_ERROR_STOP on

WITH target AS (
  SELECT id
  FROM tasks
  WHERE task_type = 'harness_initiative'
    AND created_at > NOW() - interval '5 minutes'
  ORDER BY created_at DESC
  LIMIT 1
), checks AS (
  SELECT
    (SELECT count(*) FROM target) = 1 AS has_recent_task,
    (SELECT count(*) FROM work_routing_receipts r JOIN target t ON t.id = r.task_id WHERE r.base_sha = :'baseline') = 1 AS receipt_ok,
    (SELECT count(DISTINCT h.kind) FROM fact_snapshot_headers h WHERE h.repo = 'perfectuser21/cecelia' AND h.kind IN ('api','db_schema','graph','test') AND h.source_revision = :'baseline') = 4 AS map_ok,
    (SELECT count(*) FROM harness_impact_contracts c JOIN target t ON t.id = c.task_id WHERE c.status = 'active' AND c.base_revision = :'baseline') = 1 AS contract_ok
)
SELECT 1 / CASE WHEN has_recent_task AND receipt_ok AND map_ok AND contract_ok THEN 1 ELSE 0 END
FROM checks;
