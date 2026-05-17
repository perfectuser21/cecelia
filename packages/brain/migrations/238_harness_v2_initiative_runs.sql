-- Migration 238: Harness v2 新表 initiative_runs
-- PRD: docs/design/harness-v2-prd.md §4.4
-- 用途：阶段 A/B/C 共享的 Initiative 运行态（预算/超时/阶段指针/已合并 Task 列表）
-- 注：contract_id 引用 initiative_contracts(id)（migration 236 先创建，FK 安全）

CREATE TABLE IF NOT EXISTS initiative_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID NOT NULL,
  contract_id UUID REFERENCES initiative_contracts(id),
  phase TEXT NOT NULL DEFAULT 'A_contract'
    CHECK (phase IN ('A_contract','B_task_loop','C_final_e2e','done','failed')),
  current_task_id UUID,
  merged_task_ids UUID[] DEFAULT ARRAY[]::UUID[],
  cost_usd NUMERIC(8,2) DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  deadline_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_initiative_runs_initiative ON initiative_runs(initiative_id);
CREATE INDEX IF NOT EXISTS idx_initiative_runs_phase      ON initiative_runs(phase);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('238', 'Harness v2: initiative_runs 表（阶段 A/B/C 运行态）', NOW())
ON CONFLICT (version) DO NOTHING;
