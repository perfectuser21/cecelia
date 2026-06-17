-- Migration 301: skill_drift_alerts 表
-- 记录每日 skill-drift 巡检发现的漂移告警，skill_name + drift_date 按日去重。
-- Evaluator 运行 E2E 前执行: psql $DB < packages/brain/migrations/301_skill_drift_alerts.sql

CREATE TABLE IF NOT EXISTS skill_drift_alerts (
  id             SERIAL PRIMARY KEY,
  skill_name     TEXT NOT NULL,
  ssot_version   TEXT,
  snapshot_version TEXT,
  drift_date     DATE NOT NULL,
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (skill_name, drift_date)
);

CREATE INDEX IF NOT EXISTS idx_skill_drift_alerts_detected_at
  ON skill_drift_alerts (detected_at DESC);
