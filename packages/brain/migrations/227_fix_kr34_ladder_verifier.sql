-- Migration 227: KR3/KR4 阶梯权重 verifier — 恢复"工作已启动"信号
--
-- 问题：
--   migration 224 (PR #2023) 试图安装阶梯公式（active=50, completed=100），
--   但 migration 224 已被 PR #2018 占用，PR #2023 的 SQL 从未执行。
--   migration 225 改用 SUM(okr_projects.progress)，但所有项目 progress=0，
--   导致 KR3/KR4 永远显示 0%，即使 P1 项目已激活在做。
--
-- 修复策略：阶梯权重
--   completed = 100 | active/planning/queued = 50 | inactive = 0
--   NULLIF(COUNT(*), 0) 替代 GREATEST(1, COUNT(*)) 避免 integer/bigint 类型混合

UPDATE kr_verifiers
SET
  query = $$SELECT COALESCE(ROUND(
  SUM(CASE
    WHEN status = 'completed' THEN 100.0
    WHEN status IN ('active', 'planning', 'queued') THEN 50.0
    ELSE 0
  END) / NULLIF(COUNT(*), 0)
), 0) AS count
FROM okr_projects
WHERE kr_id = 'f9d769b1-5083-4971-a2f3-19983f32ba38'
  AND status NOT IN ('cancelled', 'dropped')$$,
  threshold    = 100,
  last_checked = NULL,
  updated_at   = NOW()
WHERE kr_id = 'f9d769b1-5083-4971-a2f3-19983f32ba38';

UPDATE kr_verifiers
SET
  query = $$SELECT COALESCE(ROUND(
  SUM(CASE
    WHEN status = 'completed' THEN 100.0
    WHEN status IN ('active', 'planning', 'queued') THEN 50.0
    ELSE 0
  END) / NULLIF(COUNT(*), 0)
), 0) AS count
FROM okr_projects
WHERE kr_id = 'be775651-0041-4094-b4d7-b9d1f29fda39'
  AND status NOT IN ('cancelled', 'dropped')$$,
  threshold    = 100,
  last_checked = NULL,
  updated_at   = NOW()
WHERE kr_id = 'be775651-0041-4094-b4d7-b9d1f29fda39';
