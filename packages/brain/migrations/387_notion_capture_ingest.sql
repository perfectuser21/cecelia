-- Migration 387: Notion 采集器双 token 幂等基础字段
--
-- 目的：
--   1. captures 表增加 notion_page_id（信封级幂等锚）
--   2. capture_atoms 表增加 notion_page_id + 唯一索引（原子级幂等，防重编辑产生第二条）
--   3. working_memory 已存在，无需新建（存储增量游标 + 自 gate 时间戳）
--
-- 设计原则：
--   - 同一 Notion 页面第一次写入 → captures(ON CONFLICT dedupe_key DO UPDATE) + atom INSERT
--   - 同页重复编辑 → captures 内容刷新, atom ON CONFLICT notion_page_id DO NOTHING
--   - 凭据：NOTION_API_KEY 从 env → ~/ .credentials/CCAPI2026.env 兜底，禁硬编码

BEGIN;

-- 1. captures 信封：notion 来源页面 ID
ALTER TABLE captures
  ADD COLUMN IF NOT EXISTS notion_page_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_captures_notion_page_id
  ON captures (notion_page_id)
  WHERE notion_page_id IS NOT NULL;

COMMENT ON COLUMN captures.notion_page_id IS
  'Notion 页面 ID（如 1a2b3c4d-…），来源 source=notion_inbox 时填入，用于 psql 可查';

-- 2. capture_atoms 原子：notion 来源页面 ID + 唯一索引（幂等锚）
ALTER TABLE capture_atoms
  ADD COLUMN IF NOT EXISTS notion_page_id VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS idx_capture_atoms_notion_page_id
  ON capture_atoms (notion_page_id)
  WHERE notion_page_id IS NOT NULL;

COMMENT ON COLUMN capture_atoms.notion_page_id IS
  'Notion 页面 ID，唯一索引保证同页重复编辑不产生第二条原子（ON CONFLICT DO NOTHING）';

INSERT INTO schema_version (version, description, applied_at)
VALUES ('387', 'notion_capture_ingest: notion_page_id on captures+capture_atoms, unique atom idx', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
