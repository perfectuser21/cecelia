-- Migration 485: 删除 D 类最后 2 张空表（决策 28674999，任务见 changes 碎片）
--
-- user_annotations：4 个知识页（日记/决策登记/设计库/开发日志）的批注框从未被用过，页面批注框与 /api/brain/user-annotations 路由同 PR 删。
-- life_events：看板服务端 /api/life-events 路由无任何前端调用，路由同 PR 删。
-- 非空闸：表存在且非空即 RAISE 整体回滚；不用 CASCADE（均无外键指入、无依赖视图，2026-09-29 生产核实）。

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_annotations', 'life_events'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'migration 485: 表 % 非空（% 行），拒绝删除——请重新审计', t, n;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP TABLE IF EXISTS public.user_annotations, public.life_events;

INSERT INTO schema_version (version, description)
VALUES ('485', '删除 D 类最后 2 张空表 user_annotations / life_events（连看板代码同 PR 删，决策 28674999）')
ON CONFLICT (version) DO NOTHING;
