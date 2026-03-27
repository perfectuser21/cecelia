-- Migration 201: content_type_configs 表
-- 将 content-type 配置从 YAML 文件迁移到数据库，支持前端 CRUD 编辑

CREATE TABLE IF NOT EXISTS content_type_configs (
  content_type VARCHAR(100) PRIMARY KEY,
  title VARCHAR(200),
  description TEXT,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by VARCHAR(100) DEFAULT 'system'
);

-- 索引：按 updated_at 排序（管理界面用）
CREATE INDEX IF NOT EXISTS idx_content_type_configs_updated_at
  ON content_type_configs (updated_at DESC);

-- 记录 schema 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('201', 'content_type_configs 表 - YAML 配置迁移到 DB', NOW())
ON CONFLICT (version) DO NOTHING;
