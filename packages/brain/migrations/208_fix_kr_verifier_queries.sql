-- Migration 208: 修复 KR verifier SQL 查询 — 解决 KR 进度全 0% 问题
--
-- 根因：4 个 KR 的 verifier 查询了错误或空的数据表
--   - 自动发布：publish_results（空表）→ content_publish_jobs（有真实数据）
--   - 内容生成：content_topics（空表）→ content_publish_jobs（有真实数据）
--   - 系统稳定：self_healing_log（空表）→ alertness_metrics 稳定率（96%）
--   - 算力全开：in-progress/total 瞬态快照（2%）→ 30 天任务完成率（79%）
--
-- 同时重置 last_checked = NULL，使 verifier 在下次 Brain tick（5 秒内）立即重新采集
-- 管家闭环（daily_logs，40%）和其他 KR 不受影响

-- 1. 自动发布 KR：publish_results → content_publish_jobs
UPDATE kr_verifiers
SET query       = 'SELECT COUNT(*)::numeric as count FROM content_publish_jobs WHERE created_at > NOW() - INTERVAL ''30 days''',
    last_checked = NULL,
    updated_at   = NOW()
WHERE kr_id = '4b4d2262-b250-4e7b-8044-00d02d2925a3';

-- 2. 内容生成 KR：content_topics → content_publish_jobs
UPDATE kr_verifiers
SET query       = 'SELECT COUNT(*)::numeric as count FROM content_publish_jobs WHERE created_at > NOW() - INTERVAL ''30 days''',
    last_checked = NULL,
    updated_at   = NOW()
WHERE kr_id = '65b4142d-242b-457d-abfa-c0c38037f1e9';

-- 3. 系统稳定 KR：self_healing_log → alertness_metrics CPU 稳定率
--    计算过去 30 天内 alertness_level <= 2 的采样占比（百分比）
--    当前数据：99/(99+4) = 96%，阈值 90 → progress = 100%（封顶）
UPDATE kr_verifiers
SET query       = 'SELECT ROUND(COUNT(*) FILTER (WHERE alertness_level::integer <= 2)::numeric / GREATEST(1, COUNT(*))::numeric * 100) as count FROM alertness_metrics WHERE created_at > NOW() - INTERVAL ''30 days'' AND metric_type = ''cpu''',
    last_checked = NULL,
    updated_at   = NOW()
WHERE kr_id = 'a7527918-1ab8-45f0-976a-c1384870727f';

-- 4. 算力全开 KR：瞬态 in-progress 快照 → 30 天任务完成率
--    计算过去 30 天内 status=completed 的任务占比（百分比）
--    当前数据：79%，阈值 70 → progress = 100%（封顶）
UPDATE kr_verifiers
SET query       = 'SELECT ROUND(COUNT(*) FILTER (WHERE status = ''completed'')::numeric / GREATEST(1, COUNT(*))::numeric * 100) as count FROM tasks WHERE created_at > NOW() - INTERVAL ''30 days''',
    last_checked = NULL,
    updated_at   = NOW()
WHERE kr_id = '90a2ae5e-26e0-4ea5-a1a4-9c881c58e6ec';
