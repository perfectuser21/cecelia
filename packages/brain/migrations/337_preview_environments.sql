-- Migration 337: preview_environments 表升级——WS1 完整预览环境（预览Brain + 隔离数据库）
-- migration 310 已建过旧表（只支持前端静态预览：port+pid，无 db_name），
-- 本迁移升级为新 lifecycle 需要的列（db_name/updated_at）+ 状态感知唯一约束（CREATE TABLE IF NOT EXISTS 对已存在表无效，必须 ALTER）。
-- 接通预览闸模型 WS1（决策 48331b37）

CREATE TABLE IF NOT EXISTS preview_environments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_number    INTEGER NOT NULL,
  branch_name  TEXT NOT NULL,
  base_repo    TEXT NOT NULL DEFAULT 'cecelia',
  port         INTEGER NOT NULL,
  db_name      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'starting',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 已存在旧表（migration 310）时补齐新列
ALTER TABLE preview_environments ADD COLUMN IF NOT EXISTS db_name TEXT;
UPDATE preview_environments SET db_name = 'cecelia_preview_' || pr_number WHERE db_name IS NULL;
ALTER TABLE preview_environments ALTER COLUMN db_name SET NOT NULL;

ALTER TABLE preview_environments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE preview_environments SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL;
ALTER TABLE preview_environments ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE preview_environments ALTER COLUMN updated_at SET DEFAULT NOW();

UPDATE preview_environments SET base_repo = 'cecelia' WHERE base_repo IS NULL;
ALTER TABLE preview_environments ALTER COLUMN base_repo SET DEFAULT 'cecelia';
ALTER TABLE preview_environments ALTER COLUMN base_repo SET NOT NULL;

ALTER TABLE preview_environments ALTER COLUMN status SET DEFAULT 'starting';

-- 旧表 port 是全局 UNIQUE 约束（stopped 状态也占用），新逻辑需要"仅活跃态互斥"，替换为状态感知的唯一索引
ALTER TABLE preview_environments DROP CONSTRAINT IF EXISTS preview_environments_port_key;

CREATE UNIQUE INDEX IF NOT EXISTS preview_environments_pr_number_unique
  ON preview_environments (pr_number)
  WHERE status != 'inactive';

CREATE UNIQUE INDEX IF NOT EXISTS preview_environments_port_unique
  ON preview_environments (port)
  WHERE status != 'inactive';
