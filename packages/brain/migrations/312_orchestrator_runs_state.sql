-- Migration 312: harness orchestrator 状态字段 + append-only 决策日志
-- Initiative: harness-orchestration-redesign（docs/current/harness-orchestration-redesign/architecture.md §2.2）
-- 设计: docs/superpowers/specs/2026-07-04-orchestrator-db-migration-design.md
-- 全部 additive + 幂等。双轨期（D7）：orchestrator_version 默认 'v1'（LangGraph 存量），
-- 新 orchestrator 创建的 run 写 'v2'。

-- A. initiative_runs 增列
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS round INT NOT NULL DEFAULT 0;
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS pr_url TEXT;  -- 仅 orchestrator_version='v2' 语义：一 run 一 sprint 一 PR
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS evaluate_verdict TEXT
    CHECK (evaluate_verdict IS NULL OR evaluate_verdict IN ('PASS','FAIL','FIXED'));
    -- FIXED = evaluator 历史前科值（memory: harness-evaluator-verdict-bug），语义归一由代码层做
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS judge_verdict TEXT
    CHECK (judge_verdict IS NULL OR judge_verdict IN ('PASS','FAIL'));
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS orchestrator_version TEXT NOT NULL DEFAULT 'v1'
    CHECK (orchestrator_version IN ('v1','v2'));
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS orchestrator_heartbeat_at TIMESTAMPTZ;
    -- D8 心跳；命名刻意避开 292 的 tasks.driver_heartbeat_at（另一套机制，watchdog 消费）
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS orchestrator_host TEXT;
ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS orchestrator_pid INT;
    -- host+pid 一起才可用于 watchdog 重拉判断（跨主机裸 pid 无意义）
-- 刻意不加 contract_branch：initiative_contracts.propose_branch 是唯一存储（消灭双账本）

-- B. phase CHECK 扩枚举（保留全部存量值；A_planning 是 watchdog/patrol 认可的存量合法值，
--    漏掉会让有存量行的生产库在 ADD CONSTRAINT 全表校验时直接失败）
ALTER TABLE initiative_runs DROP CONSTRAINT IF EXISTS initiative_runs_phase_check;
ALTER TABLE initiative_runs ADD CONSTRAINT initiative_runs_phase_check
  CHECK (phase IN ('A_planning','A_contract','B_task_loop','C_final_e2e',
                   'done','failed',
                   'planning','gan','generate','evaluate'));

-- C. append-only 决策日志（DoD F7）：每跳一行，可回放整条 sprint 决策链。
--    留存策略：run 完成 90 天后可由 janitor 清理（TRUNCATE/分区不受 row trigger 限制），
--    清理实现不在本 migration。
CREATE TABLE IF NOT EXISTS orchestrator_decision_log (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  hop INT NOT NULL,
  observed JSONB NOT NULL,        -- 观测快照（git分支/PR状态/DB行 摘要）
  derived_phase TEXT NOT NULL,    -- 纯函数推导出的 phase
  gate_verdict TEXT,              -- 门禁判定（如有）
  action TEXT NOT NULL,           -- 派了谁/干了什么
  detail JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_orchestrator_decision_log_run_hop UNIQUE (run_id, hop)
    -- orchestrator 崩溃重拉后重算同 hop 不双写
);

CREATE INDEX IF NOT EXISTS idx_orchestrator_decision_log_run
  ON orchestrator_decision_log(run_id);

-- append-only 硬约束：禁 UPDATE/DELETE（门禁在代码，不是注释承诺）
CREATE OR REPLACE FUNCTION orchestrator_decision_log_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'orchestrator_decision_log is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orchestrator_decision_log_append_only ON orchestrator_decision_log;
CREATE TRIGGER trg_orchestrator_decision_log_append_only
  BEFORE UPDATE OR DELETE ON orchestrator_decision_log
  FOR EACH ROW EXECUTE FUNCTION orchestrator_decision_log_append_only();
