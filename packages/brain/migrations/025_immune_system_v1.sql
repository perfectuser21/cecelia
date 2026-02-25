-- Migration 025: Immune System v1 - Registry + State Machine + Evaluations
--
-- 实现"学得稳"可控演化系统：
-- 1. failure_signatures - 失败模式注册表（记录频次）
-- 2. absorption_policies - 免疫规则库（状态机）
-- 3. policy_evaluations - 审计记录（可追溯）
-- 4. rca_cache - 已存在，保留

-- ============================================================
-- 1. failure_signatures - 失败模式注册表
-- ============================================================
-- 记录每个错误签名的出现频次，决定何时晋升规则

CREATE TABLE IF NOT EXISTS failure_signatures (
  signature VARCHAR(16) PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  count_24h INTEGER DEFAULT 1,
  count_7d INTEGER DEFAULT 1,
  count_total INTEGER DEFAULT 1,
  latest_run_id UUID,
  latest_reason_code VARCHAR(50),
  latest_layer VARCHAR(50),
  latest_step_name VARCHAR(100)
);

CREATE INDEX idx_failure_signatures_last_seen ON failure_signatures(last_seen_at);

COMMENT ON TABLE failure_signatures IS 'Immune System: 失败模式注册表，记录错误签名出现频次';
COMMENT ON COLUMN failure_signatures.signature IS 'SHA256(reason_code:layer:step_name)的前16位';
COMMENT ON COLUMN failure_signatures.count_24h IS '最近24小时出现次数';
COMMENT ON COLUMN failure_signatures.count_7d IS '最近7天出现次数';
COMMENT ON COLUMN failure_signatures.count_total IS '总出现次数';

-- ============================================================
-- 2. absorption_policies - 免疫规则库（状态机）
-- ============================================================
-- 每条规则从 draft → probation → active → disabled/retired

CREATE TABLE IF NOT EXISTS absorption_policies (
  policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signature VARCHAR(16) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'probation', 'active', 'disabled', 'retired')),
  policy_type VARCHAR(50) NOT NULL,
  policy_json JSONB NOT NULL,
  risk_level VARCHAR(10) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  created_by VARCHAR(20) NOT NULL,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  rollback_json JSONB,
  verification_query TEXT,
  notes TEXT
);

CREATE INDEX idx_absorption_policies_signature_status ON absorption_policies(signature, status);
CREATE INDEX idx_absorption_policies_status ON absorption_policies(status);

COMMENT ON TABLE absorption_policies IS 'Immune System: 免疫规则库，存储可执行的吸收策略';
COMMENT ON COLUMN absorption_policies.status IS '规则状态: draft(草稿) → probation(观察) → active(激活) → disabled(禁用) → retired(归档)';
COMMENT ON COLUMN absorption_policies.policy_type IS '策略类型: retry/backoff/throttle/quarantine/config_tweak/selector_refresh';
COMMENT ON COLUMN absorption_policies.policy_json IS '策略参数（结构化JSON）';
COMMENT ON COLUMN absorption_policies.risk_level IS '风险等级: low(自动执行) / medium(需授权) / high(需审核)';
COMMENT ON COLUMN absorption_policies.rollback_json IS '回滚步骤（如何撤回）';
COMMENT ON COLUMN absorption_policies.verification_query IS '验证查询（判断成功）';

-- ============================================================
-- 3. policy_evaluations - 审计记录（可追溯）
-- ============================================================
-- 每次 Monitor 命中规则都写审计，用于判断晋升/禁用

CREATE TABLE IF NOT EXISTS policy_evaluations (
  evaluation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES absorption_policies(policy_id),
  run_id UUID,
  signature VARCHAR(16) NOT NULL,
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('simulate', 'enforce')),
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('applied', 'skipped', 'failed')),
  verification_result VARCHAR(20) CHECK (verification_result IN ('pass', 'fail', 'unknown')),
  latency_ms INTEGER,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_policy_evaluations_policy_id ON policy_evaluations(policy_id);
CREATE INDEX idx_policy_evaluations_created_at ON policy_evaluations(created_at);
CREATE INDEX idx_policy_evaluations_signature ON policy_evaluations(signature);

COMMENT ON TABLE policy_evaluations IS 'Immune System: 审计记录，每次规则执行都写入';
COMMENT ON COLUMN policy_evaluations.mode IS 'simulate(模拟，probation期间) / enforce(执行，active期间)';
COMMENT ON COLUMN policy_evaluations.decision IS 'applied(已应用) / skipped(跳过) / failed(失败)';
COMMENT ON COLUMN policy_evaluations.verification_result IS '验证结果: pass(成功) / fail(失败) / unknown(未知)';
COMMENT ON COLUMN policy_evaluations.details IS '执行细节（JSON）';

-- ============================================================
-- 4. Update schema_version
-- ============================================================

INSERT INTO schema_version (version, description)
VALUES ('025', 'Immune System v1 - Registry + State Machine + Evaluations')
ON CONFLICT (version) DO NOTHING;
