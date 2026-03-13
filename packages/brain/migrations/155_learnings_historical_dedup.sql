-- Migration: Historical deduplication of unprocessed failure learnings
-- Version: 153
-- Date: 2026-03-12
-- Description: Aggregate existing duplicate failure learnings (quarantine_pattern,
--   failure_pattern) by grouping on (category, day). Keep the most recent record
--   per group and set occurrence_count = total group count. Expected to reduce
--   unprocessed learning count from ~241 to < 30.

-- Step 1: For each (category, day) group of undigested failure learnings,
--   find the representative (most recent per group) and the total count.
DO $$
DECLARE
  v_deleted INTEGER := 0;
  v_updated INTEGER := 0;
BEGIN
  -- 1a. Update occurrence_count on representative records
  WITH groups AS (
    SELECT
      MAX(id::text)::uuid          AS keep_id,
      COUNT(*)                     AS cnt,
      category,
      date_trunc('day', created_at) AS day
    FROM learnings
    WHERE digested = false
      AND category IN ('quarantine_pattern', 'failure_pattern')
    GROUP BY category, date_trunc('day', created_at)
    HAVING COUNT(*) > 1
  )
  UPDATE learnings l
  SET
    occurrence_count = GREATEST(COALESCE(l.occurrence_count, 1), g.cnt::integer),
    updated_at       = NOW()
  FROM groups g
  WHERE l.id = g.keep_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 1b. Delete non-representative duplicates
  WITH groups AS (
    SELECT
      MAX(id::text)::uuid          AS keep_id,
      category,
      date_trunc('day', created_at) AS day
    FROM learnings
    WHERE digested = false
      AND category IN ('quarantine_pattern', 'failure_pattern')
    GROUP BY category, date_trunc('day', created_at)
  )
  DELETE FROM learnings l
  WHERE l.digested = false
    AND l.category IN ('quarantine_pattern', 'failure_pattern')
    AND l.id NOT IN (SELECT keep_id FROM groups);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE '[153] Historical dedup: updated % representatives, deleted % duplicates',
    v_updated, v_deleted;
END $$;

-- Step 2: Schema version
INSERT INTO schema_version (version, description)
VALUES ('153', 'Historical dedup of failure learnings: aggregate quarantine_pattern/failure_pattern by category+day')
ON CONFLICT (version) DO NOTHING;
