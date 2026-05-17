-- Migration 225: 修复 KR3/KR4 verifier SQL — 改用 okr_projects.progress 字段
--
-- 问题：ZenithJoy KR3（微信小程序上线）和 KR4（geo SEO网站上线）的
--       kr_verifiers.query 使用 status 映射伪进度：
--       active/planning/queued → 50 分，其他 → 0 分
--       结果：1个active + 1个inactive = avg(50,0) = 25%，不反映真实开发状态
--
-- 根因：项目处于 "active"（开始规划）≠ "50% 完成"。okr_projects.progress 字段
--       才是实际进度（0-100），但旧 SQL 忽略了它。
--
-- 修复：改用 okr_projects.progress 字段的加权平均值
--   - 只计算 status NOT IN ('cancelled','dropped') 的项目
--   - 当前所有项目 progress=0 → KR3/KR4 正确显示 0%（无开发进展）
--   - 未来开发者更新 okr_projects.progress 后，KR 进度会自动同步
--
-- 同步修复：kr-verifier.js 的 $2 类型歧义 bug（本 PR 代码改动）
--   错误：UPDATE key_results SET current_value = $2, ... $2::text ...
--        → PostgreSQL 无法同时推断 $2 为 numeric 和 text
--   修复：current_value = $2::numeric, ($2::numeric)::text

-- KR3：微信小程序上线（ZenithJoy）
UPDATE kr_verifiers
SET
  query = $$SELECT ROUND(
  SUM(progress::numeric) / GREATEST(1, COUNT(*))
) as count
FROM okr_projects
WHERE kr_id = 'f9d769b1-5083-4971-a2f3-19983f32ba38'
  AND status NOT IN ('cancelled', 'dropped')$$,
  threshold = 100,
  check_interval_minutes = 60,
  updated_at = NOW()
WHERE kr_id = 'f9d769b1-5083-4971-a2f3-19983f32ba38';

-- KR4：geo SEO网站上线（ZenithJoy）
UPDATE kr_verifiers
SET
  query = $$SELECT ROUND(
  SUM(progress::numeric) / GREATEST(1, COUNT(*))
) as count
FROM okr_projects
WHERE kr_id = 'be775651-0041-4094-b4d7-b9d1f29fda39'
  AND status NOT IN ('cancelled', 'dropped')$$,
  threshold = 100,
  check_interval_minutes = 60,
  updated_at = NOW()
WHERE kr_id = 'be775651-0041-4094-b4d7-b9d1f29fda39';
