-- Migration 012: review_environments table
-- Tracks active Dashboard static review servers allocated per initiative.

-- CREATE TABLE review_environments (see below for full DDL with IF NOT EXISTS guard)
CREATE TABLE IF NOT EXISTS review_environments (
  initiative_id TEXT PRIMARY KEY,
  port          INTEGER NOT NULL CHECK (port >= 5300 AND port <= 5399),
  pid           INTEGER NOT NULL,
  allocated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS review_environments_port_idx ON review_environments (port);
