-- Migration 067: dept_configs - 部门配置表
--
-- 功能：存储每个部门的配额和 repo 路径
-- Cecelia Tick 读取 enabled=true 的部门，触发 heartbeat

-- ============================================================
-- 1. Create dept_configs table
-- ============================================================
CREATE TABLE IF NOT EXISTS dept_configs (
  dept_name       TEXT        PRIMARY KEY,
  max_llm_slots   INT         NOT NULL DEFAULT 1,   -- 最多同时跑几个大模型员工
  repo_path       TEXT        NOT NULL,             -- 部门 repo 的本地绝对路径
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. Seed ZenithJoy as first department
-- ============================================================
INSERT INTO dept_configs (dept_name, max_llm_slots, repo_path, enabled)
VALUES ('zenithjoy', 2, '/home/xx/perfect21/zenithjoy/workspace', true)
ON CONFLICT (dept_name) DO NOTHING;

-- ============================================================
-- 3. Update schema version
-- ============================================================
INSERT INTO schema_version (version, description)
VALUES ('067', 'dept_configs - 部门配置表，支持 heartbeat 调度')
ON CONFLICT (version) DO NOTHING;
