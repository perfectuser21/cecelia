-- Rollback 491：还原名字 → 还原注册表 → 删列
UPDATE skill_registry r
   SET name = r.metadata->>'renamed_from', metadata = r.metadata - 'renamed_from'
 WHERE r.metadata ? 'renamed_from' AND r.name = substring(r.metadata->>'renamed_from' from 10)
   AND NOT EXISTS (SELECT 1 FROM skill_registry x WHERE x.name = r.metadata->>'renamed_from');
UPDATE notion_projection_map SET face = 'mirror', direction = 'push', vessel = 'notion-push-sync.pushSkillRegistry', updated_at = NOW()
 WHERE notion_db_id = '353c40c2-ba63-81bf-ae3e-f0e6fa3753d7' AND brain_table = 'skill_registry';
DROP INDEX IF EXISTS idx_skill_registry_presence;
ALTER TABLE skill_registry
  DROP COLUMN IF EXISTS platforms_installed, DROP COLUMN IF EXISTS presence, DROP COLUMN IF EXISTS absent_since,
  DROP COLUMN IF EXISTS last_seen_at, DROP COLUMN IF EXISTS last_scanned_at, DROP COLUMN IF EXISTS source_path,
  DROP COLUMN IF EXISTS source_kind, DROP COLUMN IF EXISTS assigned_agents, DROP COLUMN IF EXISTS content_md,
  DROP COLUMN IF EXISTS content_digest, DROP COLUMN IF EXISTS copies, DROP COLUMN IF EXISTS drift_copies,
  DROP COLUMN IF EXISTS files, DROP COLUMN IF EXISTS tier_suggested, DROP COLUMN IF EXISTS platforms_target,
  DROP COLUMN IF EXISTS openclaw_tier, DROP COLUMN IF EXISTS business_line, DROP COLUMN IF EXISTS owner,
  DROP COLUMN IF EXISTS category, DROP COLUMN IF EXISTS note, DROP COLUMN IF EXISTS notion_baseline,
  DROP COLUMN IF EXISTS notion_push_attempts, DROP COLUMN IF EXISTS notion_next_retry_at;
DELETE FROM schema_version WHERE version = '491';
