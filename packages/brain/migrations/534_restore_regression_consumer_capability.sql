-- Migration 534: 回归格归还消费者能力
-- 迁移 520「格子跟随所属 Activity 的能力」把每个格子的 journey_id 统一改成 Activity 的能力。
-- 但共享 Activity 上的回归登记（registerCapabilityRegression 写入，cell_key = regression:<能力>:<step|activity>）
-- 按设计归属「使用它的那个能力」，不是 Activity 的能力：对标获客（a1000000-…02）的 43 条回归被改到了智能获客（…01），
-- 试点发布门禁因此报 43 个 pilot_regression_missing，重登记也会撞 409 身份冲突。
-- 本迁移按 cell_key 里的能力改回，只改「该能力确有生效流程在用此 Activity」的行；空骨架格、非回归格不动。
-- 改前原值进 migration_534_backup。
-- 以后的迁移注意：共享 Activity 的回归登记按「使用它的流程所属能力」归属，不能跟着 Activity 走；
-- 批量改 activity_cells.journey_id 时必须排除 cell_kind='scenario' AND cell_key LIKE 'regression:%'。

BEGIN;

CREATE TABLE IF NOT EXISTS migration_534_backup (
  row_id     text PRIMARY KEY,
  journey_id uuid,
  backed_up_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TEMP TABLE m534_targets ON COMMIT DROP AS
SELECT c.id, c.journey_id AS old_journey_id, split_part(c.cell_key, ':', 2)::uuid AS consumer_id
  FROM activity_cells c
 WHERE c.cell_kind = 'scenario'
   AND c.cell_key LIKE 'regression:%'
   AND split_part(c.cell_key, ':', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND c.journey_id IS DISTINCT FROM split_part(c.cell_key, ':', 2)::uuid;

INSERT INTO migration_534_backup (row_id, journey_id)
SELECT t.id::text, t.old_journey_id FROM m534_targets t
ON CONFLICT (row_id) DO NOTHING;

UPDATE activity_cells c
   SET journey_id = t.consumer_id, notion_synced_at = NULL
  FROM m534_targets t
 WHERE c.id = t.id
   AND c.cell_kind = 'scenario'
   AND c.cell_key LIKE 'regression:%'
   AND c.journey_id IS DISTINCT FROM split_part(c.cell_key, ':', 2)::uuid
   AND EXISTS (SELECT 1 FROM workflow_activity_refs r JOIN workflows w ON w.id = r.workflow_id
                WHERE r.active AND r.activity_id = c.step_id AND w.capability_id = t.consumer_id AND w.status <> 'retired');

INSERT INTO schema_version (version, description)
VALUES ('534', '回归格归还消费者能力：迁移 520 格子跟随 Activity 时误改的共享 Activity 回归登记按 cell_key 改回所属能力')
ON CONFLICT (version) DO NOTHING;

COMMIT;
