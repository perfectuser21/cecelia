-- Migration 051: Review Gate
--
-- 新增 decomp_reviews 表：记录拆解审查结果
-- Vivian（MiniMax Ultra）审查秋米的拆解产出

-- Step 1: 创建 decomp_reviews 表
CREATE TABLE IF NOT EXISTS decomp_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,            -- 'project' | 'initiative'
  entity_id UUID NOT NULL,
  reviewer TEXT DEFAULT 'vivian',
  verdict TEXT,                          -- 'approved' | 'needs_revision' | 'rejected' (NULL = pending)
  findings JSONB DEFAULT '{}',
  task_id UUID,                          -- 关联的 decomp_review task
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: 索引（按 entity 查询 pending reviews）
CREATE INDEX IF NOT EXISTS idx_decomp_reviews_entity
  ON decomp_reviews (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_decomp_reviews_pending
  ON decomp_reviews (verdict) WHERE verdict IS NULL;

-- Step 3: 事件记录
INSERT INTO cecelia_events (event_type, source, payload)
VALUES ('review_gate_migration', 'migration_051', jsonb_build_object(
  'description', 'Created decomp_reviews table for review gate',
  'timestamp', NOW()::text
));

-- Step 4: 更新 schema version
INSERT INTO schema_version (version, description) VALUES ('051', 'review_gate')
ON CONFLICT (version) DO NOTHING;
