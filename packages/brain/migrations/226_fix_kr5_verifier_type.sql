-- Migration 226: 修复 KR5 verifier SQL 类型推导错误
--
-- 问题: KR5（Dashboard可交付）kr_verifiers.query 使用
--   COUNT(*) FILTER (WHERE status='completed')::numeric / GREATEST(1, COUNT(*))::numeric
--   在 pg Extended Query Protocol 下触发:
--   "inconsistent types deduced for parameter $2"（GREATEST 多态返回类型无法推断）
--
-- 根因: GREATEST(1, COUNT(*)) 中 1=integer, COUNT(*)=bigint 混合类型
--   在 pg Extended Protocol 的 parse 阶段类型推断失败
--
-- 修复: 改用 AVG(CASE WHEN...) 写法，完全避免 GREATEST 和 ::numeric 强制转型
--   同步修复: migration 225 已修复 KR3/KR4，本次修复 KR5
--
-- 注意: kr-verifier.js 的 $2 类型歧义 bug 已由 migration 225 对应 PR 修复

-- KR5：Dashboard可交付（d0e7ee21-5a76-4780-a719-bd6d97ad90e1）
UPDATE kr_verifiers
SET
  query = $$SELECT COALESCE(ROUND(AVG(CASE WHEN status = 'completed' THEN 100.0 ELSE 0.0 END)), 0) AS count
FROM tasks
WHERE goal_id = 'd0e7ee21-5a76-4780-a719-bd6d97ad90e1'$$,
  last_checked = NULL,
  updated_at   = NOW()
WHERE kr_id = 'd0e7ee21-5a76-4780-a719-bd6d97ad90e1';
