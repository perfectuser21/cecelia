-- Migration 048: Capacity-Aware Decomposition 数据清理
--
-- 背景：
--   秋米拆解器无容量约束，创建了 238 active projects 和 30+ active initiatives。
--   根据 capacity 公式（SLOTS=9），各层上限为：
--     Project: max = ceil(9/2) = 5
--     Initiative: max = 9
--
-- 策略：
--   1. 保留有 in_progress tasks 的 projects/initiatives（正在做的不动）
--   2. 保留 user_pinned 的（用户手动标记的不动）
--   3. 其余按 KR 优先级排序，超出 cap 的降为 pending
--   4. initiatives 超出 cap 的也降为 pending

-- Step 1: 将超出容量的 active projects 降为 pending
-- 保留: 有 in_progress initiative 的 project + 按 KR 优先级排前 5 个
WITH ranked_projects AS (
  SELECT
    p.id,
    p.name,
    g.priority,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE g.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
        p.updated_at DESC
    ) AS rn,
    EXISTS (
      SELECT 1 FROM projects child
      WHERE child.parent_id = p.id
        AND child.type = 'initiative'
        AND child.status IN ('active', 'in_progress')
        AND EXISTS (
          SELECT 1 FROM tasks t WHERE t.project_id = child.id AND t.status = 'in_progress'
        )
    ) AS has_active_work
  FROM projects p
  LEFT JOIN project_kr_links pkl ON pkl.project_id = p.id
  LEFT JOIN goals g ON g.id = pkl.kr_id
  WHERE p.type = 'project'
    AND p.status = 'active'
)
UPDATE projects
SET status = 'pending',
    updated_at = NOW()
WHERE id IN (
  SELECT id FROM ranked_projects
  WHERE rn > 5
    AND has_active_work = false
    AND COALESCE(metadata->>'user_pinned', 'false') != 'true'
);

-- Step 2: 将超出容量的 active initiatives 降为 pending
-- 保留: 有 in_progress tasks 的 + 按 KR 优先级排前 9 个
WITH ranked_initiatives AS (
  SELECT
    p.id,
    p.name,
    g.priority,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE g.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
        p.updated_at DESC
    ) AS rn,
    EXISTS (
      SELECT 1 FROM tasks t WHERE t.project_id = p.id AND t.status = 'in_progress'
    ) AS has_active_tasks
  FROM projects p
  LEFT JOIN project_kr_links pkl ON pkl.project_id = p.parent_id
  LEFT JOIN goals g ON g.id = pkl.kr_id
  WHERE p.type = 'initiative'
    AND p.status = 'active'
)
UPDATE projects
SET status = 'pending',
    updated_at = NOW()
WHERE id IN (
  SELECT id FROM ranked_initiatives
  WHERE rn > 9
    AND has_active_tasks = false
);

-- Step 3: 记录清理事件
INSERT INTO cecelia_events (event_type, source, payload)
VALUES ('capacity_cleanup', 'migration_048', jsonb_build_object(
  'description', 'Capacity-aware decomposition: cleaned up excess active projects/initiatives',
  'timestamp', NOW()::text
));

-- Step 4: 更新 schema version
INSERT INTO schema_version (version, description) VALUES ('048', 'capacity_aware_decomposition_cleanup')
ON CONFLICT (version) DO NOTHING;
