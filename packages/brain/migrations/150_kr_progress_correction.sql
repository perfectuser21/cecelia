-- Migration 150: KR 进度诚实化记录
-- 在 memory_stream 写入一条审计基准事件，记录 migration 时间点的 KR progress 状态
-- 实际数据修正通过 POST /api/brain/tasks/goals/audit/apply 端点触发

-- 确保 memory_stream 表存在才执行
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'memory_stream') THEN
    INSERT INTO memory_stream (content, importance, memory_type, source_type, expires_at)
    SELECT
      jsonb_build_object(
        'event', 'kr_progress_audit_baseline',
        'migration', '150',
        'recorded_at', NOW(),
        'note', 'Migration baseline: run POST /api/brain/tasks/goals/audit/apply to correct overstated KR progress',
        'overstated_krs', (
          SELECT jsonb_agg(jsonb_build_object(
            'id', g.id,
            'title', LEFT(g.title, 80),
            'stated_progress', g.progress,
            'initiative_total', COALESCE(
              (SELECT COUNT(*) FROM projects p WHERE p.kr_id = g.id AND p.type = 'initiative') +
              (SELECT COUNT(*) FROM projects p2 JOIN projects p ON p.id = p2.parent_id WHERE p.kr_id = g.id AND p2.type = 'initiative'),
              0
            ),
            'initiative_done', COALESCE(
              (SELECT COUNT(*) FROM projects p WHERE p.kr_id = g.id AND p.type = 'initiative' AND p.status = 'completed') +
              (SELECT COUNT(*) FROM projects p2 JOIN projects p ON p.id = p2.parent_id WHERE p.kr_id = g.id AND p2.type = 'initiative' AND p2.status = 'completed'),
              0
            )
          ))
          FROM goals g
          WHERE g.type IN ('area_kr', 'global_kr', 'area_okr')
            AND g.progress > 0
        )
      )::text,
      6,
      'long',
      'kr_audit',
      NOW() + INTERVAL '365 days'
    WHERE NOT EXISTS (
      SELECT 1 FROM memory_stream
      WHERE source_type = 'kr_audit'
        AND content::jsonb->>'event' = 'kr_progress_audit_baseline'
    );
  END IF;
END $$;
