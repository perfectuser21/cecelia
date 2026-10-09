-- 回滚前提：不存在 anchor_generation > 1 的接班收据（否则三列唯一键重建会失败，需先人工清理）。
BEGIN;
ALTER TABLE work_routing_receipts DROP CONSTRAINT IF EXISTS work_routing_receipts_route_generation_unique;
ALTER TABLE work_routing_receipts DROP CONSTRAINT IF EXISTS work_routing_receipts_supersedes_unique;
ALTER TABLE work_routing_receipts DROP COLUMN IF EXISTS anchor_generation;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'work_routing_receipts'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (source, source_id, router_version)'
  ) THEN
    ALTER TABLE work_routing_receipts
      ADD CONSTRAINT work_routing_receipts_source_source_id_router_version_key UNIQUE (source, source_id, router_version);
  END IF;
END
$$;
DROP INDEX IF EXISTS idx_initiative_runs_current_task;
DELETE FROM schema_version WHERE version = '465';
COMMIT;
