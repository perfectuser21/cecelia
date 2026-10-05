-- Rollback 526：只删本迁移挂的引用（source_path = 'migration:526'），再删因此变空的 gp_steps 主线流程
BEGIN;

DELETE FROM workflow_activity_refs WHERE source_path = 'migration:526';

DELETE FROM workflows w
 WHERE w.key LIKE 'gp_steps_%'
   AND NOT EXISTS (SELECT 1 FROM workflow_activity_refs r WHERE r.workflow_id = w.id);

DELETE FROM schema_version WHERE version = '526';

COMMIT;
