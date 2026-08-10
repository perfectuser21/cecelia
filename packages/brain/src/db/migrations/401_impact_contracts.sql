-- Migration 401: harness_impact_contracts — Impact Contract 不可变版本表
-- sprint: 08110022-relay-d96c9fa0 ws2
--
-- 每个 harness 任务在开工前必须提交一份 Impact Contract，
-- 声明变更影响范围（Capability/Feature/AC）、必跑断言及 freshness 证据。
-- 合同为不可变版本记录：同 task + hash 幂等，不同 hash 则新版本叠加。

CREATE TABLE IF NOT EXISTS harness_impact_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 关联任务（级联删除）
  task_id UUID NOT NULL REFERENCES harness_tasks(id) ON DELETE CASCADE,

  -- 合同版本号（同一 task 下递增）
  version INTEGER NOT NULL DEFAULT 1,

  -- 合同状态
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'invalidated', 'superseded')),

  -- 合同 schema 版本
  schema_version INTEGER NOT NULL DEFAULT 1,

  -- 变更分档（四档枚举，与 harness_tasks.change_kind 独立存储）
  change_kind TEXT NOT NULL
    CHECK (change_kind IN ('new_capability', 'capability_change', 'bugfix', 'parameter_only')),

  -- 仓库标识（如 "perfectuser21/cecelia"）
  repo TEXT,

  -- 版本信息
  base_revision TEXT NOT NULL,
  head_revision TEXT,

  -- Mapper 生成摘要（MJ5 前允许 null）
  manifest_digest TEXT,
  projection_digest TEXT,

  -- 合同内容哈希（用于幂等去重）
  contract_hash TEXT NOT NULL,

  -- 完整合同 JSON（含 affected_capabilities / required_assertions / inapplicable_items 等）
  contract_body JSONB NOT NULL,

  -- 被哪个合同取代（链式追溯）
  supersedes_id UUID REFERENCES harness_impact_contracts(id),

  -- 时间戳
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invalidated_at TIMESTAMPTZ,

  -- 约束：同一 task 下版本号唯一
  UNIQUE (task_id, version),

  -- 约束：同一 task 下 contract_hash 唯一（幂等去重）
  UNIQUE (task_id, contract_hash)
);

-- 索引：按 task_id 快速查找
CREATE INDEX IF NOT EXISTS idx_harness_impact_contracts_task_id
  ON harness_impact_contracts (task_id);

-- 索引：按 status 过滤 active 合同
CREATE INDEX IF NOT EXISTS idx_harness_impact_contracts_status
  ON harness_impact_contracts (status);

-- 索引：按 task_id + status 组合查询当前有效合同
CREATE INDEX IF NOT EXISTS idx_harness_impact_contracts_task_active
  ON harness_impact_contracts (task_id, status)
  WHERE status = 'active';

COMMENT ON TABLE harness_impact_contracts IS
  'Impact Contract 不可变版本表。每个 harness 任务开工前提交，声明影响范围与必跑断言。';

COMMENT ON COLUMN harness_impact_contracts.contract_hash IS
  '合同内容的 SHA-256 哈希，用于幂等去重：同 (task_id, contract_hash) 不重复插入。';

COMMENT ON COLUMN harness_impact_contracts.contract_body IS
  '完整合同 JSON，包含 affected_capabilities、required_assertions、inapplicable_items、freshness_evidence 等字段。';

COMMENT ON COLUMN harness_impact_contracts.supersedes_id IS
  '本合同取代的上一版合同 ID（形成链式版本追溯）。';
