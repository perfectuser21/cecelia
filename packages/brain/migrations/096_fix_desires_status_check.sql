-- Migration 096: 修复 desires_status_check 约束
--
-- 问题：desires 表的 desires_status_check 约束只有 5 种状态：
--       pending/expressed/expired/suppressed/acknowledged
--       但 desire/index.js 在执行 act/follow_up 欲望后会写入 status='acted'。
--
-- 导致：PR #192 修复 desires_type_check 后，act/follow_up 欲望可正常插入，
--       但执行时 UPDATE status='acted' 报 "violates check constraint desires_status_check"。
--
-- 修复：DROP 旧约束 + ADD 新约束，加入 acted 状态。

ALTER TABLE desires DROP CONSTRAINT IF EXISTS desires_status_check;

ALTER TABLE desires ADD CONSTRAINT desires_status_check
  CHECK (status = ANY(ARRAY[
    'pending',
    'expressed',
    'expired',
    'suppressed',
    'acknowledged',
    'acted'
  ]::varchar[]));

-- 记录 schema 版本
INSERT INTO schema_version (version, description)
VALUES ('096', '修复 desires_status_check 约束：补充 acted 状态')
ON CONFLICT (version) DO NOTHING;
