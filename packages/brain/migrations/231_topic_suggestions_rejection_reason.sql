-- Migration 231: Add rejection_reason to topic_suggestions
-- 为选题建议表添加拒绝原因字段，支持选题决策闭环（拒绝信号回馈）

ALTER TABLE topic_suggestions
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

COMMENT ON COLUMN topic_suggestions.rejection_reason IS
  '选题被拒绝的原因（仅 status=rejected 时有值），用于后续 LLM 选题时的避坑信号';
