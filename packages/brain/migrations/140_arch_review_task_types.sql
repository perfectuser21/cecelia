-- Migration 140: 注册 arch-review 相关 task_type
-- /architect 拆分为 /architect（设计）+ /arch-review（审查）
-- 新增：architecture_scan（系统扫描）、arch_review（架构巡检）
-- initiative_verify 路由已在 task-router.js 改为 /arch-review verify

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN (
    'dev', 'review', 'talk', 'data', 'research', 'exploratory',
    'qa', 'audit', 'decomp_review', 'codex_qa',
    'code_review', 'initiative_plan', 'initiative_verify',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced',
    'architecture_design', 'architecture_scan', 'arch_review',
    'strategy_session'
  )
);

-- 新增每日架构巡检 recurring task（08:00 每天）
INSERT INTO recurring_tasks (
  title,
  task_type,
  recurrence_type,
  cron_expression,
  priority,
  is_active,
  template
) VALUES (
  '每日架构巡检 (4A Drift + 轻量 4B)',
  'arch_review',
  'cron',
  '0 8 * * *',
  'P2',
  true,
  '{"skill": "/arch-review review", "description": "每日检查架构漂移和结构健康（轻量模式）"}'
) ON CONFLICT DO NOTHING;

-- 新增每周完整架构巡检 recurring task（周一 09:00）
INSERT INTO recurring_tasks (
  title,
  task_type,
  recurrence_type,
  cron_expression,
  priority,
  is_active,
  template
) VALUES (
  '每周完整架构巡检 (4A + 完整 4B)',
  'arch_review',
  'cron',
  '0 9 * * 1',
  'P2',
  true,
  '{"skill": "/arch-review review --full", "description": "每周完整架构健康检查（含孤岛模块、God Module、热点扫描）"}'
) ON CONFLICT DO NOTHING;
