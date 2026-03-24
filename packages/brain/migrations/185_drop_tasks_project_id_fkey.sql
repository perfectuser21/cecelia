-- Migration 185: 移除 tasks.project_id 外键约束
-- 背景：tasks.project_id FK 原指向旧 projects 表，迁移到新 OKR 层级表（okr_projects/okr_scopes/okr_initiatives）后
--       tasks.project_id 将引用 okr_initiatives.id，FK 约束会阻止向新表引用。
-- 影响：tasks.project_id 成为普通 UUID 字段，引用完整性由应用层（planner.js projCheck）保证。

BEGIN;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_project_id_fkey;

-- 更新 schema_version
INSERT INTO schema_version (version, description, applied_at)
VALUES ('185', 'drop tasks_project_id_fkey — 迁移到新 OKR 表后由应用层保证引用完整性', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
