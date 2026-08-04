-- Migration 386: capture→立项去向链 + 账龄哨兵视图
--
-- Scope:
--   1. captures 表增 dest_type / dest_id —— 捕获→立项/任务去向字段
--   2. 创建 capture_aging_sentinel 视图（开放状态 + 账龄 days）
--
-- dest_type: 'project'=okr项目 | 'initiative'=开发立项 | 'task'=任务 | 'knowledge'=知识库存档
-- dest_id: UUID，指向目标表的主键
-- 不强制 FK（目标表不同，通过 dest_type 区分）

BEGIN;

ALTER TABLE captures ADD COLUMN IF NOT EXISTS dest_type TEXT
  CONSTRAINT captures_dest_type_chk CHECK (
    dest_type IS NULL
    OR dest_type IN ('project','initiative','task','knowledge')
  );

ALTER TABLE captures ADD COLUMN IF NOT EXISTS dest_id UUID;

-- 索引：按去向反查（哪些 capture 指向某个 task/project）
CREATE INDEX IF NOT EXISTS idx_captures_dest ON captures(dest_type, dest_id)
  WHERE dest_type IS NOT NULL;

-- 账龄哨兵视图：开放中的 capture + 距今天数
CREATE OR REPLACE VIEW capture_aging_sentinel AS
SELECT
  id,
  content,
  source,
  nature,
  lane,
  status,
  dest_type,
  dest_id,
  created_at,
  EXTRACT(DAY FROM NOW() - created_at)::INTEGER AS age_days,
  CASE
    WHEN EXTRACT(DAY FROM NOW() - created_at) >= 14 THEN 'stale'
    WHEN EXTRACT(DAY FROM NOW() - created_at) >= 7  THEN 'aging'
    ELSE 'fresh'
  END AS age_bucket
FROM captures
WHERE status NOT IN ('done', 'dropped');

INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '386',
  'captures.dest_type/dest_id 去向字段 + capture_aging_sentinel 视图',
  NOW()
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
