-- Migration 330: learnings 谱系两列 + summary backfill + task_completion 历史噪音清理
-- 依据: docs/architecture/2026-07-10-nine-elements-integrity/addendum-01（T9）
-- parent_learning_id: 事件层→原子准则层归纳链（自引用）。注意与既有 parent_id（migration 063 去重版本链）语义不同，并存。
-- verified_effective: NULL=未验证 / true/false=验证结论。

ALTER TABLE learnings ADD COLUMN IF NOT EXISTS parent_learning_id UUID REFERENCES learnings(id);
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS verified_effective BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_learnings_parent_learning_id
  ON learnings(parent_learning_id) WHERE parent_learning_id IS NOT NULL;

-- 存量 summary backfill（COALESCE 防 NULL 吞掉结果；只补空行，幂等）
UPDATE learnings
SET summary = LEFT(regexp_replace(COALESCE(title,'') || ' ' || COALESCE(content,''), '\s+', ' ', 'g'), 100)
WHERE summary IS NULL;

-- task_completion 历史噪音清理（写入源头已在代码层移除）
DELETE FROM learnings WHERE category = 'task_completion';

INSERT INTO schema_version (version, description)
VALUES ('330', 'learnings lineage columns + summary backfill + task_completion noise cleanup')
ON CONFLICT (version) DO NOTHING;
