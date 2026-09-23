-- 回滚前提：不存在 anchor_generation > 1 的接班收据（否则三列唯一键重建会失败，需先人工清理）。
BEGIN;
ALTER TABLE work_routing_receipts DROP CONSTRAINT IF EXISTS work_routing_receipts_route_generation_unique;
ALTER TABLE work_routing_receipts DROP CONSTRAINT IF EXISTS work_routing_receipts_supersedes_unique;
ALTER TABLE work_routing_receipts DROP COLUMN IF EXISTS anchor_generation;
ALTER TABLE work_routing_receipts
  ADD CONSTRAINT work_routing_receipts_source_source_id_router_version_key UNIQUE (source, source_id, router_version);
DELETE FROM schema_version WHERE version = '465';
COMMIT;
