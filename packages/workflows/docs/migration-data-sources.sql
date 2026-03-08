-- Migration: Create zenithjoy.data_sources table
-- Date: 2026-03-07
-- Purpose: 持久化 N8N 数据采集调度器每次运行结果

-- ============================================================
-- 1. Create schema (if not exists)
-- ============================================================

CREATE SCHEMA IF NOT EXISTS zenithjoy;

-- ============================================================
-- 2. Create data_sources table
-- ============================================================

CREATE TABLE IF NOT EXISTS zenithjoy.data_sources (
  id            SERIAL PRIMARY KEY,
  run_date      DATE          NOT NULL,
  platform      VARCHAR(50)   NOT NULL,
  success       BOOLEAN       NOT NULL,
  record_count  INTEGER       DEFAULT 0,
  error_message TEXT,
  scraped_at    TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE(run_date, platform)
);

COMMENT ON TABLE zenithjoy.data_sources IS 'N8N 数据采集调度器每次运行的平台采集结果记录';
COMMENT ON COLUMN zenithjoy.data_sources.run_date      IS '采集日期（上海时间当天）';
COMMENT ON COLUMN zenithjoy.data_sources.platform      IS '平台名称（抖音、快手、小红书等）';
COMMENT ON COLUMN zenithjoy.data_sources.success       IS '是否采集成功（count >= 3 视为成功）';
COMMENT ON COLUMN zenithjoy.data_sources.record_count  IS '采集到的记录数量';
COMMENT ON COLUMN zenithjoy.data_sources.error_message IS '失败原因（可选）';
COMMENT ON COLUMN zenithjoy.data_sources.scraped_at    IS '实际采集时间';

-- ============================================================
-- 3. Create indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_data_sources_run_date
ON zenithjoy.data_sources(run_date DESC);

CREATE INDEX IF NOT EXISTS idx_data_sources_platform
ON zenithjoy.data_sources(platform);

-- ============================================================
-- 4. Verification query
-- ============================================================

\echo '=== Verification: data_sources table ==='
SELECT
  table_schema,
  table_name,
  (SELECT COUNT(*) FROM zenithjoy.data_sources) AS row_count
FROM information_schema.tables
WHERE table_schema = 'zenithjoy' AND table_name = 'data_sources';

\echo ''
\echo 'Migration completed: zenithjoy.data_sources created'
\echo ''
\echo 'Usage:'
\echo '  Run on HK VPS: docker exec -i cecelia-postgres psql -U cecelia -d timescaledb < migration-data-sources.sql'
