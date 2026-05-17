-- Migration: Add account_id support for multi-account platforms
-- Date: 2026-01-27
-- Purpose: Distinguish between Toutiao main/minor accounts

-- ============================================================
-- 1. Add account fields to content_master
-- ============================================================

ALTER TABLE content_master
ADD COLUMN IF NOT EXISTS account_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS account_name VARCHAR(50);

COMMENT ON COLUMN content_master.account_id IS '账号标识，用于区分同一平台的不同账号（如今日头条大号/小号）';
COMMENT ON COLUMN content_master.account_name IS '账号名称，用于显示（如 "大号"、"小号"）';

-- ============================================================
-- 2. Update unique constraint to include account_id
-- ============================================================

-- Drop old constraint
ALTER TABLE content_master
DROP CONSTRAINT IF EXISTS uk_content_master;

-- Create new constraint with account_id
-- COALESCE handles NULL account_id for platforms with single account
ALTER TABLE content_master
ADD CONSTRAINT uk_content_master
UNIQUE(platform, title, publish_time, COALESCE(account_id, ''));

-- ============================================================
-- 3. Migrate existing Toutiao data to default account
-- ============================================================

UPDATE content_master
SET
  account_id = 'main',
  account_name = '大号'
WHERE platform = 'toutiao' AND account_id IS NULL;

-- ============================================================
-- 4. Create index for faster account-based queries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_content_master_platform_account
ON content_master(platform, account_id)
WHERE account_id IS NOT NULL;

-- ============================================================
-- 5. Update views to include account information
-- ============================================================

CREATE OR REPLACE VIEW v_platform_daily_summary AS
SELECT
  cm.platform,
  cm.account_name,
  DATE(NOW()) as report_date,

  -- 作品数量
  COUNT(*) FILTER (WHERE cm.tracking_status = 'active') as active_tracking,
  COUNT(*) FILTER (WHERE cm.tracking_status = 'completed') as completed_tracking,

  -- 今日快照
  COUNT(DISTINCT cs_today.id) as today_snapshots,

  -- 今日新增作品
  COUNT(*) FILTER (WHERE DATE(cm.first_seen_at) = CURRENT_DATE) as new_content_today,

  -- 即将过期（3天内）
  COUNT(*) FILTER (WHERE cm.tracking_status = 'active' AND cm.tracking_end_date <= CURRENT_DATE + INTERVAL '3 days') as expiring_soon,

  -- 今日数据汇总
  SUM(cs_today.views) as today_total_views,
  SUM(cs_today.likes) as today_total_likes,
  SUM(cs_today.views_delta) as today_views_growth,
  SUM(cs_today.likes_delta) as today_likes_growth

FROM content_master cm
LEFT JOIN content_snapshots cs_today ON
  cm.id = cs_today.content_master_id
  AND cs_today.snapshot_date = CURRENT_DATE

GROUP BY cm.platform, cm.account_name
ORDER BY cm.platform, cm.account_name;

COMMENT ON VIEW v_platform_daily_summary IS '平台每日汇总 - 展示各平台（含多账号）的跟踪状态和今日数据';

-- ============================================================
-- 6. Verification query
-- ============================================================

\echo '=== Verification: Account Distribution ==='
SELECT
  platform,
  account_id,
  account_name,
  COUNT(*) as content_count
FROM content_master
GROUP BY platform, account_id, account_name
ORDER BY platform, account_id;

\echo ''
\echo '✅ Migration completed: account_id support added'
\echo ''
\echo 'Next steps:'
\echo '1. Update platform-scraper-v8-raw.js to include account_id in metadata'
\echo '2. Update process-raw-data-v2.js to extract account_id from metadata'
\echo '3. Run scrapers for toutiao and toutiao_minor to populate data'
