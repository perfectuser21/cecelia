-- Migration 150: KR 进度诚实化修复
-- 将虚标的 goals.progress 更正为基于 initiative 实际完成率的真实值
-- 并写入 memory_stream 记录修正事件

-- Step 1: 计算每个 KR 的真实进度并更新
WITH kr_actual AS (
  SELECT
    g.id AS kr_id,
    g.title AS kr_title,
    g.progress AS old_progress,
    COUNT(i.id) FILTER (
      WHERE i.status IN ('active', 'in_progress', 'completed', 'queued')
    ) AS initiative_count,
    COUNT(i.id) FILTER (WHERE i.status = 'completed') AS completed_count,
    CASE
      WHEN COUNT(i.id) FILTER (
        WHERE i.status IN ('active', 'in_progress', 'completed', 'queued')
      ) = 0 THEN g.progress  -- 无 initiative 时保留原值，不强制归零
      ELSE ROUND(
        COUNT(i.id) FILTER (WHERE i.status = 'completed') * 100.0 /
        COUNT(i.id) FILTER (
          WHERE i.status IN ('active', 'in_progress', 'completed', 'queued')
        )
      )
    END AS new_progress
  FROM goals g
  LEFT JOIN projects proj
    ON proj.type = 'project'
    AND proj.id IN (
      SELECT project_id FROM project_kr_links WHERE kr_id = g.id
    )
  LEFT JOIN projects i
    ON i.type = 'initiative'
    AND i.parent_id = proj.id
  WHERE g.type IN ('area_okr', 'area_kr', 'global_kr', 'key_result')
    AND g.status NOT IN ('cancelled')
  GROUP BY g.id, g.title, g.progress
),
updated AS (
  UPDATE goals
  SET progress = kr_actual.new_progress,
      updated_at = NOW()
  FROM kr_actual
  WHERE goals.id = kr_actual.kr_id
    AND kr_actual.new_progress != kr_actual.old_progress
  RETURNING goals.id, kr_actual.kr_title, kr_actual.old_progress, kr_actual.new_progress,
            kr_actual.initiative_count, kr_actual.completed_count
)
-- Step 2: 将修正事件写入 memory_stream
INSERT INTO memory_stream (content, importance, memory_type, source_type, expires_at)
SELECT
  json_build_object(
    'event', 'goals_progress_corrected',
    'kr_id', id,
    'kr_title', kr_title,
    'old_progress', old_progress,
    'new_progress', new_progress,
    'initiative_count', initiative_count,
    'completed_count', completed_count,
    'corrected_at', NOW()
  )::text,
  7,
  'long',
  'progress_audit',
  NOW() + INTERVAL '365 days'
FROM updated;
