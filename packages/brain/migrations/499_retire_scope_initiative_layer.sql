-- Migration 499: scope/initiative 层退役 —— 写保护 trigger（接力棒链 2afa6d69 棒4，
-- 决策 ee4842a6/3feeae3e，任务 89ab20de）。
--
-- 背景：主理人拍板 GTD 轴只保留 Objective → Key Result → Project → Task 四级（决策
-- ee4842a6）。棒1（迁移 497）已把 Project 层真身升格为 projects 表；okr_scopes /
-- okr_initiatives 两层拆解机器没有对应的 GTD 概念，整层退役——不删表不删数据（只读
-- 历史），但停写：INSERT/UPDATE 一律抛 layer_retired，DELETE 仍放行（给管理员/清理
-- 脚本留口子）。okr_projects 同样加写保护：棒1起新 Project 一律进 projects 表，
-- okr_projects 不再是任何写入目标。
--
-- ① 先把 okr_projects 里迁移 497 之后新增的行补搬进 projects（同 id，ON CONFLICT
--    DO NOTHING，幂等）——这批行是 497 上线到本迁移之间通过 /api/brain/okr/projects
--    或 actions.js createProject 写入 okr_projects 的数据，写保护生效前必须先落地到
--    真身表，否则这些项目就再也摸不到了。
-- ② 三张表（okr_scopes / okr_initiatives / okr_projects）各挂一个 BEFORE INSERT OR
--    UPDATE trigger，统一走同一个 trigger function（用 TG_TABLE_NAME 报错信息里带表
--    名）。DELETE 不挂 trigger，不受影响。
--
-- 幂等：CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS + CREATE TRIGGER，可安全重放。
BEGIN;

-- ① okr_projects → projects 补搬家（同 497 的搬家语句，只是重放一次接住 497 之后的新增行）
INSERT INTO projects (id, name, description, status, area_id, kr_id, owner_role, start_date, end_date, metadata, custom_props, created_at, updated_at)
SELECT id, title, description, status, area_id, kr_id, owner_role, start_date, end_date, metadata, custom_props, created_at, updated_at
  FROM okr_projects
 ON CONFLICT (id) DO NOTHING;

-- ② 写保护 trigger function（三表共用）
CREATE OR REPLACE FUNCTION reject_retired_layer_write() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'layer_retired: % 层已退役（决策 ee4842a6），写操作一律走 projects/tasks', TG_TABLE_NAME
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_okr_scopes_write_retired ON okr_scopes;
CREATE TRIGGER trg_okr_scopes_write_retired
  BEFORE INSERT OR UPDATE ON okr_scopes
  FOR EACH ROW EXECUTE FUNCTION reject_retired_layer_write();

DROP TRIGGER IF EXISTS trg_okr_initiatives_write_retired ON okr_initiatives;
CREATE TRIGGER trg_okr_initiatives_write_retired
  BEFORE INSERT OR UPDATE ON okr_initiatives
  FOR EACH ROW EXECUTE FUNCTION reject_retired_layer_write();

DROP TRIGGER IF EXISTS trg_okr_projects_write_retired ON okr_projects;
CREATE TRIGGER trg_okr_projects_write_retired
  BEFORE INSERT OR UPDATE ON okr_projects
  FOR EACH ROW EXECUTE FUNCTION reject_retired_layer_write();

COMMENT ON FUNCTION reject_retired_layer_write() IS 'okr_scopes/okr_initiatives/okr_projects 写保护（决策 ee4842a6，迁移 499）：INSERT/UPDATE 抛 layer_retired，DELETE 不受影响，表和历史数据原样保留只读。';

INSERT INTO schema_version (version, description)
VALUES ('499', 'scope/initiative 层退役：okr_scopes/okr_initiatives/okr_projects 写保护 trigger + okr_projects→projects 补搬家（棒4，决策 ee4842a6/3feeae3e）')
ON CONFLICT (version) DO NOTHING;

COMMIT;
