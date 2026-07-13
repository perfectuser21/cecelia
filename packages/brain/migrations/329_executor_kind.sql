-- Migration 329: tasks 加 executor_kind 列（执行者活性合同统一）
-- 架构文档：docs/architecture/2026-07-10-executor-liveness-contract/architecture.md
-- T1 刀1：列 + check 约束 + in_progress 部分索引

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS executor_kind TEXT
    CHECK (executor_kind IS NULL OR executor_kind IN (
      'brain-local',
      'relay-container',
      'headed-session',
      'bridge',
      'external-worker'
    ));

CREATE INDEX IF NOT EXISTS idx_tasks_executor_kind
  ON tasks (executor_kind)
  WHERE status = 'in_progress';

INSERT INTO schema_version (version, description)
VALUES ('329', 'Add executor_kind column for executor liveness contracts')
ON CONFLICT (version) DO NOTHING;
