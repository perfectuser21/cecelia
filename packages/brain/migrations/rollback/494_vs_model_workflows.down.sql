-- Rollback 494：种子 → 视图 → 列 → 触发器/函数 → 表 → 种子 capability → schema_version（顺序不能反：列被视图引用，表被列外键引用）
BEGIN;
DELETE FROM enabler_calls WHERE enabler_id IN (SELECT id FROM enablers WHERE key IN ('device_lock', 'account_selfcheck'));
DELETE FROM enablers WHERE key IN ('device_lock', 'account_selfcheck');
DROP VIEW IF EXISTS backbone_activities;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS enabler_id;
ALTER TABLE journey_steps DROP CONSTRAINT IF EXISTS journey_steps_executor_kind_check;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS executor_kind;
DROP INDEX IF EXISTS idx_journey_steps_workflow;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS workflow_id;
CREATE VIEW backbone_activities AS SELECT id, notion_id, journey_id, name, description, step_number, status, notion_synced_at, created_at, updated_at, promise, backbone_version FROM journey_steps;
ALTER TABLE ops_workflows DROP COLUMN IF EXISTS workflow_id;
DROP TRIGGER IF EXISTS trg_workflows_capability_guard ON workflows;
DROP FUNCTION IF EXISTS workflows_capability_guard();
DROP INDEX IF EXISTS idx_workflows_capability;
DROP TABLE IF EXISTS workflows;
DELETE FROM journeys WHERE id IN ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002');
DELETE FROM schema_version WHERE version = '494';
COMMIT;
