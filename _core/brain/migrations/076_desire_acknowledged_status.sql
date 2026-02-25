-- Migration 076: desires 表添加 acknowledged 状态
--
-- 允许用户在前端点击"已了解"后标记 desire 为 acknowledged，
-- 表示用户已阅读但不需要进一步处理。

-- 1. 修改 desires.status CHECK 约束
ALTER TABLE desires DROP CONSTRAINT IF EXISTS desires_status_check;
ALTER TABLE desires ADD CONSTRAINT desires_status_check
  CHECK (status IN ('pending', 'expressed', 'expired', 'suppressed', 'acknowledged'));

-- 2. Update schema version
INSERT INTO schema_version (version, description)
VALUES ('076', 'Desire acknowledged status: 用户已了解标记')
ON CONFLICT (version) DO NOTHING;
