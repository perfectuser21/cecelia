-- 543: 「技能工厂看板」Notion 镜子库登记进注册表（任务 1b3c0000；决策 bf7d8753 / 5826ddd7 / de6dff5d）
--
-- 看板由 Brain tasks 里的技能工厂阶段任务派生（一条流程一行：阶段 / skill 版本 / 连续通过 / 最近运行结果 / 卡点 / 裁判 / 生产版本），
-- 不是一表一镜，所以 brain_table 留空；推送代码 skill-factory-board.js 按 vessel = 'skill-factory-board' 找库，没登记整段跳过。
-- 血管在 Brain 内（scheduler job skill-factory-board，自 gate 5 分钟），只读 cecelia 库；页身份 = projection_links(target=notion-skill-factory) + 「Brain ID」列。
-- 库挂在「数据落脚总台账」页下。重跑是空操作（唯一索引 notion_db_id + COALESCE(brain_table,'')）。
BEGIN;

SET LOCAL lock_timeout = '10s';

INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, notes)
VALUES
  ('3f5c40c2-ba63-818e-9813-dedb2576f8e5', '技能工厂看板', 'mirror', NULL, 'push',
   'skill-factory-board', 'active', 'system',
   '真身 cecelia.tasks 技能工厂阶段任务（payload.stage 或【执行参数】阶段）+ 子任务（执行单/审计单）+ workflows/activity_judgments/activity_release_state；Brain scheduler 每 5 分钟推')
ON CONFLICT DO NOTHING;

INSERT INTO schema_version (version, description)
VALUES ('543', '技能工厂看板 Notion 镜子库登记 notion_projection_map（vessel skill-factory-board）')
ON CONFLICT (version) DO NOTHING;

COMMIT;
