-- Migration 105: synthesis_archive 分层记忆压缩表
-- 存储日/周/月级别的 NotebookLM 合成结果，支持滚动压缩链

CREATE TABLE IF NOT EXISTS synthesis_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level VARCHAR(10) NOT NULL CHECK (level IN ('daily', 'weekly', 'monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  content TEXT NOT NULL,
  previous_id UUID REFERENCES synthesis_archive(id) ON DELETE SET NULL,
  source_count INTEGER DEFAULT 0,      -- 本次综合用了多少条原始数据
  notebook_query TEXT,                 -- 发给 NotebookLM 的 query（调试用）
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synthesis_level_period
  ON synthesis_archive(level, period_start DESC);

-- 防止同一级别同一天重复创建（幂等性）
CREATE UNIQUE INDEX IF NOT EXISTS idx_synthesis_level_period_start
  ON synthesis_archive(level, period_start);


