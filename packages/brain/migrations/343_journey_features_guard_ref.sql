-- Migration 343: journey_features 加 guard_ref（刀3-T4 裸奔 FR 守卫列）
-- 三前缀约定：script:<path> / probe:<url> / waiver:<decision_id>
-- 同时扩展 status CHECK 约束加入 'live' 态（已上线 feature）
ALTER TABLE journey_features ADD COLUMN IF NOT EXISTS guard_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_journey_features_guard_ref ON journey_features (guard_ref) WHERE guard_ref IS NOT NULL;

-- 扩展 status CHECK 约束以支持 'live' 状态
-- 先动态删除现有匿名 CHECK 约束，再重建命名约束
DO $$
DECLARE
  cons_name text;
BEGIN
  SELECT conname INTO cons_name
  FROM pg_constraint
  JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
  WHERE pg_class.relname = 'journey_features'
    AND pg_constraint.contype = 'c'
    AND pg_get_constraintdef(pg_constraint.oid) LIKE '%planned%';
  IF cons_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE journey_features DROP CONSTRAINT ' || quote_ident(cons_name);
  END IF;
END;
$$;

-- 枚举必须涵盖生产真实在用的 status（2026-07-14 生产部署实证：working 28 行 / broken 3 行，
-- 窄枚举导致 ATRewriteTable 23514 部署失败）；已 apply 窄版的库由 344 拓宽
ALTER TABLE journey_features DROP CONSTRAINT IF EXISTS journey_features_status_check;
ALTER TABLE journey_features ADD CONSTRAINT journey_features_status_check
  CHECK (status IN ('planned','building','working','done','broken','deprecated','live'));
