-- migration 109: user_profile_facts — 添加 key + source 字段
-- key:    结构化 fact 的唯一键（'display_name', 'focus_area', 'preferred_style', 'raw.<k>'）
--         手动添加的 facts key 为 NULL（不参与唯一约束）
-- source: 来源标记，'auto'（LLM 自动提取）或 'manual'（用户手动添加）
-- 效果:   同一用户同一 key 的 fact UPSERT 不会产生重复行

ALTER TABLE user_profile_facts
  ADD COLUMN IF NOT EXISTS key TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- 部分唯一索引：仅对有 key 的行强制唯一（NULL key 的手动记录不受约束）
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profile_facts_user_key
  ON user_profile_facts (user_id, key)
  WHERE key IS NOT NULL;

INSERT INTO schema_version (version, description)
VALUES ('109', 'user_profile_facts — 添加 key + source 字段，部分唯一索引防重')
ON CONFLICT (version) DO NOTHING;
