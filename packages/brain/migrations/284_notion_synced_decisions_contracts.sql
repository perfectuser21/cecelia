-- Migration 284: 为 decisions 和 initiative_contracts 添加 notion_synced_at 列
-- 用于追踪 Notion 同步状态，支持 notion-push-sync.js 增量推送

ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMPTZ;

ALTER TABLE initiative_contracts
  ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMPTZ;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('284', 'decisions + initiative_contracts 加 notion_synced_at 列', NOW())
ON CONFLICT (version) DO NOTHING;
