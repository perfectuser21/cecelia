-- packages/brain/migrations/281_add_goal_condition.sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS goal_condition TEXT;
COMMENT ON COLUMN tasks.goal_condition IS 'Claude Code --settings prompt-based stop hook condition string';
