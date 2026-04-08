-- Migration 227: KR3/KR4 verifier SQL 改为阶梯权重公式
--
-- 根因：
--   migration 224_fix_kr34_progress_verifiers.sql（阶梯权重）因两个 224_ 文件命名冲突，
--   migration runner 只应用了第一个（fix_kr_placeholder），导致 KR3/KR4 verifier SQL
--   停留在 SUM(progress::numeric) 公式 — 但 okr_projects.progress 列无人维护，
--   始终为 0，导致 KR3/KR4 进度永远为 0%。
--
-- 修复策略：
--   使用阶梯权重公式，基于 okr_projects.status 推断进度：
--     completed = 100 分/项目（已完成）
--     active/planning/queued = 50 分/项目（已启动但未完成）
--     inactive/其他 = 0 分/项目（未启动）
--   progress = SUM(分数) / COUNT(项目)，threshold=100
--
-- 预期效果：
--   KR3: P1(active)=50 + P2(inactive)=0 → 25%（实际开发进行中）
--   KR4: P1(active)=50 + P2(inactive)=0 → 25%（实际开发进行中）
--   P1 完成后: 50+0→50%，P2 启动后: 100+50→75%，全部完成: 100%

-- ── KR3：微信小程序上线 ────────────────────────────────────────────────────

UPDATE kr_verifiers
SET
  query = $$SELECT ROUND(
  SUM(CASE
    WHEN status = 'completed' THEN 100.0
    WHEN status IN ('active', 'planning', 'queued') THEN 50.0
    ELSE 0
  END) / GREATEST(1, COUNT(*))
) as count
FROM okr_projects
WHERE kr_id = 'f9d769b1-5083-4971-a2f3-19983f32ba38'
  AND status NOT IN ('cancelled', 'dropped')$$,
  threshold             = 100,
  check_interval_minutes = 60,
  last_checked          = NULL,
  updated_at            = NOW()
WHERE kr_id = 'f9d769b1-5083-4971-a2f3-19983f32ba38';

-- ── KR4：geo SEO网站上线 ──────────────────────────────────────────────────

UPDATE kr_verifiers
SET
  query = $$SELECT ROUND(
  SUM(CASE
    WHEN status = 'completed' THEN 100.0
    WHEN status IN ('active', 'planning', 'queued') THEN 50.0
    ELSE 0
  END) / GREATEST(1, COUNT(*))
) as count
FROM okr_projects
WHERE kr_id = 'be775651-0041-4094-b4d7-b9d1f29fda39'
  AND status NOT IN ('cancelled', 'dropped')$$,
  threshold             = 100,
  check_interval_minutes = 60,
  last_checked          = NULL,
  updated_at            = NOW()
WHERE kr_id = 'be775651-0041-4094-b4d7-b9d1f29fda39';
