-- Migration 277: KR1/KR2 current_value 基于实测成功率自动回写
--
-- 背景：
--   KR1（多平台）和 KR2（微信）的 kr_verifiers 原先统计的是"每天完成任务数/7"，
--   目标阈值 4。但 OKR 定义的达标条件是"发布成功率≥90%"，
--   与实际 publish_success_daily 快照数据脱节。
--
-- 修复：
--   将两个 KR 的 verifier SQL 改为从 publish_success_daily 计算近7日平均成功率，
--   threshold 改为 90（代表 90%），使 current_value 直接反映实测成功率（0-100）。
--
-- 数据流：
--   publish-monitor.js（每 tick）→ publish_success_daily（每平台每天一行）
--   → kr_verifiers（每小时采集）→ key_results.current_value（成功率百分比）
--
-- KR1 ID: d86f67df-04c8-47dc-922f-c0e4fd0645bb（ZenithJoy AI自媒体线，多平台）
-- KR2 ID: f19118cd-c4fe-478d-abf5-00bde5566a05（ZenithJoy AI私域线，微信）

-- ── KR1：多平台（非微信）近7日平均发布成功率 ────────────────────────────────────
-- 旧：统计 content-pipeline completed 任务数 / 7，阈值 4
-- 新：publish_success_daily 非微信平台近7日均值，阈值 90（%）
UPDATE kr_verifiers
SET query       = 'SELECT COALESCE(ROUND(AVG(success_rate)::numeric, 2), 0) AS count FROM publish_success_daily WHERE date >= CURRENT_DATE - INTERVAL ''6 days'' AND platform != ''wechat'' AND success_rate IS NOT NULL',
    threshold   = 90,
    last_checked = NULL,
    updated_at  = NOW()
WHERE kr_id = 'd86f67df-04c8-47dc-922f-c0e4fd0645bb';

-- ── KR2：微信平台近7日平均发布成功率 ────────────────────────────────────────────
-- 旧：统计 content_publish completed 任务数 / 7，阈值 4
-- 新：publish_success_daily 微信平台近7日均值，阈值 90（%）
UPDATE kr_verifiers
SET query       = 'SELECT COALESCE(ROUND(AVG(success_rate)::numeric, 2), 0) AS count FROM publish_success_daily WHERE date >= CURRENT_DATE - INTERVAL ''6 days'' AND platform = ''wechat'' AND success_rate IS NOT NULL',
    threshold   = 90,
    last_checked = NULL,
    updated_at  = NOW()
WHERE kr_id = 'f19118cd-c4fe-478d-abf5-00bde5566a05';

INSERT INTO schema_version (version, description)
VALUES ('277', 'KR1/KR2 verifier 改为 publish_success_daily 7日均值成功率');
