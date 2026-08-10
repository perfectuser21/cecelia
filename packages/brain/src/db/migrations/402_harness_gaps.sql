-- Migration 402: harness_gap_ledger — Gap 生命周期台账
-- sprint: 08110022-relay-d96c9fa0 ws5
--
-- 记录开发过程中发现的缺口（未声明影响）的生命周期：
--   open → assigned → fixing → verifying → resolved
--   verifying → reopened → assigned（验证失败回滚）
--
-- 三张表：
--   harness_gaps       — Gap 主记录（状态机头节点）
--   gap_events         — Gap 状态变更事件链（可观测性）
--   task_dependencies  — 原任务被 gap 硬阻塞的依赖关系

-- ---------- 主表 ----------

CREATE TABLE IF NOT EXISTS harness_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 被阻塞的原任务
  source_task_id UUID NOT NULL,

  -- 修复这个 gap 的任务（assigned 之后赋值）
  repair_task_id UUID,

  -- 未声明的影响节点（对应 affected_capabilities 中的 capability_id 或节点标识）
  impact_node_id TEXT NOT NULL,

  -- 责任方
  owner TEXT,

  -- 严重程度：critical / high / medium / low
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('critical', 'high', 'medium', 'low')),

  -- 状态机
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'assigned', 'fixing', 'verifying', 'resolved', 'reopened', 'triage')),

  -- 发现 gap 时的 revision（用于验真时对账）
  current_revision TEXT,

  -- resolved 时的验证证据（含 assertion_id / assertion_receipt / revision）
  resolution_evidence JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 同一任务 + 同一影响节点 + 同一 revision 只开一个 gap（幂等）
  UNIQUE (source_task_id, impact_node_id, current_revision)
);

-- ---------- 事件链 ----------

CREATE TABLE IF NOT EXISTS gap_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  gap_id UUID NOT NULL REFERENCES harness_gaps(id) ON DELETE CASCADE,

  -- 事件类型
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'discovered',
      'assigned',
      'fix_started',
      'verification_started',
      'resolved',
      'reopened',
      'CONTRACT_IMPACT_DRIFT'
    )),

  -- 幂等键（同 gap_id + idempotency_key 不重复插入）
  idempotency_key TEXT,

  actor TEXT,
  detail JSONB,
  revision TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (gap_id, idempotency_key)
);

-- ---------- 硬依赖阻塞关系 ----------

CREATE TABLE IF NOT EXISTS task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 被阻塞的任务（source_task_id）
  from_task_id UUID NOT NULL,

  -- 解锁条件任务（repair_task_id）
  to_task_id UUID NOT NULL,

  -- 边类型：hard（阻塞）/ soft（警告）
  edge_type TEXT NOT NULL DEFAULT 'hard'
    CHECK (edge_type IN ('hard', 'soft')),

  -- 关联的 gap
  gap_id UUID REFERENCES harness_gaps(id),

  -- pending / satisfied / cancelled
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'satisfied', 'cancelled')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (from_task_id, to_task_id, gap_id)
);

-- ---------- 索引 ----------

CREATE INDEX IF NOT EXISTS idx_harness_gaps_source_task
  ON harness_gaps (source_task_id);

CREATE INDEX IF NOT EXISTS idx_harness_gaps_status
  ON harness_gaps (status);

CREATE INDEX IF NOT EXISTS idx_harness_gaps_repair_task
  ON harness_gaps (repair_task_id)
  WHERE repair_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gap_events_gap_id
  ON gap_events (gap_id);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_from
  ON task_dependencies (from_task_id);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_gap
  ON task_dependencies (gap_id)
  WHERE gap_id IS NOT NULL;

-- ---------- 注释 ----------

COMMENT ON TABLE harness_gaps IS
  'Gap 生命周期台账。记录开发过程中发现的未声明影响（drift 触发），跟踪 open→resolved 流程。';

COMMENT ON TABLE gap_events IS
  'Gap 状态变更事件链。每次状态迁移写入一条，支持完整审计和可观测性。';

COMMENT ON TABLE task_dependencies IS
  '原任务被 gap 阻塞的硬依赖关系。gap resolved 后将 status 改为 satisfied，原任务恢复 in_progress。';

-- ---------- schema_version ----------

INSERT INTO schema_version (version, description)
VALUES (402, 'harness_gap_ledger')
ON CONFLICT DO NOTHING;
