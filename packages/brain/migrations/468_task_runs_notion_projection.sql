-- Migration 468: task_runs 增 Notion 投影记账列（链 bf5088a3 棒1，任务 66db3dfb）
--
-- 「一次执行 = 一行 task_runs」由 lib/task-run.js 唯一写入；PR B 把它作为投影面推到 Notion。
-- 记账列与 decisions / journeys 等所有被投影表的约定逐字一致（lib/notion-projection-engine.js
-- 的 pushRegisteredRows 增量与去重依赖）：
--   notion_id         Notion 页 id（首次推送后回写）
--   notion_synced_at  最近一次成功推送时间
--   notion_digest     最近一次推送内容摘要（内容未变则跳过）
-- 纯 additive，不改 059 现有列；重跑是空操作（IF NOT EXISTS）。

ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS notion_id text;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS notion_synced_at timestamptz;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS notion_digest text;

-- 有 notion_id 列却未登记 = 守夜报红（notion-projection-registry.findUnregisteredNotionTables）。
-- Notion「Runs」库尚未建（PR B 的 pushTaskRuns 在库注册前 flag-off 安全跳过），先按 453 的先例登记
-- pending_vessel 占位行；库建好后把这行的 notion_db_id 换成真库 id、direction 改 push、status 改 active
-- （resolveDbId 只认 direction∈{push,both} 且 active，占位期不会被误推）。
INSERT INTO notion_projection_map
  (notion_db_id, title, face, brain_table, direction, vessel, status, space, notes)
VALUES
  ('unmapped:task_runs', '（无 Notion 库）task_runs', 'mirror', 'task_runs', 'none',
   '(notion-push-sync.pushTaskRuns 待建库；库注册前跳过)', 'pending_vessel', 'system',
   '一次执行=一行 run 的真身（lib/task-run.js 唯一写口）；Notion Runs 库待建，见链 bf5088a3 棒1 handoff')
ON CONFLICT DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES ('468', 'task_runs 增 Notion 投影记账列 notion_id/notion_synced_at/notion_digest')
ON CONFLICT (version) DO NOTHING;
