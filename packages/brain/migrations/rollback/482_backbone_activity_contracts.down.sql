-- 回滚 482：获客回到 v2.0 四承诺步骤（格子挂回原承诺步骤），删 8 个 v3.0 活动与 stage:outreach 格子，
-- 撤 Backbone Activities 镜子登记、unmapped 占位行复原 pending_vessel，删契约副本列。
-- 格子原挂法（09-26 棒0）：preflight/cleanup→步1，discovery/qualification→步2，collection/scoring/delivery→步3。
BEGIN;
DO $$
DECLARE
  j uuid := 'afa6abca-53c0-4815-8594-b7fb81ca547f';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journey_steps WHERE journey_id = j AND activity_key IS NOT NULL) THEN
    RETURN;
  END IF;
  DELETE FROM journey_step_links WHERE journey_id = j AND cell_key = 'stage:outreach';
  -- 顺序要紧：①格子先挂回（删 v3.0 行会级联删格子）②删 v3.0 行腾出 1-8 号 ③承诺步骤挪回 1-4 号
  UPDATE journey_step_links l
     SET step_id = s.id, step_order = s.step_number - 200
    FROM journey_steps s
   WHERE l.journey_id = j AND s.journey_id = j AND s.backbone_version = '2.0'
     AND s.step_number = CASE
       WHEN l.cell_key IN ('stage:preflight', 'stage:cleanup') THEN 201
       WHEN l.cell_key IN ('stage:discovery', 'stage:qualification') THEN 202
       WHEN l.cell_key IN ('stage:collection', 'stage:scoring', 'stage:delivery') THEN 203
     END;
  DELETE FROM journey_steps WHERE journey_id = j AND activity_key IS NOT NULL;
  UPDATE journey_steps SET step_number = step_number - 200, status = 'planned', updated_at = NOW()
   WHERE journey_id = j AND backbone_version = '2.0' AND step_number BETWEEN 201 AND 204;
END $$;

DELETE FROM notion_projection_map WHERE notion_db_id = 'c213e387-b2ae-45a4-98c0-4a66fe3408be' AND brain_table = 'journey_steps';
UPDATE notion_projection_map SET status = 'pending_vessel' WHERE notion_db_id = 'unmapped:backbone_activities';

DROP INDEX IF EXISTS uq_journey_steps_activity;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS contract_source;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS contract_sha256;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS contract;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS activity_key;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS capability_key;
ALTER TABLE journey_steps DROP COLUMN IF EXISTS notion_digest;
DELETE FROM schema_version WHERE version = '482';
COMMIT;
