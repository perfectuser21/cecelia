-- Migration: 272_agent_ops_agents
-- Purpose: Path 4 Sprint 1 — agent_ops 基础表 agents
--
-- 背景：agent_ops 路径引入 wechat-rpa / openrouter 等外部 Agent，
--   需要统一的 Agent 注册表，记录 agent 类型、状态、配置和健康信息。
--
-- 设计：
--   1. agent_type 用 CHECK 约束限定合法枚举（防止应用层写入垃圾值）
--   2. status 用 CHECK 约束限定生命周期状态
--   3. config JSONB 存储 agent 特定配置（如 endpoint、python_path 等）
--   4. host_alias 用于部署目标标识（如 rog、mac-mini）

BEGIN;

CREATE TABLE IF NOT EXISTS agent_ops_agents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  agent_type   TEXT NOT NULL
    CONSTRAINT chk_agent_type CHECK (
      agent_type IN ('wechat_rpa', 'openrouter_llm', 'browser_rpa', 'shell_exec')
    ),
  status       TEXT NOT NULL DEFAULT 'inactive'
    CONSTRAINT chk_agent_status CHECK (
      status IN ('active', 'inactive', 'error', 'deploying')
    ),
  host_alias   TEXT NOT NULL DEFAULT 'local'
    CONSTRAINT chk_host_alias CHECK (
      host_alias IN ('local', 'rog', 'mac-mini', 'hk-vps')
    ),
  config       JSONB NOT NULL DEFAULT '{}',
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 按 type+status 组合快速查找活跃 agent
CREATE INDEX IF NOT EXISTS idx_agent_ops_agents_type_status
  ON agent_ops_agents(agent_type, status);

-- 按 host_alias 过滤（部署目标隔离）
CREATE INDEX IF NOT EXISTS idx_agent_ops_agents_host
  ON agent_ops_agents(host_alias);

INSERT INTO schema_version (version, description)
VALUES ('272', 'agent_ops_agents 表 — Agent 注册表（type/status/host CHECK 约束）');

COMMIT;
