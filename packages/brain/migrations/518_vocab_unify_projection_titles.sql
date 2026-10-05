-- 518: 词表统一——notion_projection_map 5 个镜子库标题同步为框架标准 v2.0 术语表（决策 cebd1540，任务 726ca1b7）
-- Notion 侧库标题已于 2026-10-05 改名；本迁移只同步 Brain 注册表的 title（投影对账报告/日志用），
-- 按 notion_db_id 定位，不动 direction / face / vessel / brain_table。幂等。
BEGIN;

UPDATE notion_projection_map SET title = '价值流与能力（journeys）', updated_at = NOW()
 WHERE notion_db_id = '358c40c2-ba63-8148-bde7-e313d789931a';
UPDATE notion_projection_map SET title = 'Activity（活动）', updated_at = NOW()
 WHERE notion_db_id = 'c213e387-b2ae-45a4-98c0-4a66fe3408be';
UPDATE notion_projection_map SET title = 'Activity 卡片格子', updated_at = NOW()
 WHERE notion_db_id = '3e8c40c2-ba63-8194-a47c-dcf5f4b508bb';
UPDATE notion_projection_map SET title = '流程（workflows）', updated_at = NOW()
 WHERE notion_db_id = '3d9c40c2-ba63-8145-bfa8-f4c0c006e0af';
UPDATE notion_projection_map SET title = '旧树 · Feature（只读，待退役）', updated_at = NOW()
 WHERE notion_db_id = '358c40c2-ba63-81e3-96c5-d762b3d34dff';

INSERT INTO schema_version (version, description)
VALUES ('518', '词表统一：notion_projection_map 5 个镜子库标题同步为标准词表')
ON CONFLICT (version) DO NOTHING;

COMMIT;
