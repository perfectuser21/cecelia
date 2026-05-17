-- Migration 135: goals 表添加 domain/owner_role 索引
-- 配合 migration 134 已添加的字段，补充查询索引

CREATE INDEX IF NOT EXISTS idx_goals_domain ON goals (domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_goals_owner_role ON goals (owner_role) WHERE owner_role IS NOT NULL;

INSERT INTO schema_version (version, description)
  VALUES ('135', 'goals.domain + goals.owner_role 查询索引');
