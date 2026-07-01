-- Migration 311: test_registry 生命周期治理
-- 给 test_registry 加 status + 与能力(journey_features)的关联 + 巡检审计字段。
-- 全 additive：不改存量行语义，存量默认 active。
-- 运行: psql $DATABASE_URL < packages/brain/migrations/311_test_registry_lifecycle.sql

ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','orphan','deprecated'));

-- feature_id 是软引用，故意不加 REFERENCES 约束：
-- 若加 FK + ON DELETE SET NULL，能力被删的瞬间 feature_id 就被 Postgres 自动置 NULL，
-- 巡检就永远看不到"这行曾经指向一个已删除的能力"，feature_deleted 判定会失效成死代码。
-- 巡检自己做存在性 JOIN 判断（SELECT id FROM journey_features WHERE id = ANY(...)），
-- 不依赖 DB 级联，这样能力删除后 feature_id 会保留原值，巡检才能判定 feature_deleted。
ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS feature_id UUID;

ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS orphan_reason TEXT;

ALTER TABLE test_registry
  ADD COLUMN IF NOT EXISTS lifecycle_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_test_registry_status
  ON test_registry (status);

CREATE INDEX IF NOT EXISTS idx_test_registry_feature_id
  ON test_registry (feature_id);

CREATE TABLE IF NOT EXISTS test_lifecycle_alerts (
  id            SERIAL PRIMARY KEY,
  file_path     TEXT NOT NULL,
  orphan_reason TEXT NOT NULL,
  feature_id    UUID,
  patrol_date   DATE NOT NULL,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (file_path, patrol_date)
);

CREATE INDEX IF NOT EXISTS idx_test_lifecycle_alerts_detected_at
  ON test_lifecycle_alerts (detected_at DESC);
