-- Migration 343: journey_features 加 guard_ref（刀3-T4 裸奔 FR 守卫列）
-- 三前缀约定：script:<path> / probe:<url> / waiver:<decision_id>
ALTER TABLE journey_features ADD COLUMN IF NOT EXISTS guard_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_journey_features_guard_ref ON journey_features (guard_ref) WHERE guard_ref IS NOT NULL;
