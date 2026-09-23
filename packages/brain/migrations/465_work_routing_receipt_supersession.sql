-- Migration 465: work_routing_receipts 链式接班（派发时重锚定 base_sha）。
-- 413 的 append-only 触发器保留；同一路由键允许多代收据，用 anchor_generation 区分。
-- 任务 d9c405e2 / 决策 49035988。
BEGIN;

ALTER TABLE work_routing_receipts
  ADD COLUMN IF NOT EXISTS anchor_generation integer NOT NULL DEFAULT 1;

-- 旧三列唯一键在 413 里未命名，按定义查找后删除，不依赖默认名。
DO $$
DECLARE
  legacy_name text;
BEGIN
  SELECT conname INTO legacy_name
    FROM pg_constraint
   WHERE conrelid = 'work_routing_receipts'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) = 'UNIQUE (source, source_id, router_version)';
  IF legacy_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE work_routing_receipts DROP CONSTRAINT %I', legacy_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'work_routing_receipts'::regclass
       AND conname = 'work_routing_receipts_route_generation_unique'
  ) THEN
    ALTER TABLE work_routing_receipts
      ADD CONSTRAINT work_routing_receipts_route_generation_unique UNIQUE (source, source_id, router_version, anchor_generation);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'work_routing_receipts'::regclass
       AND conname = 'work_routing_receipts_supersedes_unique'
  ) THEN
    ALTER TABLE work_routing_receipts
      ADD CONSTRAINT work_routing_receipts_supersedes_unique UNIQUE (supersedes_receipt_id);
  END IF;
END
$$;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('465', 'work_routing_receipts chained supersession via anchor_generation', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
