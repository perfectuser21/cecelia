-- 081: 知识系统清理 — 归档重复 failure_pattern learnings
-- 这些是 Cortex RCA 自动生成的 "Task Failure: test-watchdog-kill" 重复记录

UPDATE learnings
SET digested = true, archived = true
WHERE category = 'failure_pattern'
  AND title LIKE 'Task Failure:%'
  AND digested = false;

-- schema version
INSERT INTO schema_migrations (version) VALUES ('081')
ON CONFLICT (version) DO NOTHING;
