-- Migration 098: 飞书增强 v1 —— 对话历史 + 用户缓存

-- 飞书对话历史（per-user 滚动上下文）
CREATE TABLE IF NOT EXISTS feishu_conversations (
  id          BIGSERIAL PRIMARY KEY,
  open_id     TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feishu_conv_open_id_created
  ON feishu_conversations (open_id, created_at DESC);

-- 飞书用户信息缓存（open_id → 名称）
CREATE TABLE IF NOT EXISTS feishu_users (
  open_id     TEXT        PRIMARY KEY,
  name        TEXT,
  en_name     TEXT,
  user_id     TEXT,      -- 对应 cecelia user_id（owner / guest）
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_version (version, description)
VALUES ('098', '飞书增强 v1: feishu_conversations + feishu_users')
ON CONFLICT (version) DO NOTHING;
