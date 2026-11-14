-- Commander执行前提交意图；DBOS拥有工作流进度，本表只防外部动作重复。
CREATE TABLE IF NOT EXISTS commander_activity_actions (
  action_id text PRIMARY KEY CHECK (action_id ~ '^[a-f0-9]{64}$'),
  run_id uuid NOT NULL,
  activity_key text NOT NULL,
  identity jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved', 'settled')),
  result jsonb,
  deadline_ms bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, activity_key),
  CHECK ((state = 'reserved' AND result IS NULL) OR (state = 'settled' AND result IS NOT NULL))
);
