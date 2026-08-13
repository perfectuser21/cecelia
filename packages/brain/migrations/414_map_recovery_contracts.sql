-- Migration 414: map_recovery_contracts — 地图恢复授权合同表（来自已关闭 PR #4851）
--
-- 背景：与 migration 413 同批，production DB 的 schema_version 已有"414"行。
-- map_recovery_contracts 记录在地图不可用时授权 fallback 路由的合同证据，
-- 与 work_routing_receipts（413）形成双向引用，共同构成统一工作路由的可审计轨迹。
-- 回滚脚本: migrations/rollback/414_map_recovery_contracts.down.sql

CREATE TABLE IF NOT EXISTS map_recovery_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES work_routing_receipts(id),
  task_id uuid NOT NULL REFERENCES tasks(id),
  repo text NOT NULL,
  branch text NOT NULL,
  base_sha text NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN (
    'map_unavailable',
    'scanner_unavailable',
    'projection_unavailable'
  )),
  expires_at timestamptz NOT NULL,
  authorization_evidence jsonb NOT NULL,
  attempt_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_version (version, description, applied_at)
VALUES ('414', 'map_recovery_contracts table — fallback routing authorization evidence (PR #4851 production anchor)', NOW())
ON CONFLICT (version) DO NOTHING;
