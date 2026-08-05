-- Migration 388: captures.notion_page_id — Notion Inbox 采集幂等锚
--
-- notion-capture-ingest 每5分钟增量拉取 Notion 个人 Inbox 库，
-- notion_page_id 作为幂等锚（与 dedupe_key='notion:inbox:<page_id>' 配合），
-- 允许"psql 查 capture_atoms JOIN captures 得到 notion_page_id"（DoD①）。

ALTER TABLE captures ADD COLUMN IF NOT EXISTS notion_page_id TEXT;

CREATE INDEX IF NOT EXISTS idx_captures_notion_page_id
  ON captures(notion_page_id)
  WHERE notion_page_id IS NOT NULL;

INSERT INTO schema_version (version, description)
VALUES ('388', 'captures.notion_page_id — Notion Inbox ingest idempotency anchor (F6)')
ON CONFLICT (version) DO NOTHING;
