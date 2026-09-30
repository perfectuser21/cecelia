-- Rollback 495: 价值流建模④（任务 ec643d60）
-- 逆序：视图 → task_runs.workflow_id → 索引/表 → schema_version

BEGIN;

DROP VIEW IF EXISTS activity_flow_metrics;

ALTER TABLE task_runs DROP COLUMN IF EXISTS workflow_id;

DROP INDEX IF EXISTS uq_spans_idem;
DROP INDEX IF EXISTS idx_spans_step_started;
DROP INDEX IF EXISTS idx_spans_activity_started;
DROP INDEX IF EXISTS idx_spans_run;
DROP TABLE IF EXISTS spans;

DELETE FROM schema_version WHERE version = '495';

COMMIT;
