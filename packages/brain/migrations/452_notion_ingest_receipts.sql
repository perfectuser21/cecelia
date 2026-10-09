-- 452: 入口血管收据表 + 两条入口血管接通（三面模型 PR②b，决策 297ffee5）
-- ✍️ 入口库人写、Brain 收。机器不写入口库，受理凭据只记在 Brain：
--   notion_page_id 主键（文件类用 page#file 复合键）；人改了页面 → last_edited_time 前进 → 再收，
--   被覆盖前的值追加进 history（冲突人赢、机器被覆盖值留痕——铁律四）。
CREATE TABLE IF NOT EXISTS notion_ingest_receipts (
  notion_page_id   TEXT PRIMARY KEY,
  notion_db_id     TEXT NOT NULL,
  brain_table      TEXT NOT NULL,          -- decisions / skill_evals
  brain_id         TEXT,                   -- 落到真身的行 id（skill_evals 记 task_id）
  last_edited_time TIMESTAMPTZ,            -- 收账时页面的 last_edited_time
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  history          JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_notion_ingest_receipts_table ON notion_ingest_receipts (brain_table, notion_db_id);

-- 注册表：两条入口血管由 pending_vessel 转 active
UPDATE notion_projection_map
   SET status = 'active', direction = 'ingest', vessel = 'notion-inlet-ingest.ingestDecisionsInlet', updated_at = NOW()
 WHERE notion_db_id = 'f93e1918-56c1-4f31-9a41-36aa76a1c9c2';
UPDATE notion_projection_map
   SET status = 'active', direction = 'ingest', vessel = 'notion-inlet-ingest.ingestStaffSkillInlet', updated_at = NOW()
 WHERE notion_db_id = '53d4654b-26de-433e-b733-8c542e6f20d5';
