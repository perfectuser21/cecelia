-- 080: 反刍回路 Phase 2 — learnings 归档列
-- 90天已消化的知识自动归档，防止表无限增长

ALTER TABLE learnings ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

-- 部分索引：只索引未归档的已消化记录（归档候选）
CREATE INDEX IF NOT EXISTS idx_learnings_archived ON learnings (created_at) WHERE digested = true AND archived = false;
