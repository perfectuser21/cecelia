-- Migration 277: KR1/KR2 verifier 改为基于 publish_success_daily 的7日发布成功率
--
-- 背景：
--   KR1（d86f67df）"AI自媒体线跑通 — 多平台发布成功率≥90%"
--   KR2（f19118cd）"AI私域线跑通 — 微信发布成功率≥90%"
--
--   原 verifier（migration 223）查的是每日发布任务数（阈值=4），
--   未反映"成功率"这一核心 KR 指标。
--   migration 276 新建了 publish_success_daily 表，每平台每天写一行。
--
-- 修复：
--   KR1: 查所有平台过去7天加权平均成功率（completed / (completed+failed) * 100）
--   KR2: 仅查 wechat 平台过去7天加权平均成功率
--   两者阈值均改为 90（对应 KR 定义"≥90%"）
--   check_interval_minutes 保持 30（每半小时更新）

BEGIN;

-- ── KR1：多平台加权7日发布成功率 ──────────────────────────────────────────────
UPDATE kr_verifiers
SET query = $$SELECT COALESCE(ROUND(
    SUM(completed)::numeric / GREATEST(SUM(completed) + SUM(failed), 1) * 100
, 2), 0) AS count
FROM publish_success_daily
WHERE date >= CURRENT_DATE - INTERVAL '7 days'$$,
    threshold            = 90,
    check_interval_minutes = 30,
    last_checked         = NULL,
    updated_at           = NOW()
WHERE kr_id = 'd86f67df-04c8-47dc-922f-c0e4fd0645bb';

-- ── KR2：微信平台加权7日发布成功率 ────────────────────────────────────────────
UPDATE kr_verifiers
SET query = $$SELECT COALESCE(ROUND(
    SUM(completed)::numeric / GREATEST(SUM(completed) + SUM(failed), 1) * 100
, 2), 0) AS count
FROM publish_success_daily
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
  AND platform = 'wechat'$$,
    threshold            = 90,
    check_interval_minutes = 30,
    last_checked         = NULL,
    updated_at           = NOW()
WHERE kr_id = 'f19118cd-c4fe-478d-abf5-00bde5566a05';

INSERT INTO schema_version (version, description)
VALUES ('277', 'KR1/KR2 verifier 改为 publish_success_daily 7日加权成功率，阈值90');

COMMIT;
