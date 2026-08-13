-- Migration 413: work_routing_receipts — 统一工作路由收据表（来自已关闭 PR #4851）
--
-- 背景：production 在 PR #4851 的 preview 部署期间已应用此迁移（版本号 413）。
-- PR #4851 最终以 411 号入库被关闭，但 production DB 的 schema_version 已有"413"行。
-- 本文件补入 main，使代码与 production DB 状态对齐，防止 future migration 同号碰撞。
-- （migration authority gate 要求：只有已合并 main 的编号才能视为权威；此为补录。）
--
-- 创建 work_routing_receipts 表及其不可变性约束：所有工作路由决策以追加方式持久化，
-- 保证 canonical task type / pipeline / execution profile 路由痕迹不可���改。
-- 回滚脚本: migrations/rollback/413_work_routing_receipts.down.sql

CREATE TABLE IF NOT EXISTS work_routing_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL UNIQUE REFERENCES tasks(id),
  source text NOT NULL,
  source_id text NOT NULL,
  work_kind text NOT NULL,
  change_kind text,
  pipeline text NOT NULL,
  canonical_task_type text NOT NULL,
  default_execution_profile text,
  execution_profile_override text,
  repo text,
  map_scope jsonb NOT NULL DEFAULT '[]',
  impact_contract_required boolean NOT NULL DEFAULT false,
  orchestrator text NOT NULL,
  router_version text NOT NULL,
  route_reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  supersedes_receipt_id uuid REFERENCES work_routing_receipts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source, source_id, router_version)
);

CREATE OR REPLACE FUNCTION reject_work_routing_receipt_mutation()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'work_routing_receipts_append_only';
END $$;

DROP TRIGGER IF EXISTS work_routing_receipts_immutable ON work_routing_receipts;
CREATE TRIGGER work_routing_receipts_immutable
  BEFORE UPDATE OR DELETE ON work_routing_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_work_routing_receipt_mutation();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('413', 'work_routing_receipts append-only table + immutability trigger (PR #4851 production anchor)', NOW())
ON CONFLICT (version) DO NOTHING;
