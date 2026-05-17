-- Migration 161: 激活学习与吸收 + 工作记忆能力孤岛
-- 修正 Scanner 误判：这两项能力实际已在运行，只是缺少 related_skills 和 key_tables 的元数据链接
-- 修复后 Scanner 能通过表数据证据正确识别为 active，而非 island

-- 幂等设计，重复执行安全

-- 1. 学习与吸收：链接实际使用中的表和 skill
UPDATE capabilities
SET
  related_skills = ARRAY['dev'],
  key_tables     = ARRAY['learnings', 'learning_queue', 'absorption_policies']
WHERE id = 'learning-absorption';

-- 2. 工作记忆：链接实际使用中的表和 skill
UPDATE capabilities
SET
  related_skills = ARRAY['cecelia-brain'],
  key_tables     = ARRAY['working_memory']
WHERE id = 'memory-working';
