-- Migration 484: 删除 D 类 7 张空表（决策 28674999 / 959d081f，任务 a39b2cde）
--
-- D 类 =「接口/代码在但从没写入过数据」的空表。主理人拍板：5 月前建、无人调用的一律删，连引用代码同 PR 删：
--   alex_pages（个人页面路由）· dev_execution_logs（未挂载的开发日志路由）· dev_reviews（开发评审路由+解析器）·
--   llm_usage_snapshots（analytics 两个快照接口）· content_topics（capture-atoms content_seed 分支，内容走 Notion 真身）·
--   tick_history（metrics 响应时间读取，从无写入方）· project_repos（executor.resolveRepoPath 首查，本就容错缺表）。
-- 不在本迁移：topic_decision_feedback（周报写入+选题读取的活回路，待主理人定）、user_annotations / life_events（看板页面，另开 PR）。
--   一、安全闸：表存在且非空 → RAISE EXCEPTION 整体回滚。
--   二、单条 DROP TABLE，不用 CASCADE（均无外键指入、无依赖视图，2026-09-29 生产核实）。

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'alex_pages',
    'dev_execution_logs',
    'dev_reviews',
    'llm_usage_snapshots',
    'content_topics',
    'tick_history',
    'project_repos'
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'migration 484: 表 % 非空（% 行），拒绝删除——请重新审计', t, n;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP TABLE IF EXISTS
  public.alex_pages,
  public.dev_execution_logs,
  public.dev_reviews,
  public.llm_usage_snapshots,
  public.content_topics,
  public.tick_history,
  public.project_repos;

INSERT INTO schema_version (version, description)
VALUES ('484', '删除 D 类 7 张空表（连引用代码同 PR 删，非空闸保护，决策 28674999/959d081f）')
ON CONFLICT (version) DO NOTHING;
