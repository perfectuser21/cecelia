-- 432: sequencer_ledger — 回家序列器的监工裁定台账（第 81 批）
-- 双职责：①审计（每格裁定+疑点可查）②监工会话丢失时的重建源（降级二级）。
-- 记录 = 蒸馏收口摘要 + 监工裁定 + 分析原文；工人原文永不入此表（喂食纪律）。
CREATE TABLE IF NOT EXISTS sequencer_ledger (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  stage_attempt INTEGER NOT NULL DEFAULT 1,
  verdict TEXT NOT NULL,
  reasoning TEXT NOT NULL DEFAULT '',
  digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sequencer_ledger_run
  ON sequencer_ledger (run_id, created_at);
