-- Migration 278: KR1/KR2 verifier 改用 publish_success_daily 成功率
--
-- 背景：
--   migration 223 的 KR1/KR2 verifier 查 tasks 表计任务数（threshold=4条/天）
--   新需求：current_value = 近7日平均发布成功率（0-100%），threshold=90（≥90% 达标）
--
-- 修改内容：
--   KR1（d86f67df）: 非微信平台7日均值成功率
--   KR2（两个候选 UUID）: 微信平台7日均值成功率
--
-- 幂等：ON CONFLICT / WHERE EXISTS 保护，多次执行结果一致

BEGIN;

-- ── KR1：非微信平台发布成功率 ─────────────────────────────────────────────────
UPDATE kr_verifiers
SET query                 = $$SELECT COALESCE(ROUND(AVG(success_rate)::numeric, 2), 0) AS count
FROM publish_success_daily
WHERE date >= CURRENT_DATE - INTERVAL '6 days'
  AND platform != 'wechat'
  AND success_rate IS NOT NULL$$,
    metric_field          = 'count',
    threshold             = 90,
    check_interval_minutes = 30,
    last_checked          = NULL,
    updated_at            = NOW()
WHERE kr_id = 'd86f67df-04c8-47dc-922f-c0e4fd0645bb'::uuid;

-- ── KR2：微信平台发布成功率（migration 223 UUID）─────────────────────────────
UPDATE kr_verifiers
SET query                 = $$SELECT COALESCE(ROUND(AVG(success_rate)::numeric, 2), 0) AS count
FROM publish_success_daily
WHERE date >= CURRENT_DATE - INTERVAL '6 days'
  AND platform = 'wechat'
  AND success_rate IS NOT NULL$$,
    metric_field          = 'count',
    threshold             = 90,
    check_interval_minutes = 30,
    last_checked          = NULL,
    updated_at            = NOW()
WHERE kr_id = 'f19118cd-c4fe-478d-abf5-00bde5566a05'::uuid;

-- ── KR2 备用 UUID（PRD 中引用的版本，若存在则同步更新）─────────────────────
UPDATE kr_verifiers
SET query                 = $$SELECT COALESCE(ROUND(AVG(success_rate)::numeric, 2), 0) AS count
FROM publish_success_daily
WHERE date >= CURRENT_DATE - INTERVAL '6 days'
  AND platform = 'wechat'
  AND success_rate IS NOT NULL$$,
    metric_field          = 'count',
    threshold             = 90,
    check_interval_minutes = 30,
    last_checked          = NULL,
    updated_at            = NOW()
WHERE kr_id = 'f19118cd-3af4-4c50-b73d-a67a9218b2de'::uuid;

INSERT INTO schema_version (version, description)
VALUES ('278', 'KR1/KR2 verifier 改用 publish_success_daily 7日均值成功率，threshold=90');

COMMIT;
