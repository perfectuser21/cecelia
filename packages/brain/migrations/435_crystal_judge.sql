-- 433: crystal_judge — 结晶判官台账/判决/报告/locator 四表（Crystal 第4件）
-- 决策 28ca1f69（技能蒸馏五步循环）落地：把纯 LLM 与固化件的运行数据结晶成台账，
-- 按三态规则出判决，生成每日结晶报告。第一批被告 = OpenClaw leadgen 八格。
-- NFR 数据完整性：判官只写 crystal_* 表，对 n8n/采集器/postcondition 源只读。
-- 与第81批 sequencer_ledger 语义不同（harness 阶段裁定）→ 另建 crystal_* 表，不复用。

-- 结晶台账：每格/每日六项指标聚合（幂等键 report_date+grid_key，同日重跑 upsert 刷新 created_at）
CREATE TABLE IF NOT EXISTS crystal_ledger (
  id BIGSERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  grid_key TEXT NOT NULL,
  n_runs INTEGER NOT NULL DEFAULT 0,
  success_rate NUMERIC,            -- 可空：数据缺口时 null（不误判为 0）
  token_cost NUMERIC NOT NULL DEFAULT 0,
  latency_ms NUMERIC,              -- 可空：数据缺口时 null
  new_branch_rate NUMERIC NOT NULL DEFAULT 0,
  broken_count INTEGER NOT NULL DEFAULT 0,
  data_gap BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crystal_ledger_date_grid_uniq UNIQUE (report_date, grid_key)
);
CREATE INDEX IF NOT EXISTS idx_crystal_ledger_created ON crystal_ledger (created_at);

-- 三态判决：每格有且仅有 1 条（UNIQUE(report_date,grid_key) 防重复判决），带触发依据 basis
CREATE TABLE IF NOT EXISTS crystal_verdict (
  id BIGSERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  grid_key TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('keep_llm', 'promote', 'demote')),
  basis JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crystal_verdict_date_grid_uniq UNIQUE (report_date, grid_key)
);
CREATE INDEX IF NOT EXISTS idx_crystal_verdict_created ON crystal_verdict (created_at);

-- 每日结晶报告：按 report_date 分日，落全量建议清单（八格 verdict+basis+六项指标）
CREATE TABLE IF NOT EXISTS crystal_report (
  id BIGSERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  grid_count INTEGER NOT NULL DEFAULT 0,
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crystal_report_date_uniq UNIQUE (report_date)
);
CREATE INDEX IF NOT EXISTS idx_crystal_report_created ON crystal_report (created_at);

-- 定位 registry 回写：复合键 model|app_version|density（决策 28ca1f69 registry是数据）
-- schema 走 CI、值由运行时探针守护、可覆盖更新（updated_at 刷新）
CREATE TABLE IF NOT EXISTS crystal_locator_registry (
  id BIGSERIAL PRIMARY KEY,
  model TEXT NOT NULL,
  app_version TEXT NOT NULL,
  density TEXT NOT NULL,
  locator JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crystal_locator_key_uniq UNIQUE (model, app_version, density)
);
CREATE INDEX IF NOT EXISTS idx_crystal_locator_updated ON crystal_locator_registry (updated_at);
