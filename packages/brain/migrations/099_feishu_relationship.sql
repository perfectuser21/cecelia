-- Migration 099: feishu_users 加 relationship 字段
-- relationship: owner / colleague / family / guest

ALTER TABLE feishu_users
  ADD COLUMN IF NOT EXISTS relationship VARCHAR(20) NOT NULL DEFAULT 'guest';

-- 已知 owner 保持 owner
UPDATE feishu_users SET relationship = 'owner' WHERE user_id = 'owner';
