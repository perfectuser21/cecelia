-- migration 112: Notion Memory 同步支持
-- 给 user_profile_facts 和 memory_stream 加 notion_id 列，用于跟踪 Notion 同步状态

ALTER TABLE user_profile_facts
  ADD COLUMN IF NOT EXISTS notion_id TEXT;

ALTER TABLE memory_stream
  ADD COLUMN IF NOT EXISTS notion_id TEXT;

INSERT INTO schema_version (version, description)
VALUES ('113', 'Notion Memory 同步 — user_profile_facts + memory_stream 加 notion_id 列')
ON CONFLICT (version) DO NOTHING;
