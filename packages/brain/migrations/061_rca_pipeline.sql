-- Migration 061: RCA Pipeline - Add last_analyzed_at to failure_signatures
--
-- 功能：支持端到端自动化根因分析 RCA Pipeline
-- 1. 添加 last_analyzed_at 列到 failure_signatures 表（防止重复分析）
-- 2. 添加 last_analyzed_at 索引

-- ============================================================
-- 1. Add last_analyzed_at column to failure_signatures
-- ============================================================
ALTER TABLE failure_signatures
ADD COLUMN IF NOT EXISTS last_analyzed_at TIMESTAMPTZ;

COMMENT ON COLUMN failure_signatures.last_analyzed_at IS '最近一次触发 RCA 分析的时间（用于防止重复分析）';

-- ============================================================
-- 2. Add index for efficient querying
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_failure_signatures_last_analyzed
ON failure_signatures(last_analyzed_at);

-- ============================================================
-- 3. Update schema version
-- ============================================================
INSERT INTO schema_version (version, description)
VALUES ('061', 'RCA Pipeline - Add last_analyzed_at to failure_signatures')
ON CONFLICT (version) DO NOTHING;
