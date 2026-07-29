-- Migration 371: acceptance_catalog — GP 目录快照（product-map SSOT 投影，Notion Worker 拉取源）
-- 单行表：id 恒 1；zenithjoy CI 在 product-map 变更合并后经内网 POST 刷新

CREATE TABLE IF NOT EXISTS acceptance_catalog (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('371', 'Acceptance catalog snapshot table for Notion Worker', NOW())
ON CONFLICT (version) DO NOTHING;
