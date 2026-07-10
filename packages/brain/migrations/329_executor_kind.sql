-- Migration 329: executor_kind 列 + in_progress 部分索引
-- 按架构文档 docs/architecture/2026-07-10-executor-liveness-contract/architecture.md 实施
-- NULL = legacy/未打标，守护刀按"unknown"处理（fail-open，只告警不杀）

ALTER TABLE tasks ADD COLUMN executor_kind TEXT
  CHECK (executor_kind IS NULL OR executor_kind IN (
    'brain-local',
    'relay-container',
    'headed-session',
    'bridge',
    'external-worker'
  ));

CREATE INDEX idx_tasks_executor_kind
  ON tasks(executor_kind)
  WHERE status = 'in_progress';
