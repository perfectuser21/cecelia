-- 453: 注册表允许「一库多表」+ 补齐全部带 notion_id 列的表（三面模型 PR③，决策 297ffee5）
-- 守夜 A7 registry_coverage 的口径：凡带 notion_id 列的表必须在注册表有一行说明去向；
-- 没 Notion 库的用 'unmapped:<表>' 显式登记为 pending_vessel——账里"没有"和"不知道"是两回事。
-- 一库多表：AI Notes 同时装 decisions 与 initiative_contracts；Projects 同时装 okr_projects 与 blocks；
-- 运行图谱同时装 ops_agents 与 ops_schedule_entries（孤儿排程行）。原主键 notion_db_id 挡住了这些，
-- 改为 (notion_db_id, coalesce(brain_table,'')) 唯一索引。
ALTER TABLE notion_projection_map DROP CONSTRAINT IF EXISTS notion_projection_map_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notion_projection_map_db_table
  ON notion_projection_map (notion_db_id, COALESCE(brain_table, ''));

INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, notes) VALUES
('185c40c2-ba63-828c-973f-81a9c4582cd6','AI Notes','mirror','initiative_contracts','push','notion-push-sync.pushInitiativeContracts','active','system','与 decisions 同库（Type=Contract）'),
('d83c40c2-ba63-8323-8dc7-01cc291c4d9b','Projects','inlet','blocks','both','project-compare','active','private','与 okr_projects 同库'),
('3d3c40c2-ba63-815e-be8a-f5048c070d80','Ops 运行图谱','mirror','ops_schedule_entries','push','notion-push-sync.pushOpsGraph(孤儿排程行)','active','system','与 ops_agents 同库'),
('31853f41-3ec5-810a-9188-f08bf7e9ab90','记忆·Owner Profile','mirror','user_profile_facts','push','notion-memory-sync','active','private','F7 记忆与知识'),
('31853f41-3ec5-81e3-ac71-c09f0e69498d','记忆·Diary','mirror','memory_stream','push','notion-memory-sync','active','private','F7 记忆与知识'),
('unmapped:ability_groups','（无 Notion 库）ability_groups','mirror','ability_groups','none','(有 notion_id 列无血管——半截)','pending_vessel','system','能力轴 L2 子领域分组；接血管或删列')
ON CONFLICT DO NOTHING;
