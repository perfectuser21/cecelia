-- Migration 090: memory → learning → task 三段闭环链条
-- memory_stream 加 status 字段，learnings 加 source_memory_id

-- 1. memory_stream: 加入闭环状态字段
ALTER TABLE memory_stream
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS resolved_by_task_id UUID,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- 2. memory_stream: status 合法值约束
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'memory_stream_status_check'
  ) THEN
    ALTER TABLE memory_stream
      ADD CONSTRAINT memory_stream_status_check
        CHECK (status IN ('active', 'resolved'));
  END IF;
END$$;

-- 3. memory_stream: 已有记录全部标记为 active
UPDATE memory_stream SET status = 'active' WHERE status IS NULL OR status = '';

-- 4. memory_stream: 检索索引（只返回 active 记录）
CREATE INDEX IF NOT EXISTS idx_memory_stream_status
  ON memory_stream (status, created_at DESC)
  WHERE status = 'active';

-- 5. learnings: 加 source_memory_id（指向触发该 learning 的 memory_stream 记录）
ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS source_memory_id UUID REFERENCES memory_stream(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_learnings_source_memory
  ON learnings (source_memory_id)
  WHERE source_memory_id IS NOT NULL;

-- 6. 记录 schema 版本
INSERT INTO schema_migrations (version, applied_at)
  VALUES ('090', NOW())
  ON CONFLICT (version) DO NOTHING;
