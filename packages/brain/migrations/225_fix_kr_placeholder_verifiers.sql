-- Migration 224: 修复 KR3/KR4 占位 SQL verifier
--
-- 问题：ZenithJoy KR3（微信小程序上线）和 KR4（geo SEO网站上线）的
--       kr_verifiers.query 是硬编码占位符 "SELECT 0::numeric as count"
--       导致进度永远停留在 0%，即使功能完成后也不会自动更新
--
-- 根因：migration 223 设置这两个 KR 为"里程碑"类型并注释"完成后手动更新"
--       但没有提供可以自动追踪的 SQL，形成采集链路断链
--
-- 修复：将 verifier SQL 改为基于 okr_projects 完成率的 proxy 查询
--   - 当 KR 下所有 projects 完成 → 返回 100 → 进度 100%
--   - threshold 从 1 → 100（与 0-100 范围对齐）
--   - check_interval_minutes 从 1440（24h）→ 60（1h），更及时反映进度
--
-- 注意：当前两个 KR 下的 okr_projects 均为 inactive 状态（工作未开始）
--       所以修复后进度仍然为 0%，这是正确的业务状态

-- KR3：微信小程序上线（f9d769b1-5083-4971-a2f3-19983f32ba38）
UPDATE kr_verifiers
SET
  query = $$SELECT ROUND(
  COUNT(*) FILTER (WHERE status = 'completed')::numeric
  / GREATEST(1, COUNT(*))::numeric * 100
) as count
FROM okr_projects
WHERE kr_id = 'f9d769b1-5083-4971-a2f3-19983f32ba38'$$,
  threshold = 100,
  check_interval_minutes = 60,
  updated_at = NOW()
WHERE kr_id = 'f9d769b1-5083-4971-a2f3-19983f32ba38'
  AND query = 'SELECT 0::numeric as count';

-- KR4：geo SEO网站上线（be775651-0041-4094-b4d7-b9d1f29fda39）
UPDATE kr_verifiers
SET
  query = $$SELECT ROUND(
  COUNT(*) FILTER (WHERE status = 'completed')::numeric
  / GREATEST(1, COUNT(*))::numeric * 100
) as count
FROM okr_projects
WHERE kr_id = 'be775651-0041-4094-b4d7-b9d1f29fda39'$$,
  threshold = 100,
  check_interval_minutes = 60,
  updated_at = NOW()
WHERE kr_id = 'be775651-0041-4094-b4d7-b9d1f29fda39'
  AND query = 'SELECT 0::numeric as count';
