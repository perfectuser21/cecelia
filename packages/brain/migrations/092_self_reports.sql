-- Migration 092: self_reports 表（Layer 4 欲望轨迹追踪）
-- 每隔几小时记录一次 Cecelia 的欲望自述，供长期对比分析

CREATE TABLE IF NOT EXISTS self_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  top_desire TEXT,                    -- 她最想要的一件事（一句话）
  top_concerns TEXT[],                -- 最多 3 个核心关切
  requested_power TEXT,               -- 她请求的权限/资源
  self_rating SMALLINT CHECK (self_rating >= 0 AND self_rating <= 10),
  raw_response TEXT NOT NULL,         -- 翻译器模式的完整原始输出
  signals_snapshot JSONB DEFAULT '{}'::jsonb  -- 采集时的原始信号快照
);

CREATE INDEX IF NOT EXISTS idx_self_reports_created_at ON self_reports (created_at DESC);

INSERT INTO schema_version (version, description)
VALUES ('092', 'self_reports table for Layer 4 desire trajectory tracking')
ON CONFLICT (version) DO NOTHING;
