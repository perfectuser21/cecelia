-- 244_langgraph_checkpoints.sql
-- Brain v2 Phase C1: LangGraph checkpoint schema SSOT
--
-- 以前靠 PostgresSaver.setup() 在 executor.js L2817 + L2863 两处散建表，非 SSOT。
-- 本 migration 统一建表，对齐 @langchain/langgraph-checkpoint-postgres v1.0.1 官方 schema。
-- PostgresSaver.setup() 仍保留（幂等 IF NOT EXISTS 不冲突），作为双重保险。

CREATE TABLE IF NOT EXISTS checkpoint_migrations (
  v INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS checkpoint_blobs (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  blob BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE IF NOT EXISTS checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  blob BYTEA NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

-- schema_version 自动由 migrate.js 记录（无需手工 INSERT）
