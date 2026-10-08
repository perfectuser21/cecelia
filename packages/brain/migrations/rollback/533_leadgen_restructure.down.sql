-- Rollback 533: 按 migration_533_backup 还原能力/复用 Activity/闹钟项，删掉四条新流程（引用随流程级联删）与六个新 Activity。
-- 旧流程、定义版本、release、Step 在 533 里都没动，这里也不碰。

BEGIN;

UPDATE capabilities c
   SET name = b.row->>'name', description = b.row->>'description', status = b.row->>'status', updated_at = NOW()
  FROM migration_533_backup b
 WHERE b.kind = 'capability' AND c.id::text = b.id;

UPDATE activities a
   SET name = b.row->>'name', promise = b.row->>'promise',
       inputs = NULLIF(b.row->'inputs', 'null'::jsonb), outputs = NULLIF(b.row->'outputs', 'null'::jsonb),
       readback = NULLIF(b.row->'readback', 'null'::jsonb), updated_at = NOW()
  FROM migration_533_backup b
 WHERE b.kind = 'activity' AND a.id::text = b.id;

UPDATE ops_schedule_entries e
   SET workflow_id = NULLIF(b.row->>'workflow_id', '')::uuid
  FROM migration_533_backup b
 WHERE b.kind = 'schedule_entry' AND e.id::text = b.id;

DELETE FROM workflows
 WHERE id IN ('b1000000-0000-4000-8000-000000000101', 'b1000000-0000-4000-8000-000000000102',
              'b1000000-0000-4000-8000-000000000103', 'b1000000-0000-4000-8000-000000000104');

DELETE FROM activities a
 WHERE a.id IN ('c1000000-0000-4000-8000-000000000101', 'c1000000-0000-4000-8000-000000000102', 'c1000000-0000-4000-8000-000000000103',
                'c1000000-0000-4000-8000-000000000104', 'c1000000-0000-4000-8000-000000000105', 'c1000000-0000-4000-8000-000000000106')
   AND NOT EXISTS (SELECT 1 FROM workflow_activity_refs r WHERE r.activity_id = a.id);

-- 上线后目录投影可能已为新流程/新 Activity 建了 Notion 页：删掉它们的投影链接（Notion 页留着，由清理脚本归档）
DELETE FROM projection_links
 WHERE entity_id::text IN ('b1000000-0000-4000-8000-000000000101', 'b1000000-0000-4000-8000-000000000102',
                           'b1000000-0000-4000-8000-000000000103', 'b1000000-0000-4000-8000-000000000104',
                           'c1000000-0000-4000-8000-000000000101', 'c1000000-0000-4000-8000-000000000102', 'c1000000-0000-4000-8000-000000000103',
                           'c1000000-0000-4000-8000-000000000104', 'c1000000-0000-4000-8000-000000000105', 'c1000000-0000-4000-8000-000000000106');

DROP TABLE IF EXISTS migration_533_backup;

DELETE FROM schema_version WHERE version = '533';

COMMIT;
