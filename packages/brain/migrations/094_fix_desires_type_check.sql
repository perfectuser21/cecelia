-- Migration 094: 修复 desires_type_check 约束
--
-- 问题：desires 表的 CHECK 约束只有 5 种类型（inform/propose/warn/celebrate/question），
--       但代码 VALID_TYPES 有 8 种（额外的 act/follow_up/explore 均缺失）。
--
-- 导致：desire-formation 生成 act/follow_up/explore 时报
--       "violates check constraint desires_type_check"，环2好奇心闭环完全失效。
--
-- 修复：DROP 旧约束 + ADD 新约束，覆盖全部 8 种合法类型。

ALTER TABLE desires DROP CONSTRAINT IF EXISTS desires_type_check;

ALTER TABLE desires ADD CONSTRAINT desires_type_check
  CHECK (type = ANY(ARRAY[
    'inform',
    'propose',
    'warn',
    'celebrate',
    'question',
    'act',
    'follow_up',
    'explore'
  ]::varchar[]));

-- 记录 schema 版本
INSERT INTO schema_version (version, description)
VALUES ('094', '修复 desires_type_check 约束：补充 act/follow_up/explore 三种类型')
ON CONFLICT (version) DO NOTHING;
