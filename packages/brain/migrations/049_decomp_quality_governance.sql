-- Migration 049: Decomposition Quality Governance
--
-- 1. 新增 decomposition_depth 字段 → 追踪拆解深度，限制无限递归
-- 2. 清理 pending 积压 → 无子实体的 pending projects/initiatives 降为 archived
-- 3. 事件记录

-- Step 1: 新增 decomposition_depth 列
ALTER TABLE projects ADD COLUMN IF NOT EXISTS decomposition_depth INTEGER DEFAULT 0;

-- Step 2: 填充现有数据的 depth
-- project depth = 0
UPDATE projects SET decomposition_depth = 0 WHERE type = 'project' AND decomposition_depth IS NULL;

-- initiative depth = 1
UPDATE projects SET decomposition_depth = 1 WHERE type = 'initiative' AND decomposition_depth IS NULL;

-- Step 3: 清理无子实体的 pending projects（archived）
-- 保留：有 active/in_progress children 或有 in_progress tasks 的
WITH projects_to_archive AS (
  SELECT p.id, p.name
  FROM projects p
  WHERE p.type = 'project'
    AND p.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM projects child
      WHERE child.parent_id = p.id
        AND child.status IN ('active', 'in_progress')
    )
    AND NOT EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.project_id = p.id
        AND t.status IN ('queued', 'in_progress')
    )
)
UPDATE projects
SET status = 'archived',
    updated_at = NOW()
WHERE id IN (SELECT id FROM projects_to_archive);

-- Step 4: 清理无任务的 pending initiatives（archived）
-- 保留：有 queued/in_progress tasks 的
WITH initiatives_to_archive AS (
  SELECT p.id, p.name
  FROM projects p
  WHERE p.type = 'initiative'
    AND p.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.project_id = p.id
        AND t.status IN ('queued', 'in_progress')
    )
    -- 保留 parent 是 active 的
    AND NOT EXISTS (
      SELECT 1 FROM projects parent
      WHERE parent.id = p.parent_id
        AND parent.status = 'active'
    )
)
UPDATE projects
SET status = 'archived',
    updated_at = NOW()
WHERE id IN (SELECT id FROM initiatives_to_archive);

-- Step 5: 记录清理事件
INSERT INTO cecelia_events (event_type, source, payload)
VALUES ('decomp_quality_governance', 'migration_049', jsonb_build_object(
  'description', 'Decomposition quality governance: added depth tracking, archived idle pending entities',
  'timestamp', NOW()::text
));

-- Step 6: 更新 schema version
INSERT INTO schema_version (version, description) VALUES ('049', 'decomp_quality_governance')
ON CONFLICT (version) DO NOTHING;
