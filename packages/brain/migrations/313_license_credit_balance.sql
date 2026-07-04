-- Migration 313: License Credit Balance — 积分余额 + 关键词任务表
-- 为 licenses 表增加 credit_balance 字段，支持积分扣费/查询
-- 新建 keyword_tasks 表，供 /api/acquisition/pending-keyword-tasks 使用

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS credit_balance NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (credit_balance >= 0);

-- 积分流水（审计）
CREATE TABLE IF NOT EXISTS license_credit_transactions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id      UUID        NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL,          -- 负数=扣费，正数=充值
  balance_after   NUMERIC(12,2) NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_tx_license_id
  ON license_credit_transactions(license_id);

-- 关键词采集任务
CREATE TABLE IF NOT EXISTS keyword_tasks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id      UUID        NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  keyword         TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  result          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_keyword_tasks_license_status
  ON keyword_tasks(license_id, status);
