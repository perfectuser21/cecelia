-- Migration 269: walking_skeleton_thread_lookup table for LangGraph 修正 Sprint Stream 5
-- 背景：walking-skeleton-1node graph spawn docker container 后，container 跑完 POST callback
-- 到 /api/brain/harness/callback/:containerId（Stream 1 路由），路由用 lookupHarnessThread
-- 反查 (containerId → thread_id, graph_name) 才能 Command(resume=...) 唤回正确 graph。
-- 本表是 walking-skeleton 的实证 mapping 来源，未来 Layer 3 真实 spawn 重构时复用同表 schema。
-- Spec: docs/superpowers/specs/2026-05-08-langgraph-fix-walking-skeleton.md

CREATE TABLE IF NOT EXISTS walking_skeleton_thread_lookup (
  container_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  graph_name TEXT NOT NULL DEFAULT 'walking-skeleton-1node',
  status TEXT NOT NULL DEFAULT 'spawning',  -- spawning / completed / failed
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_walking_skeleton_thread_id ON walking_skeleton_thread_lookup(thread_id);
CREATE INDEX IF NOT EXISTS idx_walking_skeleton_status ON walking_skeleton_thread_lookup(status);

COMMENT ON TABLE walking_skeleton_thread_lookup IS 'LangGraph Stream 5 walking-skeleton: containerId → thread_id mapping for callback router resume';

INSERT INTO schema_version (version, description)
VALUES ('269', 'Add walking_skeleton_thread_lookup table for LangGraph callback router resume (Stream 5)')
ON CONFLICT (version) DO NOTHING;
