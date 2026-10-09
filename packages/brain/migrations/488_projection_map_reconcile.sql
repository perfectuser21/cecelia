-- Migration 488: notion_projection_map 与现实对账（任务 a7a6b8b4，交接单第 3 步）
--
-- 09-28/29 实查：注册表漏登记了确实在被写的库，又把视图当成独立表登记。
-- 一、补登记（2026-09-29 读 us-vps crontab + /opt/openclaw 脚本 + Notion API 核实）：
--     OPC 经营对象 3d6c…617d ← opc-objects-sync.py 每 30 分从飞书多维表 upsert（真身=飞书，非 Brain）；
--     OPC 日报     3dbc…0f68 ← opc-daily-page.py 每天重写（数据源=飞书经营对象表 + openclaw 会话）；
--     Key Results  684c…a18c ← opc-kr-current.py 只写 Current 列；opc-okr-sync.py 读出生成各 agent OKR.md；Target 归主理人；
--     Cecelia Tasks 3b7c…e356 / Cecelia Projects 3b7c…4204 ← projection/outbox.js（projection_targets.notion 的
--       task_db_id / project_db_id）。最后一次写入 2026-09-28 23:01（device_job「触达·单」页），
--       决策 71e0087b 于 23:33 把 projection_targets.notion 置 enabled=false → 登记 archived/none。
--       tasks.notion_id 仍有约 1.3 万行指向旧库页面（无 pushed_status 指纹，pushTasks 不会 PATCH 它们）。
-- 二、「部门日报」3dbc…25b9 推送方「待核」→ 核实为 opc-daily-page.py upsert_dept_rows。
-- 三、unmapped:acceptance_criteria / unmapped:features_registry 是迁移 391 的行业名视图别名，不是独立表：归档并写明真表。
--     （backbone_activities 已由 482 归档；value_streams 由迁移 487 处理，本迁移不碰。）
-- 幂等：INSERT ON CONFLICT DO NOTHING；UPDATE 带条件，已归档/已核实的行不重复动。

INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, notes) VALUES
('3d6c40c2-ba63-811f-a83e-f981a044617d', 'OPC 经营对象', 'mirror', NULL, 'push', 'us-vps cron /opt/openclaw/opc-objects-sync.py(每30分，飞书多维表→Notion upsert)', 'active', 'system', '真身=飞书多维表格「OPC 经营对象」，非 Brain；迁移 488 补登记'),
('3dbc40c2-ba63-81eb-b0c8-c571370b0f68', 'OPC 日报', 'mirror', NULL, 'push', 'us-vps cron /opt/openclaw/opc-daily-page.py(每日重写当天行)', 'active', 'system', '数据源=飞书经营对象表+openclaw 会话，非 Brain；迁移 488 补登记'),
('684c40c2-ba63-83a7-b6ba-8161f110a18c', 'Key Results', 'inlet', NULL, 'both', 'us-vps cron /opt/openclaw/opc-kr-current.py(只写 Current 列) / opc-okr-sync.py(读出→agent OKR.md)', 'active', 'private', 'Notion 为 KR 真身，Target 归主理人；与 Goals 29ec… 成对；迁移 488 补登记'),
('3b7c40c2-ba63-814b-b713-c350e5c5e356', 'Cecelia Tasks', 'mirror', 'tasks', 'none', '(停写：projection/outbox.js runProjectionOutbox，projection_targets.notion.task_db_id，enabled=false)', 'archived', 'system', '旧任务库；决策 71e0087b（2026-09-28 23:33）停用投影，英文任务库只留 Tasks d5bc…；约 1.3 万行 tasks.notion_id 仍指向本库页面（遗留，无指纹不被 PATCH）'),
('3b7c40c2-ba63-8101-a1d1-e48a975a4204', 'Cecelia Projects', 'mirror', 'okr_projects', 'none', '(停写：projection/outbox.js runProjectionOutbox，projection_targets.notion.project_db_id，enabled=false)', 'archived', 'system', '旧项目库，已在 Notion 回收站；随决策 71e0087b 一并停写')
ON CONFLICT DO NOTHING;

UPDATE notion_projection_map
   SET vessel = 'us-vps cron /opt/openclaw/opc-daily-page.py upsert_dept_rows(每日)',
       notes = COALESCE(notes || '；', '') || '推送方迁移 488 核实（数据源=飞书经营对象表，非 Brain）',
       updated_at = NOW()
 WHERE notion_db_id = '3dbc40c2-ba63-8168-8ec5-ea3aba0f25b9' AND vessel = '(推送方待核)';

UPDATE notion_projection_map
   SET status = 'archived', direction = 'none', vessel = '(视图别名，无独立血管)',
       notes = '是视图别名（迁移 391 CREATE VIEW acceptance_criteria AS SELECT * FROM journey_step_links），真表见 journey_step_links（Notion「承诺地图格子」3e8c…b508bb）；迁移 488 归档',
       updated_at = NOW()
 WHERE notion_db_id = 'unmapped:acceptance_criteria' AND status <> 'archived';

UPDATE notion_projection_map
   SET status = 'archived', direction = 'none', vessel = '(视图别名，无独立血管)',
       notes = '是视图别名（迁移 391 CREATE VIEW features_registry AS SELECT * FROM journey_features），真表见 journey_features（Notion「AI Feature」358c…4dff）；迁移 488 归档',
       updated_at = NOW()
 WHERE notion_db_id = 'unmapped:features_registry' AND status <> 'archived';

INSERT INTO schema_version (version, description)
VALUES ('488', 'notion_projection_map 对账：补登记 OPC 两库/Key Results/旧 Cecelia Tasks+Projects，部门日报推送方核实，两视图别名行归档')
ON CONFLICT (version) DO NOTHING;
