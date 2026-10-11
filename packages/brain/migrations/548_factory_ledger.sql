-- 548: 技能工厂台账（任务 1c589b13；决策 cc008b7e / 2bb08a99 / 7c6f7ae2 / 2aceef75）
--
-- 技能工厂把一条业务 workflow 从 AI 版逐步打磨到脚本版，7 阶段：
--   1 试跑 / 2 摸边界 / 3 验证 / 4 沉淀(skill→契约) / 5 上线跑(workflow+Commander) / 6 蒸馏(Step→脚本) / 7 晋级·守护
-- 阶段 = 台账状态，由推进器按规则改（推进器另立任务 a5f42455），人工可改且优先，每次改阶段都落一条只追加事件。
-- 验证口径两档：use_while_validate 边用边验（内部低风险，真实运行累计计数）/ validate_before_release 先验后上（对外不可逆）。
-- 复用：workflows（一行台账对应一条业务 workflow）、runs.run_id（证据 / 滑窗里的运行号）；
-- 生产指针仍在 activity_release_state / workflow_production_recipes，台账的 production_version / candidate_version 只是账面版本号（文本）。
-- 不改任何已有表。
BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS factory_ledger (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id         uuid NOT NULL UNIQUE REFERENCES workflows(id),
  stage               smallint NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 7),
  validation_mode     text NOT NULL DEFAULT 'use_while_validate'
                        CHECK (validation_mode IN ('use_while_validate', 'validate_before_release')),
  production_version  text,
  candidate_version   text,
  window_k            integer NOT NULL DEFAULT 10 CHECK (window_k BETWEEN 1 AND 100),
  recent_runs         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recent_runs) = 'array'),
  recent_pass         integer NOT NULL DEFAULT 0,
  recent_total        integer NOT NULL DEFAULT 0,
  total_runs          integer NOT NULL DEFAULT 0 CHECK (total_runs >= 0),
  degrade_count       integer NOT NULL DEFAULT 0 CHECK (degrade_count >= 0),
  next_action         text,
  blocked_reason      text,
  blocked_kind        text NOT NULL DEFAULT 'none' CHECK (blocked_kind IN ('none', 'human_gate', 'resource', 'safety')),
  stage_changed_at    timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT factory_ledger_recent_counts_check CHECK (recent_pass >= 0 AND recent_pass <= recent_total AND recent_total <= window_k)
);
CREATE INDEX IF NOT EXISTS idx_factory_ledger_stage ON factory_ledger (stage);
COMMENT ON TABLE factory_ledger IS '技能工厂台账：一条业务 workflow 一行（阶段 1..7 / 验证口径 / 版本 / 最近 K 次计数 / 下一步 / 卡点）。改阶段只走 POST /api/brain/factory/ledger/:id/transition（决策 cc008b7e）';
COMMENT ON COLUMN factory_ledger.stage IS '1 试跑 / 2 摸边界 / 3 验证 / 4 沉淀 / 5 上线跑 / 6 蒸馏 / 7 晋级·守护';
COMMENT ON COLUMN factory_ledger.validation_mode IS 'use_while_validate 边用边验（内部低风险）/ validate_before_release 先验后上（对外不可逆）（决策 2bb08a99）';
COMMENT ON COLUMN factory_ledger.recent_runs IS '最近 window_k 次真实运行 [{run_id, pass, degraded, at}]，recent_pass / recent_total 由它重算；改阶段默认清空';
COMMENT ON COLUMN factory_ledger.degrade_count IS '脚本 Step 失败当场降级 AI 完成的累计次数（决策 cc008b7e）';
COMMENT ON COLUMN factory_ledger.blocked_kind IS 'none / human_gate 人工关口 / resource 资源 / safety 安全红线；human_gate 与 safety 时只有 human 能改阶段';

CREATE TABLE IF NOT EXISTS factory_stage_events (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ledger_id         uuid NOT NULL REFERENCES factory_ledger(id),
  from_stage        smallint CHECK (from_stage BETWEEN 1 AND 7),
  to_stage          smallint NOT NULL CHECK (to_stage BETWEEN 1 AND 7),
  reason            text NOT NULL CHECK (length(btrim(reason)) > 0),
  evidence_run_ids  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_run_ids) = 'array'),
  actor             text NOT NULL CHECK (actor IN ('rule', 'human', 'agent')),
  actor_name        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_factory_stage_events_ledger ON factory_stage_events (ledger_id, id DESC);
COMMENT ON TABLE factory_stage_events IS '技能工厂阶段事件（只追加）：from_stage 为空 = 进厂；actor rule 推进器 / human 人工（优先）/ agent 厂长 agent';

CREATE OR REPLACE FUNCTION factory_stage_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '技能工厂阶段事件只追加：禁止 UPDATE/DELETE %', TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS factory_stage_events_append_only ON factory_stage_events;
CREATE TRIGGER factory_stage_events_append_only BEFORE UPDATE OR DELETE ON factory_stage_events
  FOR EACH ROW EXECUTE FUNCTION factory_stage_events_append_only();

INSERT INTO schema_version (version, description)
VALUES ('548', '技能工厂台账 factory_ledger + 阶段事件 factory_stage_events（只追加）')
ON CONFLICT (version) DO NOTHING;

COMMIT;
