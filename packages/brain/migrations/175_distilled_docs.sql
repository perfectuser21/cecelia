-- Migration 175: 蒸馏文档层 Layer 2 (distilled_docs)
-- 存储 SOUL / SELF_MODEL / USER_PROFILE / WORLD_STATE 四个永久性摘要文档

CREATE TABLE IF NOT EXISTS distilled_docs (
  type         VARCHAR(64)  PRIMARY KEY,
  content      TEXT         NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  version      INT          NOT NULL DEFAULT 1,
  generated_by VARCHAR(64)  NOT NULL DEFAULT 'system'
);

-- 记录迁移版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('175', 'add distilled_docs table for Layer 2 memory', NOW())
ON CONFLICT (version) DO NOTHING;
