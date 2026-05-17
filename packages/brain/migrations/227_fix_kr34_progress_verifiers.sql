-- Migration 224: KR3/KR4 进度采集链路修复 — 阶梯权重公式 + 激活 P1 项目
--
-- 根因：
--   migration 223 安装了 `SELECT 0::numeric` 硬编码查询，后虽被改为 okr_projects 完成率公式，
--   但两个 P1 项目仍为 inactive 状态（start_date=2026-04-08），
--   公式 COUNT(completed)/COUNT(total)*100 = 0/2 = 0%，进度永远为 0%。
--
-- 修复策略：
--   1. 更新 KR3/KR4 verifier SQL — 使用阶梯权重表达中间状态：
--        completed = 100 分/项目
--        active/planning/queued = 50 分/项目（已启动但未完成）
--        inactive = 0 分/项目
--      progress = SUM(分数) / COUNT(项目)
--   2. 激活 P1 项目（start_date <= TODAY，status=inactive → active）
--   3. 重置 last_checked = NULL，使 kr-verifier 在下次 tick（60s内）立即重新采集
--
-- 预期效果（激活后）：
--   P1 active + P2 inactive → (50+0)/2 = 25%
--   P1 completed + P2 active → (100+50)/2 = 75%
--   P1+P2 completed          → (100+100)/2 = 100%

-- ── Step 1: 更新 KR3（微信小程序上线）verifier SQL ──────────────────────────

UPDATE kr_verifiers
SET
  query = $q$SELECT ROUND(
  SUM(CASE
    WHEN status = 'completed' THEN 100.0
    WHEN status IN ('active', 'planning', 'queued') THEN 50.0
    ELSE 0
  END) / GREATEST(1, COUNT(*))
) as count
FROM okr_projects
WHERE kr_id = 'f9d769b1-5083-4971-a2f3-19983f32ba38'$q$,
  threshold    = 100,
  last_checked = NULL,
  updated_at   = NOW()
WHERE kr_id = 'f9d769b1-5083-4971-a2f3-19983f32ba38';

-- ── Step 2: 更新 KR4（geo SEO网站上线）verifier SQL ─────────────────────────

UPDATE kr_verifiers
SET
  query = $q$SELECT ROUND(
  SUM(CASE
    WHEN status = 'completed' THEN 100.0
    WHEN status IN ('active', 'planning', 'queued') THEN 50.0
    ELSE 0
  END) / GREATEST(1, COUNT(*))
) as count
FROM okr_projects
WHERE kr_id = 'be775651-0041-4094-b4d7-b9d1f29fda39'$q$,
  threshold    = 100,
  last_checked = NULL,
  updated_at   = NOW()
WHERE kr_id = 'be775651-0041-4094-b4d7-b9d1f29fda39';

-- ── Step 3: 激活 P1 项目（start_date 已到期，inactive → active）────────────

UPDATE okr_projects
SET
  status     = 'active',
  updated_at = NOW()
WHERE id IN (
  'b55c5d59-c69f-4bb1-a522-5f10149d9f58',  -- [ZenithJoy KR3-P1] 小程序核心功能开发完整
  'f3daa2d1-819b-41a3-b8de-7c3fbed5f7b5'   -- [ZenithJoy KR4-P1] geo网站开发 + 部署上线
)
  AND start_date <= CURRENT_DATE
  AND status = 'inactive';
