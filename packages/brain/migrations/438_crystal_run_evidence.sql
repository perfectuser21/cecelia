-- 438: crystal_run_evidence — 判官口粮通道（Crystal 判官接数据源）
--
-- 件4 交付时把数据源接入明确划在范围外（crystal-judge.js 注释：「本 sprint 无本地真目标
-- 可读 → 该格数据缺口(PRD 边界③/接缝 3)」），aggregateGridMetrics 是硬编码返回空值的桩。
-- 结果：判官每天在跑，crystal_ledger 8 行全部 n_runs=0/data_gap=true，
-- crystal_verdict 全是 keep_llm{"rule":"data_gap"}；而真实证据躺在
-- xian-m4 ~/phone-pub/verify-*.json 无人搬运。本迁移建的就是那根缺失的管子。
--
-- 判决粒度（决策 28ca1f69 第④条「蒸馏是分段的不是整条的」）：
-- 判决单位是「段(sequence)」不是漏斗格。crystal_ledger.grid_key 语义就地扩展为
-- 「判决单位键」——历史 og1..og8 行原样有效，新行存段名（如 search_account）。
-- 不改主键、不改列名：三张表的读写路径与件4 冻结测试全部保持兼容。
-- 漏斗归属降为标签，新增 funnel_cell 列承载（对齐件2 LEADGEN_CELLS，可空）。

-- 运行证据：一次 N 连跑校验产出一行（对齐 crystal-verify.mjs 的 verify-*.json）
CREATE TABLE IF NOT EXISTS crystal_run_evidence (
  id BIGSERIAL PRIMARY KEY,
  unit_key TEXT NOT NULL,                  -- 判决单位=段名，如 search_account
  funnel_cell TEXT,                        -- 漏斗归属标签（件2 LEADGEN_CELLS 之一），可空
  report_date DATE NOT NULL,               -- 归属报告日（北京时区，与 ledger 对齐）
  runs INTEGER NOT NULL DEFAULT 0,
  passes INTEGER NOT NULL DEFAULT 0,
  -- token 两条腿分开记：判决引擎的 cost_benefit = n_runs × token_cost 衡量「不固化要烧多少」，
  -- 必须取 baseline；只记热路径会把收益算小一个数量级，永远达不到固化基线。
  baseline_tokens NUMERIC,                 -- 不固化则需消耗的 LLM token（判官取这条）
  hot_path_tokens NUMERIC,                 -- 固化后实测 token（存档对照，不参与判决）
  avg_ms NUMERIC,
  device TEXT,                             -- model|app_version|density
  crystallized BOOLEAN NOT NULL DEFAULT FALSE,
  pure_hot_path BOOLEAN NOT NULL DEFAULT FALSE,
  has_postcondition BOOLEAN NOT NULL DEFAULT FALSE,  -- INV-2 探针强制，无探针不许晋升
  new_branch_count INTEGER NOT NULL DEFAULT 0,
  broken_count INTEGER NOT NULL DEFAULT 0,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 原样留存证据 JSON，便于回溯与重算
  verified_at TIMESTAMPTZ NOT NULL,        -- 证据自带时间戳（件4 evidence 规范 trial+timestamp）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 幂等：同一段同一次校验重复上报不产生重复行（verify-*.json 可能被多次搬运）
  CONSTRAINT crystal_run_evidence_unit_verified_uniq UNIQUE (unit_key, verified_at)
);
CREATE INDEX IF NOT EXISTS idx_crystal_run_evidence_unit_date
  ON crystal_run_evidence (unit_key, report_date);
CREATE INDEX IF NOT EXISTS idx_crystal_run_evidence_created
  ON crystal_run_evidence (created_at);

-- 漏斗归属标签（判决粒度是段，漏斗格降级为标签）
ALTER TABLE crystal_ledger  ADD COLUMN IF NOT EXISTS funnel_cell TEXT;
ALTER TABLE crystal_verdict ADD COLUMN IF NOT EXISTS funnel_cell TEXT;
