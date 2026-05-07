-- Migration 268: task_events table for W4 graph_node_update streaming
-- 背景：harness initiative 走 LangGraph compiled.stream(streamMode='updates')，
-- 每个 node 完成时 emitGraphNodeUpdate 写一条 task_events 行供 LiveMonitor 消费。
-- Spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W4

CREATE TABLE IF NOT EXISTS task_events (
  id BIGSERIAL PRIMARY KEY,
  task_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_events_event_type ON task_events(event_type);
CREATE INDEX IF NOT EXISTS idx_task_events_created_at ON task_events(created_at DESC);

COMMENT ON TABLE task_events IS 'Task-scoped event stream (graph_node_update etc.) for LiveMonitor';

INSERT INTO schema_version (version, description)
VALUES ('268', 'Add task_events table for graph_node_update streaming (W4)')
ON CONFLICT (version) DO NOTHING;
