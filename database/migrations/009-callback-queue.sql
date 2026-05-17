-- Migration 009: Callback Queue 持久化表
-- KR: callback 队列持久化，支持 Brain 重启零丢失

CREATE TABLE callback_queue (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID        NOT NULL,
  checkpoint_id    TEXT,
  run_id           TEXT,
  status           TEXT        NOT NULL,
  result_json      JSONB,
  stderr_tail      TEXT,
  duration_ms      INTEGER,
  attempt          INTEGER     NOT NULL DEFAULT 1,
  exit_code        INTEGER,
  failure_class    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ DEFAULT NULL
);

-- 部分索引：高效查询未处理记录
CREATE INDEX IF NOT EXISTS idx_callback_queue_unprocessed
  ON callback_queue (created_at ASC)
  WHERE processed_at IS NULL;
