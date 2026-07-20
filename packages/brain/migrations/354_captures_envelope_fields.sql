-- migration 354: captures 信封字段扩展 + 状态语义迁移
ALTER TABLE captures ADD COLUMN IF NOT EXISTS nature VARCHAR(50);
ALTER TABLE captures ADD COLUMN IF NOT EXISTS repo VARCHAR(100);
ALTER TABLE captures ADD COLUMN IF NOT EXISTS lane VARCHAR(100);
ALTER TABLE captures ADD COLUMN IF NOT EXISTS ref_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS ref_journey_id UUID REFERENCES journeys(id) ON DELETE SET NULL;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS ref_pr_url TEXT;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(255) UNIQUE;

-- 状态语义迁移：旧状态 → 新状态
ALTER TABLE captures ALTER COLUMN status SET DEFAULT 'captured';
UPDATE captures SET status = 'captured' WHERE status = 'inbox';
UPDATE captures SET status = 'clarified' WHERE status = 'processing';
UPDATE captures SET status = 'dropped' WHERE status = 'archived';

-- 删除旧 check 约束（如有）
ALTER TABLE captures DROP CONSTRAINT IF EXISTS captures_status_check;
-- 加新 check 约束
ALTER TABLE captures ADD CONSTRAINT captures_status_check
  CHECK (status IN ('captured','clarified','done','dropped'));
