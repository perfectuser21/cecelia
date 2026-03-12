-- Migration 150: KR 进度诚实化修复
-- 背景：多个 KR goals 的 progress=100，但实际 initiative 完成率远低于 100%
-- 修复：将 progress 更正为 initiative 实际完成率，并写入 memory_stream 记录

-- 1. 计算每个 KR 的实际 initiative 完成率，更正虚标 progress
DO $$
DECLARE
  kr RECORD;
  actual_pct INTEGER;
  old_progress INTEGER;
BEGIN
  FOR kr IN
    SELECT
      g.id,
      g.title,
      g.progress AS old_progress,
      COUNT(p.id) AS total_initiatives,
      COUNT(p.id) FILTER (WHERE p.status = 'completed') AS completed_initiatives
    FROM goals g
    LEFT JOIN projects p ON p.kr_id = g.id AND p.type = 'initiative'
    WHERE g.type IN ('area_okr', 'kr')
    GROUP BY g.id, g.title, g.progress
    HAVING COUNT(p.id) > 0
      AND g.progress <> ROUND(COUNT(p.id) FILTER (WHERE p.status = 'completed') * 100.0 / COUNT(p.id))
  LOOP
    actual_pct := ROUND(kr.completed_initiatives * 100.0 / kr.total_initiatives);
    old_progress := kr.old_progress;

    -- 更正 progress
    UPDATE goals
    SET progress = actual_pct,
        updated_at = NOW()
    WHERE id = kr.id;

    -- 写入 memory_stream 记录修正事件
    INSERT INTO memory_stream (content, importance, memory_type, source_type, expires_at)
    VALUES (
      format(
        '[KR 进度修正] %s — stated_progress=%s%% → actual_progress=%s%% (initiatives: %s/%s completed)',
        kr.title,
        old_progress,
        actual_pct,
        kr.completed_initiatives,
        kr.total_initiatives
      ),
      8,
      'long',
      'audit',
      NULL
    );
  END LOOP;
END;
$$;

-- 2. 记录本次审计汇总到 memory_stream
INSERT INTO memory_stream (content, importance, memory_type, source_type, expires_at)
VALUES (
  '[KR 进度审计完成] migration 150 执行 — 已修正虚标 KR progress，以 initiative 实际完成率为准',
  9,
  'long',
  'audit',
  NULL
);

INSERT INTO schema_version (version, description)
VALUES ('150', 'KR 进度诚实化修复：基于 initiative 完成率重写 goals.progress');
