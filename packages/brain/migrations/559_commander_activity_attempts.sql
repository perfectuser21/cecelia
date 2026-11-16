-- 一次 Activity 的有限返工各有独立动作账；历史身份与第一轮回执保持原样。
ALTER TABLE commander_activity_actions ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1;
ALTER TABLE commander_activity_actions DROP CONSTRAINT IF EXISTS commander_activity_actions_run_id_activity_key_key;
ALTER TABLE commander_activity_actions DROP CONSTRAINT IF EXISTS commander_activity_actions_attempt_check;
ALTER TABLE commander_activity_actions ADD CONSTRAINT commander_activity_actions_attempt_check CHECK (attempt BETWEEN 1 AND 3);
CREATE UNIQUE INDEX IF NOT EXISTS commander_activity_actions_run_activity_attempt_key
  ON commander_activity_actions (run_id, activity_key, attempt);
