-- Migration 223: KR Verifiers for 10 active KRs
--
-- 问题：kr_verifiers 的 7 条记录全部引用 status='archived' 的旧 KR
-- 原因：OKR 重构后新建了 10 个活跃 KR，但旧 verifiers 未迁移
-- 结果：runAllVerifiers() 查询 WHERE g.status IN ('active','in_progress')
--       排除了 archived KR，导致每次 tick 均 0 条 verifier 执行，进度永远 0%
--
-- 修复：为当前 10 个活跃 KR 插入对应的 kr_verifiers 条目

INSERT INTO kr_verifiers (kr_id, verifier_type, query, metric_field, threshold, check_interval_minutes, enabled)
SELECT kr_id, verifier_type, query, metric_field, threshold, check_interval_minutes, enabled
FROM (VALUES

  -- ── Cecelia OKR ───────────────────────────────────────────────────────────

  -- KR1：系统稳定 — 连续24h不崩溃，自愈成功率≥90%，MTTR<30min
  -- 指标：alertness_metrics 中 30天内 CPU level≤2（正常）的比率，目标 ≥90%
  (
    'f483b0b3-3c0d-4312-a2ae-9a5c565beede'::uuid, 'sql',
    $$SELECT ROUND(
        COUNT(*) FILTER (WHERE alertness_level::integer <= 2)::numeric
        / GREATEST(1, COUNT(*))::numeric * 100
    ) as count
    FROM alertness_metrics
    WHERE created_at > NOW() - INTERVAL '30 days'
      AND metric_type = 'cpu'$$,
    'count', 90::numeric, 60, true
  ),

  -- KR2：算力全开 — slot利用率≥70%，衡量：30天内任务完成率
  -- 指标：30天内所有任务中 completed 的比例，目标 ≥70%
  (
    'cf012d8d-e021-4159-9a99-54b8fc81bb79'::uuid, 'sql',
    $$SELECT ROUND(
        COUNT(*) FILTER (WHERE status = 'completed')::numeric
        / GREATEST(1, COUNT(*))::numeric * 100
    ) as count
    FROM tasks
    WHERE created_at > NOW() - INTERVAL '30 days'$$,
    'count', 70::numeric, 60, true
  ),

  -- KR3：管家闭环 — 每天日报≥1次，夜间≥3个task自动完成
  -- 指标：daily_logs 30天累积次数，目标 ≥30条（约每天1条）
  (
    '5a4963e0-cb03-4241-b4a9-747fbef00ac5'::uuid, 'sql',
    $$SELECT COUNT(*)::numeric as count
    FROM daily_logs
    WHERE created_at > NOW() - INTERVAL '30 days'$$,
    'count', 30::numeric, 60, true
  ),

  -- KR4：/repo-audit 72→90（达标即退役）
  -- 指标：固定基线 72分（当前分数），目标 90分
  -- 注意：需要手动运行 /repo-audit 并更新 current_value 以反映真实改进
  (
    '50a4ecdd-2d3f-4116-a9ee-b8044d344ba2'::uuid, 'sql',
    $$SELECT 72::numeric as count$$,
    'count', 90::numeric, 1440, true
  ),

  -- KR5：Engine CI 可信赖 — CI绿灯率≥95%
  -- 指标：30天内 dev 任务中 PR 已 merged 的比例，目标 ≥95%
  (
    'bca4769e-a259-4668-b9f6-284fb93c016e'::uuid, 'sql',
    $$SELECT ROUND(
        COUNT(*) FILTER (WHERE pr_status = 'merged')::numeric
        / GREATEST(1, COUNT(*))::numeric * 100
    ) as count
    FROM tasks
    WHERE task_type = 'dev'
      AND pr_url IS NOT NULL
      AND created_at > NOW() - INTERVAL '30 days'$$,
    'count', 95::numeric, 60, true
  ),

  -- ── ZenithJoy OKR ─────────────────────────────────────────────────────────

  -- KR1：AI自媒体线跑通 — 4条内容/天，多平台发布成功率≥90%
  -- 指标：7天内 content-pipeline completed 任务均值 / 7，目标 ≥4条/天
  (
    'd86f67df-04c8-47dc-922f-c0e4fd0645bb'::uuid, 'sql',
    $$SELECT ROUND(COUNT(*)::numeric / 7) as count
    FROM tasks
    WHERE task_type = 'content-pipeline'
      AND status = 'completed'
      AND completed_at > NOW() - INTERVAL '7 days'$$,
    'count', 4::numeric, 30, true
  ),

  -- KR2：AI私域线跑通 — 4条私域内容/天，微信发布成功率≥90%
  -- 指标：7天内 content_publish completed 任务均值 / 7，目标 ≥4条/天
  (
    'f19118cd-c4fe-478d-abf5-00bde5566a05'::uuid, 'sql',
    $$SELECT ROUND(COUNT(*)::numeric / 7) as count
    FROM tasks
    WHERE task_type = 'content_publish'
      AND status = 'completed'
      AND completed_at > NOW() - INTERVAL '7 days'$$,
    'count', 4::numeric, 30, true
  ),

  -- KR3：微信小程序上线 — 里程碑（尚未完成）
  -- 指标：固定 0（里程碑类型，完成后手动更新为 1）
  (
    'f9d769b1-5083-4971-a2f3-19983f32ba38'::uuid, 'sql',
    $$SELECT 0::numeric as count$$,
    'count', 1::numeric, 1440, true
  ),

  -- KR4：geo SEO网站上线 — 里程碑（尚未完成）
  -- 指标：固定 0（里程碑类型，完成后手动更新为 1）
  (
    'be775651-0041-4094-b4d7-b9d1f29fda39'::uuid, 'sql',
    $$SELECT 0::numeric as count$$,
    'count', 1::numeric, 1440, true
  ),

  -- KR5：Dashboard可交付 — 3大模块无阻断bug，可完整演示20分钟
  -- 指标：page_views 30天访问量，目标 ≥100次（可用性验证）
  (
    'd0e7ee21-5a76-4780-a719-bd6d97ad90e1'::uuid, 'sql',
    $$SELECT COUNT(*)::numeric as count
    FROM page_views
    WHERE created_at > NOW() - INTERVAL '30 days'$$,
    'count', 100::numeric, 60, true
  )

) AS t(kr_id, verifier_type, query, metric_field, threshold, check_interval_minutes, enabled)
WHERE NOT EXISTS (
  SELECT 1 FROM kr_verifiers WHERE kr_verifiers.kr_id = t.kr_id
)
AND EXISTS (
  SELECT 1 FROM key_results WHERE id = t.kr_id
);
