-- 079: 反刍回路 — learnings 表加 digested 列
-- 用于标记知识是否已被反刍消化

ALTER TABLE learnings ADD COLUMN IF NOT EXISTS digested BOOLEAN DEFAULT false;

-- 部分索引：只索引未消化的记录，按创建时间排序（FIFO 消化）
CREATE INDEX IF NOT EXISTS idx_learnings_undigested ON learnings (created_at ASC) WHERE digested = false;
