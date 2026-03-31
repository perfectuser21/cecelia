-- Migration 209: 区分内容生成 vs 自动发布 KR verifier 查询
--
-- 根因：migration 208 修复了空表问题后，内容生成（65b4142d）和自动发布（4b4d2262）
--       使用了完全相同的 SQL，无法区分"AI内容产出量"和"平台发布成功数"。
--
-- 修复：
--   - 自动发布：只计 status = 'completed' 的 jobs（真实发布成功数）
--   - 内容生成：计所有非失败的 jobs（内容已产出并入队，无论是否完成发布）
--
-- 业务语义：
--   内容生成 KR "AI每天产出≥5条内容" → 内容被创建即算（status != 'failed'）
--   自动发布 KR "每天自动发到≥3个平台" → 真正发布完成才算（status = 'completed'）

-- 1. 自动发布 KR：只计已完成发布的 jobs
UPDATE kr_verifiers
SET query        = 'SELECT COUNT(*)::numeric as count FROM content_publish_jobs WHERE created_at > NOW() - INTERVAL ''30 days'' AND status = ''completed''',
    last_checked = NULL,
    updated_at   = NOW()
WHERE kr_id = '4b4d2262-b250-4e7b-8044-00d02d2925a3';

-- 2. 内容生成 KR：计所有非失败的 jobs（产出即算）
UPDATE kr_verifiers
SET query        = 'SELECT COUNT(*)::numeric as count FROM content_publish_jobs WHERE created_at > NOW() - INTERVAL ''30 days'' AND status != ''failed''',
    last_checked = NULL,
    updated_at   = NOW()
WHERE kr_id = '65b4142d-242b-457d-abfa-c0c38037f1e9';
