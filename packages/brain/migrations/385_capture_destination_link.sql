-- Migration 385: capture 去向链 + 账龄哨兵
-- 任务：数据地基② F6步3真断言支撑
-- ① captures.done_at  ②  v_captures_aging_sentinel 视图

-- 1. done_at：capture 归位完成时间戳（写 done 时同步写）
ALTER TABLE captures ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_captures_done_at
  ON captures(done_at) WHERE done_at IS NOT NULL;

-- 2. initiative_id：capture→立项的直接外键（可选，atoms.routed_to_id 是主链路）
ALTER TABLE captures ADD COLUMN IF NOT EXISTS initiative_id UUID
  REFERENCES okr_initiatives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_captures_initiative_id
  ON captures(initiative_id) WHERE initiative_id IS NOT NULL;

-- 3. 账龄哨兵视图：≥7天未处理的 captures
CREATE OR REPLACE VIEW v_captures_aging_sentinel AS
SELECT
  id,
  content,
  source,
  status,
  created_at,
  done_at,
  EXTRACT(DAY FROM (NOW() - created_at))::INT AS age_days
FROM captures
WHERE status NOT IN ('done', 'dropped')
  AND created_at < NOW() - INTERVAL '7 days';

INSERT INTO schema_version (version, description, applied_at)
VALUES ('385', 'capture 去向链字段(done_at/initiative_id) + v_captures_aging_sentinel 账龄哨兵视图', NOW())
ON CONFLICT (version) DO NOTHING;
