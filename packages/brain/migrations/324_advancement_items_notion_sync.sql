-- Migration 324: advancement_items 加 notion_synced_at 列（供 pushAdvancementItems 去重）
ALTER TABLE advancement_items ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMPTZ;
