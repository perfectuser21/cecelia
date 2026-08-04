-- Migration 385: capture→立项去向链 + 账龄哨兵
--
-- 目的：
--   1. captures 表增加 destination_type / destination_id 双向链字段
--   2. 建立 capture_aging_sentinel 只读视图（账龄哨兵）
--      - 超过 7 天未处理（status NOT IN ('done','dropped')）触发告警
--
-- F6 步骤3「去向可查账龄不烂」的 DB 基础。

BEGIN;

-- 1. 增加去向字段
ALTER TABLE captures
  ADD COLUMN IF NOT EXISTS destination_type VARCHAR(30),
  ADD COLUMN IF NOT EXISTS destination_id   UUID;

-- destination_type CHECK（NULL 表示尚未归位，not-applicable 表示无需归位）
ALTER TABLE captures DROP CONSTRAINT IF EXISTS captures_destination_type_chk;
ALTER TABLE captures ADD CONSTRAINT captures_destination_type_chk
  CHECK (
    destination_type IS NULL
    OR destination_type IN ('initiative', 'project', 'task', 'dropped', 'na')
  );

COMMENT ON COLUMN captures.destination_type IS
  '去向类型: initiative|project|task|dropped|na（na=无需归位），NULL=尚未归位';
COMMENT ON COLUMN captures.destination_id IS
  '去向记录 UUID，与 destination_type 配合指向对应表行';

-- 2. 账龄哨兵视图：所有超过 7 天仍未归位的 captures
CREATE OR REPLACE VIEW capture_aging_sentinel AS
SELECT
  id,
  content,
  source,
  status,
  destination_type,
  destination_id,
  created_at,
  now() - created_at AS age,
  EXTRACT(EPOCH FROM (now() - created_at)) / 86400 AS age_days,
  CASE
    WHEN EXTRACT(EPOCH FROM (now() - created_at)) / 86400 >= 30 THEN 'critical'
    WHEN EXTRACT(EPOCH FROM (now() - created_at)) / 86400 >= 14 THEN 'warning'
    ELSE 'watch'
  END AS severity
FROM captures
WHERE
  status NOT IN ('done', 'dropped')
  AND destination_type IS NULL
  AND created_at < now() - INTERVAL '7 days'
ORDER BY created_at ASC;

COMMENT ON VIEW capture_aging_sentinel IS
  'F6步骤3账龄哨兵：超过7天未归位的 captures，按账龄升序，severity分三档';

-- 3. 索引：快速查询未归位 captures
CREATE INDEX IF NOT EXISTS idx_captures_destination_type
  ON captures (destination_type)
  WHERE destination_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_captures_destination_id
  ON captures (destination_id)
  WHERE destination_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_captures_aging_sentinel
  ON captures (created_at)
  WHERE status NOT IN ('done','dropped') AND destination_type IS NULL;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('385', 'capture destination_type/destination_id + capture_aging_sentinel view', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
