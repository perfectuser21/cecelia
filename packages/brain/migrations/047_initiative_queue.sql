-- Migration 047: Initiative 队列管理
-- 将没有活跃任务的 active initiative 改为 pending，实现队列化管理
-- 保留最多 MAX_ACTIVE_INITIATIVES(10) 个 active initiative

-- 步骤 1: 将没有 queued/in_progress 任务的 active initiative 改为 pending
-- （有任务在跑的保持 active，避免中断运行中的工作）
UPDATE projects
SET status = 'pending',
    updated_at = NOW()
WHERE type = 'initiative'
  AND status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.project_id = projects.id
      AND t.status IN ('queued', 'in_progress')
  );

-- 步骤 2: 从 pending 中激活优先级最高的 10 个
-- 按 KR 优先级（P0 > P1 > P2）和创建时间排序
UPDATE projects
SET status = 'active',
    updated_at = NOW()
WHERE id IN (
  SELECT p.id
  FROM projects p
  LEFT JOIN goals g ON g.id = p.kr_id
  WHERE p.type = 'initiative'
    AND p.status = 'pending'
  ORDER BY
    CASE g.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
    p.created_at ASC
  LIMIT 10
);

-- 记录 schema 版本
INSERT INTO schema_version (version, description) VALUES ('047', 'initiative_queue_management')
  ON CONFLICT (version) DO NOTHING;
