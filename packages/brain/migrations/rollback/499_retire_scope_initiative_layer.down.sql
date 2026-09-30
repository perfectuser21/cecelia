-- Rollback 499：撤掉写保护 trigger + function，okr_scopes/okr_initiatives/okr_projects
-- 恢复可写。不撤销 ①步的 okr_projects→projects 补搬家（数据在 projects 里不影响
-- okr_projects 本身，回滚不需要删）。
BEGIN;
DROP TRIGGER IF EXISTS trg_okr_scopes_write_retired ON okr_scopes;
DROP TRIGGER IF EXISTS trg_okr_initiatives_write_retired ON okr_initiatives;
DROP TRIGGER IF EXISTS trg_okr_projects_write_retired ON okr_projects;
DROP FUNCTION IF EXISTS reject_retired_layer_write();
DELETE FROM schema_version WHERE version = '499';
COMMIT;
