-- Migration 245: 补 callback_queue.retry_count + key_results.progress_pct
-- 目的：修 health-monitor.js + kr-verifier.js 启动报错（silently degrade）。
--   - health-monitor.js:124 查 callback_queue.retry_count（原表只有 attempt）
--   - kr-verifier.js:126 查 key_results.progress_pct（原表只有 progress / current_value）
-- 备注：PRD 指定 233_*.sql，但 233_fix_thalamus_provider.sql 已占用，改用下一个可用编号 245。
--
-- callback_queue 表历史上由 database/migrations/009-callback-queue.sql 创建（不在
-- packages/brain/migrations 体系内），生产 cecelia 已有，cecelia_test 没有。本 migration
-- 顶部用 CREATE TABLE IF NOT EXISTS 补齐，让 ALTER COLUMN 在干净 DB 也可执行；列定义
-- 与生产 cecelia.callback_queue 完全一致（含 idx_callback_queue_unprocessed 部分索引）。

CREATE TABLE IF NOT EXISTS callback_queue (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID        NOT NULL,
  checkpoint_id    TEXT,
  run_id           TEXT,
  status           TEXT        NOT NULL,
  result_json      JSONB,
  stderr_tail      TEXT,
  duration_ms      INTEGER,
  attempt          INTEGER     NOT NULL DEFAULT 1,
  exit_code        INTEGER,
  failure_class    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_callback_queue_unprocessed
  ON callback_queue (created_at ASC)
  WHERE processed_at IS NULL;

ALTER TABLE callback_queue ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_callback_queue_retry_count
  ON callback_queue(retry_count) WHERE retry_count > 0;

ALTER TABLE key_results ADD COLUMN IF NOT EXISTS progress_pct DECIMAL(5,2) DEFAULT 0.0;
