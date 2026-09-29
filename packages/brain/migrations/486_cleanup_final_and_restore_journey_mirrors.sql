-- Migration 486: 空表清理收尾 + AI Journey / AI Feature 恢复推送（主理人 2026-09-28/29）
--
-- 一、D 类「接口都在、从没人调用」剩余 2 张连代码删（决策 28674999，主理人原话「这些全删」）：
--     topic_decision_feedback（周报写 / 选题读，内容流水线无数据从未写入）、
--     publish_success_daily（发布监控每日快照 + KR1/KR2 回写 + /publish/success-rate，写入方从未跑起来）。
-- 二、ZenithJoy 授权 4 张大脑侧空副本连路由删（「应归 ZenithJoy 库」，真账在 hk zenithjoy：licenses 206 / license_machines 69）：
--     licenses、license_machines、license_credit_transactions、keyword_tasks；路由 license / agent-credit / acquisition 无任何调用方。
-- 三、AI Journey / AI Feature 两镜子库 09-27 已从回收站恢复，主理人 09-28「可以恢复」（决策 7a4a41a9 覆盖 24a37029）：
--     两登记行恢复 push/active，血管 pushJourneys / pushJourneyFeatures 按注册表判推。
-- 非空闸：6 表存在且非空即 RAISE 整体回滚；不用 CASCADE（外键只在组内：3 表指向 licenses）。

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'topic_decision_feedback',
    'publish_success_daily',
    'licenses',
    'license_machines',
    'license_credit_transactions',
    'keyword_tasks'
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'migration 486: 表 % 非空（% 行），拒绝删除——请重新审计', t, n;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP TABLE IF EXISTS
  public.topic_decision_feedback,
  public.publish_success_daily,
  public.licenses,
  public.license_machines,
  public.license_credit_transactions,
  public.keyword_tasks;

UPDATE notion_projection_map
   SET status = 'active', direction = 'push',
       vessel = 'notion-push-sync.pushJourneys',
       notes = '恢复推送（迁移 486）：库 09-27 已从回收站恢复，主理人 09-28 拍板恢复（决策 7a4a41a9 覆盖 24a37029）。',
       updated_at = NOW()
 WHERE notion_db_id = '358c40c2-ba63-8148-bde7-e313d789931a' AND brain_table = 'journeys';
UPDATE notion_projection_map
   SET status = 'active', direction = 'push',
       vessel = 'notion-push-sync.pushJourneyFeatures',
       notes = '恢复推送（迁移 486）：库 09-27 已从回收站恢复，主理人 09-28 拍板恢复（决策 7a4a41a9 覆盖 24a37029）。',
       updated_at = NOW()
 WHERE notion_db_id = '358c40c2-ba63-81e3-96c5-d762b3d34dff' AND brain_table = 'journey_features';

INSERT INTO schema_version (version, description)
VALUES ('486', '空表清理收尾（6 张连代码删）+ AI Journey/AI Feature 恢复推送')
ON CONFLICT (version) DO NOTHING;
