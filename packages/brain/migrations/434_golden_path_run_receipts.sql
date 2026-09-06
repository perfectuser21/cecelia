-- 434: golden_path run 终态回执表（Crystal 件7：map↔画布对齐）
-- run 终态回写 step（golden_path 行）成熟度的幂等载体：UNIQUE(golden_path_id, run_id)
-- 让 map 变实时体检表——画布生成器读每格最近回执（last_run）。
-- verdict 封闭词表 completed|failed（对齐 kernel 终态 done/failed 的语义投影）。

CREATE TABLE IF NOT EXISTS golden_path_run_receipts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  golden_path_id UUID NOT NULL REFERENCES golden_path(id) ON DELETE CASCADE,
  run_id         TEXT NOT NULL,
  verdict        TEXT NOT NULL CHECK (verdict IN ('completed', 'failed')),
  evidence       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (golden_path_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_gp_run_receipts_latest
  ON golden_path_run_receipts (golden_path_id, created_at DESC);
