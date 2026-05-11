-- Migration: Bind learnings to action tasks (Insight → Action 闭环)
-- Version: 271
-- Date: 2026-05-11
-- Description: Add learnings.action_task_id column to force every Cortex Insight learning
--              to point at the dev task that should turn it into code.
--              Background: 8 days / 106 preventable failures came from 5 relevance_score=9
--              cortex_insight learnings that never converted to code because
--              maybeCreateInsightTask() silently skipped insights without CODE_FIX_SIGNALS.

ALTER TABLE learnings
  ADD COLUMN IF NOT EXISTS action_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_learnings_action_task_id
  ON learnings(action_task_id)
  WHERE action_task_id IS NOT NULL;

INSERT INTO schema_version (version, description)
VALUES ('271', 'learnings.action_task_id binds Cortex Insight learnings to follow-up dev tasks')
ON CONFLICT DO NOTHING;
