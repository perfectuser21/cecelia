-- Migration 459: 接力棒·投影 注册表订正（PR3，主理人 2026-09-23 拍板）
--
-- ① Projects 库(d83c40c2)多一根血管：tasks 里 task_type='project' 的根 → 一页一条链（镜子面）。
--    Projects 本身仍是入口（okr_projects / blocks 两行不动），这一行只登记新增的推送面。
-- ② 「决策」库(f93e1918)方向 ingest → both：Brain 把接力棒待拍板（status=pending, trigger=handoff）
--    推成「草案」；主理人改「已决定」后入口回灌更新同一行并自动登记执行子任务。
-- 幂等：唯一键 (notion_db_id, coalesce(brain_table,''))，重放不重复。

INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, reconcile, notes) VALUES
('d83c40c2-ba63-8323-8dc7-01cc291c4d9b','Projects','mirror','tasks','push','notion-relay-projection.pushProjectRoots','active','private',
 '{"mode":"digest","key":"notion_props.project_digest","scope":"task_type=project"}',
 '接力棒：project 根一页一链（目标/有序子任务/待拍板/最近交接）。同库另两行是入口面（okr_projects/blocks）；子任务经 Tasks 库 Project 关系挂回来')
ON CONFLICT (notion_db_id, COALESCE(brain_table, '')) DO NOTHING;

UPDATE notion_projection_map
   SET direction = 'both',
       vessel = 'notion-inlet-ingest.ingestDecisionsInlet ⇄ notion-relay-projection.pushPendingDecisions',
       notes = COALESCE(notes, '') || '；接力棒：Brain 推待拍板为「草案」，人改「已决定」回灌同一行 + 自动登记「执行拍板」子任务挂根'
 WHERE notion_db_id = 'f93e1918-56c1-4f31-9a41-36aa76a1c9c2' AND brain_table = 'decisions';
