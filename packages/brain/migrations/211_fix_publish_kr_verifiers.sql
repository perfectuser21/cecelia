-- Migration 211: 修复内容发布链路 KR verifier + 重新入队今日取消的发布任务
--
-- 根因：
--   1. content_publish_jobs 是旧架构空表（仅2条 2026-03-19 running 记录）
--      新架构用 tasks 表 task_type='content_publish' 存储发布任务
--   2. KR verifier 查 content_publish_jobs → 永远返回 2 → progress ≈ 1%
--   3. escalation.cancelPendingTasks 排除了 'content-publish'（连字符）但
--      实际 task_type 是 'content_publish'（下划线）→ escalation 时发布任务全被取消
--      （代码修复在 alertness/escalation.js，本 migration 修复数据层）
--
-- 修复内容：
--   1. 内容生成 KR: 改查今日已完成的 content-pipeline 任务数，阈值 5（每日目标）
--   2. 自动发布 KR: 改查今日已完成的 content_publish 任务数，阈值 24（3平台×8内容）
--   3. 重新入队今日被 escalation 取消的 content_publish 任务

-- ── 1. 内容生成 KR verifier ────────────────────────────────────────────────────
-- 旧: 查 content_publish_jobs（空表）→ count=2 → progress=1%
-- 新: 查今日完成的 content-pipeline 任务数，阈值=5（每天≥5条内容目标）
UPDATE kr_verifiers
SET query       = 'SELECT COUNT(*)::numeric as count FROM tasks WHERE task_type = ''content-pipeline'' AND status = ''completed'' AND DATE(completed_at) = CURRENT_DATE',
    threshold   = 5,
    last_checked = NULL,
    updated_at  = NOW()
WHERE kr_id = '65b4142d-242b-457d-abfa-c0c38037f1e9';

-- ── 2. 自动发布 KR verifier ────────────────────────────────────────────────────
-- 旧: 查 content_publish_jobs（空表）→ count=2 → progress=1%
-- 新: 查今日完成的 content_publish 任务数，阈值=24（3平台×8条内容=每日目标）
-- 注意: completed_at 是 timestamp without time zone（服务器本地时间 America/Chicago）
UPDATE kr_verifiers
SET query       = 'SELECT COUNT(*)::numeric as count FROM tasks WHERE task_type = ''content_publish'' AND status = ''completed'' AND DATE(completed_at) = CURRENT_DATE',
    threshold   = 24,
    last_checked = NULL,
    updated_at  = NOW()
WHERE kr_id = '4b4d2262-b250-4e7b-8044-00d02d2925a3';

-- ── 3. 重新入队今日被 escalation 错误取消的 content_publish 任务 ──────────────
-- 仅针对今日创建、被取消（无 error_message）的任务，每个 (title, goal_id) 只保留最新版本
-- 注意: created_at 是 timestamp without time zone（服务器本地时间），用 DATE(created_at) 匹配
-- 注意: idx_tasks_dedup_active 约束要求 queued/in_progress 状态下 (title,goal_id,project_id) 唯一
--       → 必须用 DISTINCT ON 只取每个 title 的最新记录，避免多条同名任务都改成 queued 引发冲突
WITH latest_canceled AS (
  SELECT DISTINCT ON (title, COALESCE(goal_id, '00000000-0000-0000-0000-000000000000'::uuid))
    id
  FROM tasks
  WHERE task_type = 'content_publish'
    AND status = 'canceled'
    AND error_message IS NULL
    AND DATE(created_at) = CURRENT_DATE
  ORDER BY title, COALESCE(goal_id, '00000000-0000-0000-0000-000000000000'::uuid), created_at DESC
)
UPDATE tasks
SET status     = 'queued',
    updated_at = NOW()
FROM latest_canceled
WHERE tasks.id = latest_canceled.id;
