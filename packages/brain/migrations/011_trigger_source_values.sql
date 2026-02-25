-- Migration: Standardize trigger_source values
-- Old: 'auto' (default, meaningless)
-- New: 'brain_auto' | 'user_headed' | 'proposal'

-- Update existing tasks from 'auto' to 'brain_auto'
UPDATE tasks SET trigger_source = 'brain_auto' WHERE trigger_source = 'auto' OR trigger_source IS NULL;

-- Change default for new tasks
ALTER TABLE tasks ALTER COLUMN trigger_source SET DEFAULT 'brain_auto';
