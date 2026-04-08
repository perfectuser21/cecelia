-- Migration 224: 修复 KR5 Dashboard 的 kr_verifier 错误查询
--
-- 问题：KR5 Dashboard（d0e7ee21）的 verifier 指标错误，导致 progress 永远为 0%
--
-- 根因：Migration 223 中 KR5 Dashboard 使用了无意义的访问量指标（始终为空的表）
--       threshold=100 但实际数据为 0，progress=0%
--
-- 修复：改用与该 KR 关联的 tasks 完成率作为指标
--   - 新查询：统计 goal_id 关联的 tasks 中已完成的比例
--   - 当前实际值：1/6 任务完成 = 17%（与 key_results.current_value=17 一致）
--   - threshold=100（所有任务完成 = 100% 达成）
--
-- 验证：执行后 runAllVerifiers() 会将 key_results.progress 从 0 更新为 17

UPDATE kr_verifiers
SET
  query = $$SELECT ROUND(
    COUNT(*) FILTER (WHERE status = 'completed')::numeric
    / GREATEST(1, COUNT(*))::numeric * 100
) as count
FROM tasks
WHERE goal_id = 'd0e7ee21-5a76-4780-a719-bd6d97ad90e1'$$,
  threshold    = 100,
  check_interval_minutes = 60,
  updated_at   = NOW()
WHERE kr_id = 'd0e7ee21-5a76-4780-a719-bd6d97ad90e1';
