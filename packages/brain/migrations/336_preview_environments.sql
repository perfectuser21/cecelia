-- Migration 334: preview_environments 表
-- 用于 per-PR 完整预览环境（预览Brain + 隔离数据库）端口池管理
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

CREATE UNIQUE INDEX IF NOT EXISTS preview_environments_pr_number_unique
  ON preview_environments (pr_number)
  WHERE status != 'inactive';

CREATE UNIQUE INDEX IF NOT EXISTS preview_environments_port_unique
  ON preview_environments (port)
  WHERE status != 'inactive';
