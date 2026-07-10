-- Migration 330: learnings 表两列追加
-- parent_learning_id: 自引用，标记事件层learning→原子准则层learning的归属关系
-- verified_effective: 是否真实验证过该learning生效（NULL=未评估, true=已验证生效, false=已验证无效）

ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS parent_learning_id UUID REFERENCES learnings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_effective BOOLEAN DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_learnings_parent_id ON learnings(parent_learning_id) WHERE parent_learning_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_learnings_verified_effective ON learnings(verified_effective) WHERE verified_effective IS NOT NULL;
