-- Rollback 519：按 migration_519_backup 还原闹钟归位/旧树状态/重复能力状态，删掉本迁移登记的流程，去掉溯源列。
-- 注意：ops_schedule_entries.workflow_id 先按备份还原（备份里全是 NULL），再删 workflows（外键 ON DELETE SET NULL 兜底）。
BEGIN;

UPDATE ops_schedule_entries e
   SET journey_id = (b.payload->>'journey_id')::uuid,
       workflow_id = (b.payload->>'workflow_id')::uuid,
       tree_bucket_manual = b.payload->>'tree_bucket_manual',
       updated_at = NOW()
  FROM migration_519_backup b
 WHERE b.table_name = 'ops_schedule_entries' AND e.id = b.row_id::bigint;

DELETE FROM workflows WHERE legacy_feature_id IS NOT NULL OR key IN (
  'content_calendar_ops', 'factory_f0_ops', 'factory_f1_ops', 'factory_f2_ops', 'factory_f3_ops', 'factory_f4_ops',
  'factory_mj5_ops', 'skill_lifecycle_ops', 'customer_first_success_ops', 'publish_account_session_ops',
  'butler_g1_cockpit_ops', 'butler_g2_inbox_ops', 'butler_g4_memory_ops', 'okr_kr_sync_ops',
  'infra_distribution_sync_ops', 'infra_backup_restore_ops', 'infra_runner_pool_ops', 'infra_data_projection_ops',
  'infra_cleanup_capacity_ops', 'infra_monitoring_alerting_ops', 'infra_network_ingress_ops',
  'infra_device_phone_ledger_ops', 'infra_account_credentials_ops',
  'biz_rhythm_meetings_ops', 'biz_object_ledger_ops', 'biz_broadcast_ops');

UPDATE journey_features f
   SET status = b.payload->>'status', workflow_ref = b.payload->>'workflow_ref', updated_at = NOW()
  FROM migration_519_backup b
 WHERE b.table_name = 'journey_features' AND f.id = b.row_id::uuid;

UPDATE journeys j
   SET status = b.payload->>'status', updated_at = NOW()
  FROM migration_519_backup b
 WHERE b.table_name = 'journeys' AND j.id = b.row_id::uuid;

DROP TABLE IF EXISTS migration_519_backup;
DROP INDEX IF EXISTS idx_workflows_legacy_feature;
ALTER TABLE workflows DROP COLUMN IF EXISTS legacy_feature_id;

DELETE FROM schema_version WHERE version = '519';

COMMIT;
