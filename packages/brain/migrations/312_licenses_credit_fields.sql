-- Migration 312: licenses 表积分额度字段 + credit_transactions 记账表
-- 给 licenses 加 credit_balance / credit_total；新建 credit_transactions 用于积分消耗记账。
-- 运行: psql $DATABASE_URL < packages/brain/migrations/312_licenses_credit_fields.sql

-- 1. 给 licenses 追加积分字段（全 additive，不影响存量行）
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS credit_balance NUMERIC NOT NULL DEFAULT 0
    CHECK (credit_balance >= 0);

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS credit_total NUMERIC NOT NULL DEFAULT 0
    CHECK (credit_total >= 0);

-- 2. credit_transactions 记账表（append-only，不允许 UPDATE/DELETE）
CREATE TABLE IF NOT EXISTS credit_transactions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id   UUID        NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  task_id      UUID,
  amount       NUMERIC     NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_tx_license_id
  ON credit_transactions (license_id);

CREATE INDEX IF NOT EXISTS idx_credit_tx_created_at
  ON credit_transactions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_tx_task_id
  ON credit_transactions (task_id)
  WHERE task_id IS NOT NULL;
