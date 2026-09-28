-- Migration 481: 删除 A 类 37 张空表 + 5 个依赖视图（决策 28674999，任务 6227b8c1）
--
-- 2026-09-28 盘点：大脑库 262 张表中 76 张为空；A 类 37 张在 packages/brain、apps/api、scripts 中
-- 无任何 SQL 读写（逐表 git grep 核实），来源：拆库前 ZenithJoy 表、迁移改名备份、早期已删功能遗留、
-- 从未启用的登录表与网页分析表。清单与完整备份：~/db-backups/brain-empty-tables-20260928/。
-- 唯一写入方 capture-atoms 的 event 分支（写 events 不存在的列）已在同 PR 删除（决策 9ecb9628）。
--
--   一、安全闸：表存在且非空 → RAISE EXCEPTION，整个迁移回滚（审计后若有写入，拒绝删除）。
--   二、先删 5 个依赖视图，再单条 DROP TABLE 删 37 张。刻意不用 CASCADE：
--       组内外键在同一语句里一起删；若出现清单外依赖，迁移失败而不是静默连带删除。
--   三、全部 IF EXISTS：新建库（CI / cecelia_test）里部分表本就不存在（仓库历史无建表记录）。

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'acceptance_run',
    'acceptance_template',
    'check_result',
    'device_result',
    'voice_call_records',
    'conversations_legacy_pre_359',
    'incidents_legacy_pre346',
    'account',
    'session',
    'user',
    'verification',
    'analytics_aggregations',
    'events',
    'page_views',
    'user_sessions',
    'event_batches',
    'bottleneck_items',
    'bottleneck_reports',
    'bottleneck_scans',
    'watchdog_bottleneck_records',
    'brain_health_checks',
    'code_scan_results',
    'failure_events',
    'rule_violation_logs',
    'policies',
    'snapshots',
    'pattern_similarity',
    'decision_experiences',
    'learning_queue',
    'evolution_history',
    'strategies',
    'task_quality_checks',
    'publish_daily_stats',
    'review_environments',
    'trds',
    'trd_decomposition_tasks',
    'wechat_rpa_sessions'
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'migration 481: 表 % 非空（% 行），拒绝删除——请重新审计', t, n;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP VIEW IF EXISTS public.active_sessions, public.event_summary,
  public.v_evolution_effectiveness_summary, public.v_pending_evolution_evaluations, public.v_recent_rollbacks;

DROP TABLE IF EXISTS
  public."acceptance_run",
  public."acceptance_template",
  public."check_result",
  public."device_result",
  public."voice_call_records",
  public."conversations_legacy_pre_359",
  public."incidents_legacy_pre346",
  public."account",
  public."session",
  public."user",
  public."verification",
  public."analytics_aggregations",
  public."events",
  public."page_views",
  public."user_sessions",
  public."event_batches",
  public."bottleneck_items",
  public."bottleneck_reports",
  public."bottleneck_scans",
  public."watchdog_bottleneck_records",
  public."brain_health_checks",
  public."code_scan_results",
  public."failure_events",
  public."rule_violation_logs",
  public."policies",
  public."snapshots",
  public."pattern_similarity",
  public."decision_experiences",
  public."learning_queue",
  public."evolution_history",
  public."strategies",
  public."task_quality_checks",
  public."publish_daily_stats",
  public."review_environments",
  public."trds",
  public."trd_decomposition_tasks",
  public."wechat_rpa_sessions";

INSERT INTO schema_version (version, description)
VALUES ('481', '删除 A 类 37 张空表 + 5 个依赖视图（无代码读写，非空闸保护，决策 28674999）')
ON CONFLICT (version) DO NOTHING;
