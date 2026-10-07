-- Migration 532: runs 增 Notion 投影记账列 + 登记投影占位行（OpenClaw 运行记录入库 Task 1）
--
-- 「一次运行 = 一行 runs」（迁移 531 建表）将作为投影面推到 Notion「最近执行」库。
-- 记账列与 decisions / task_runs（468）等所有被投影表的约定逐字一致
-- （lib/notion-projection-engine.js 的 pushRegisteredRows 增量与去重依赖）：
--   notion_id         Notion 页 id（首次推送后回写）
--   notion_synced_at  最近一次成功推送时间
--   notion_digest     最近一次推送内容摘要（内容未变则跳过）
-- 纯 additive，不改 531 现有列；重跑是空操作（IF NOT EXISTS）。

ALTER TABLE runs ADD COLUMN IF NOT EXISTS notion_id text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS notion_synced_at timestamptz;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS notion_digest text;

-- 有 notion_id 列却未登记 = 守夜报红（notion-projection-registry.findUnregisteredNotionTables）。
-- Notion「最近执行」库尚未建，先按 453 / 468 的先例登记 pending_vessel 占位行；
-- 库建好后把这行的 notion_db_id 换成真库 id、direction 改 push、status 改 active
-- （resolveDbId 只认 direction∈{push,both} 且 active，占位期不会被误推）。
INSERT INTO notion_projection_map
  (notion_db_id, title, face, brain_table, direction, vessel, status, space, notes)
VALUES
  ('unmapped:runs', '（无 Notion 库）最近执行', 'mirror', 'runs', 'none',
   '(runs-notion-projection 待建库；库注册前跳过)', 'pending_vessel', 'system',
   '一次运行=一行 run 的真身（迁移 531）；Notion「最近执行」库待建，见 OpenClaw 运行记录入库设计')
ON CONFLICT DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES ('532', 'runs 增 Notion 投影记账列 notion_id/notion_synced_at/notion_digest')
ON CONFLICT (version) DO NOTHING;
