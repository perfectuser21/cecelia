-- Migration 107: Person Model — 个人认知表系统
--
-- 为每个与 Cecelia 交互的人建立三层认知模型：
--   person_models:       稳定特征（永不衰减）
--   person_signals:      时序信号（三层衰减：permanent/weekly/hourly）
--   pending_conversations: Cecelia 发出的消息待回音追踪

-- ============================================================
-- 1. person_models — 稳定特征（每人一行）
-- ============================================================
CREATE TABLE IF NOT EXISTS person_models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       TEXT NOT NULL UNIQUE,     -- feishu open_id 或 'owner'
  name            TEXT,
  relationship    TEXT DEFAULT 'guest',     -- owner / colleague / client / guest
  stable_traits   JSONB DEFAULT '{}',       -- 永久特征：沟通风格、偏好、时区等
  baseline_mood   TEXT DEFAULT 'neutral',   -- 情绪衰减基准线（不向零，向此基准）
  notes           TEXT,                     -- 自由备注
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_person_models_relationship ON person_models(relationship);

-- 种子：Alex（owner）
INSERT INTO person_models (person_id, name, relationship, stable_traits, baseline_mood)
VALUES (
  'owner',
  '徐啸 / Alex Xu',
  'owner',
  '{"communication_style": "direct", "timezone": "Asia/Shanghai", "language": "zh-CN", "prefers_concise": true}',
  'calm'
) ON CONFLICT (person_id) DO NOTHING;

-- ============================================================
-- 2. person_signals — 时序信号（带衰减生命周期）
-- ============================================================
CREATE TABLE IF NOT EXISTS person_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       TEXT NOT NULL,            -- 关联 person_models.person_id
  signal_type     TEXT NOT NULL,            -- 'mood' / 'availability' / 'workload' / 'sentiment' / 'location'
  signal_value    TEXT NOT NULL,            -- 'stressed' / 'busy' / 'positive' / 'available' 等
  confidence      FLOAT NOT NULL DEFAULT 0.7, -- 置信度 0.0~1.0
  source          TEXT DEFAULT 'inferred',  -- 'explicit'（用户明说）/ 'inferred'（LLM 推断）
  decay_tier      TEXT NOT NULL DEFAULT 'hourly', -- 'permanent' / 'weekly' / 'hourly'
  expires_at      TIMESTAMPTZ,              -- NULL = 永不过期（permanent tier）
  last_accessed_at TIMESTAMPTZ DEFAULT NOW(), -- 用于基于访问时间的衰减计算
  raw_excerpt     TEXT,                     -- 提取来源的原始文本片段（可选）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_signal_type CHECK (signal_type IN ('mood', 'availability', 'workload', 'sentiment', 'location', 'other')),
  CONSTRAINT chk_decay_tier  CHECK (decay_tier IN ('permanent', 'weekly', 'hourly')),
  CONSTRAINT chk_confidence  CHECK (confidence >= 0.0 AND confidence <= 1.0)
);

CREATE INDEX IF NOT EXISTS idx_person_signals_person_id  ON person_signals(person_id);
CREATE INDEX IF NOT EXISTS idx_person_signals_active     ON person_signals(person_id, expires_at) WHERE expires_at IS NULL OR expires_at > NOW();
CREATE INDEX IF NOT EXISTS idx_person_signals_type       ON person_signals(person_id, signal_type);

-- ============================================================
-- 3. pending_conversations — Cecelia 发出的消息待回音追踪
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       TEXT NOT NULL DEFAULT 'owner',
  message         TEXT NOT NULL,            -- Cecelia 说了什么
  context         TEXT,                     -- 为什么说（任务完成 / 欲望驱动 / 主动关怀）
  context_type    TEXT DEFAULT 'task_completion', -- 'task_completion' / 'desire' / 'followup' / 'other'
  importance      FLOAT NOT NULL DEFAULT 0.5, -- 重要性 0.0~1.0（影响跟进概率）
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  followed_up_count INT NOT NULL DEFAULT 0, -- 已跟进次数
  last_followup_at  TIMESTAMPTZ,            -- 最近一次跟进时间
  resolved_at     TIMESTAMPTZ,              -- NULL = 还在等回应
  resolve_source  TEXT,                     -- 'user_reply' / 'timeout' / 'manual'

  CONSTRAINT chk_importance CHECK (importance >= 0.0 AND importance <= 1.0),
  CONSTRAINT chk_context_type CHECK (context_type IN ('task_completion', 'desire', 'followup', 'proactive', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_pending_conversations_open   ON pending_conversations(person_id, sent_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pending_conversations_person ON pending_conversations(person_id);
