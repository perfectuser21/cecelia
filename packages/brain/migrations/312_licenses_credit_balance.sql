-- Migration 312: licenses 积分额度字段 + credit_transactions 记账表
-- licenses: 新增 credit_balance（当前余额）和 credit_total（累计充值总量，numeric 精度防浮点偏差）
-- credit_transactions: 记录每笔积分变动（充值/消耗），关联 license_id + task_id

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS credit_balance NUMERIC(18,6) NOT NULL DEFAULT 0
    CHECK (credit_balance >= 0),
  ADD COLUMN IF NOT EXISTS credit_total   NUMERIC(18,6) NOT NULL DEFAULT 0
    CHECK (credit_total >= 0);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id  UUID        NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  task_id     UUID        REFERENCES tasks(id) ON DELETE SET NULL,
  amount      NUMERIC(18,6) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_license_id
  ON credit_transactions (license_id);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_task_id
  ON credit_transactions (task_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at
  ON credit_transactions (created_at DESC);
