-- Migration 134: goals/projects/tasks 表添加 domain 和 owner_role 字段
-- 支持 OKR 按领域分类和路由
-- domain 有效值: coding/product/growth/finance/research/quality/security/operations/knowledge/agent_ops
-- owner_role 有效值: cto/coo/cpo/cmo/cfo/vp_qa/vp_research/vp_knowledge/vp_agent_ops

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS domain VARCHAR(50),
  ADD COLUMN IF NOT EXISTS owner_role VARCHAR(50);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS domain VARCHAR(50),
  ADD COLUMN IF NOT EXISTS owner_role VARCHAR(50);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS domain VARCHAR(50);

INSERT INTO schema_version (version, description)
  VALUES ('134', 'goals/projects/tasks: domain 和 owner_role 字段支持多领域 OKR 路由');
