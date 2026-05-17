-- Migration 205: 激活内容生成链路（Project#17）
-- 将 Project#17「每日≥5条可靠产量调度」从 planning 激活为 active，
-- 链接到内容生成 KR，并创建每日 recurring task 驱动内容生成→发布链路。
--
-- Project#17: 093ea455-b5cb-410d-8602-43c3eef57e1c（每日≥5条可靠产量调度）
-- 内容生成 KR: 65b4142d-242b-457d-abfa-c0c38037f1e9
-- 自动发布 KR: 4b4d2262-b250-4e7b-8044-00d02d2925a3

-- 1. 激活 Project#17，设置主 KR 链接和 linked_krs 元数据
UPDATE okr_projects
SET
  status    = 'active',
  kr_id     = '65b4142d-242b-457d-abfa-c0c38037f1e9',
  metadata  = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'linked_krs', jsonb_build_array(
      '65b4142d-242b-457d-abfa-c0c38037f1e9',
      '4b4d2262-b250-4e7b-8044-00d02d2925a3'
    ),
    'activated_by', 'migration_205',
    'activated_at', NOW()::text
  ),
  updated_at = NOW()
WHERE id = '093ea455-b5cb-410d-8602-43c3eef57e1c'
  AND status = 'planning';

-- 2. 创建每日内容生成 recurring task
-- cron: 0 0 * * * = UTC 00:00 = 北京时间 08:00
-- task_type: content-pipeline（由 Brain tick 的 orchestrateContentPipelines 处理）
INSERT INTO recurring_tasks (
  title,
  description,
  task_type,
  location,
  cron_expression,
  recurrence_type,
  is_active,
  priority,
  executor,
  goal_id,
  project_id
)
SELECT
  '每日内容生成 → 自动发布（AI一人公司）',
  'AI每天产出5条内容（帖子+短文），自动发布到3个以上平台。关联内容生成KR和自动发布KR。',
  'content-pipeline',
  'us',
  '0 0 * * *',
  'cron',
  true,
  'P1',
  'cecelia',
  '65b4142d-242b-457d-abfa-c0c38037f1e9',
  '093ea455-b5cb-410d-8602-43c3eef57e1c'
WHERE NOT EXISTS (
  SELECT 1 FROM recurring_tasks
  WHERE project_id = '093ea455-b5cb-410d-8602-43c3eef57e1c'
    AND task_type = 'content-pipeline'
);

-- 记录 schema 版本
INSERT INTO schema_version (version, description, applied_at)
VALUES ('205', '激活内容生成链路 — Project#17 active + 每日 recurring task', NOW())
ON CONFLICT (version) DO NOTHING;
