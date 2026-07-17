-- Migration 346: incidents 表幂等重建
-- task_id: 874c9cc8-8afe-47c5-a3ed-e1dce93abda4
-- 修复：346 原版 CREATE TABLE IF NOT EXISTS 在旧结构（无 fingerprint 列）存在时跳过建表，
--       但随后 CREATE INDEX ON incidents(fingerprint) 因列不存在爆炸，Brain 进入无限崩溃循环。
--
-- 路径 A：incidents 存在 + 无 fingerprint 列 + 空表 → RENAME 改名 + 重建完整表
-- 路径 B：incidents 存在 + 无 fingerprint 列 + 非空表 → ALTER 补列 + 回填 LEGACY_ + NOT NULL + UNIQUE
-- 路径 C：incidents 存在 + fingerprint 列已存在 → 跳过（幂等）
-- 路径 D：incidents 不存在 → 直接建完整表

DO $$
DECLARE
  table_exists BOOLEAN;
  fingerprint_exists BOOLEAN;
  row_count BIGINT;
BEGIN
  -- 检测 incidents 表是否存在
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'incidents'
  ) INTO table_exists;

  IF table_exists THEN
    -- 检测 fingerprint 列是否存在
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'incidents'
        AND column_name = 'fingerprint'
    ) INTO fingerprint_exists;

    IF fingerprint_exists THEN
      -- 路径 C：fingerprint 已存在，完全幂等，跳过
      RAISE NOTICE 'Migration 346: fingerprint 列已存在，跳过（幂等路径）';

    ELSE
      -- 无 fingerprint 列：判断是否为空表
      EXECUTE 'SELECT COUNT(*) FROM incidents' INTO row_count;

      IF row_count = 0 THEN
        -- 路径 A：空表 → RENAME + 重建
        RAISE NOTICE 'Migration 346: 路径 A - 旧结构空表改名 + 重建完整 incidents 表';

        -- 清理可能存在的旧改名表（幂等支持）
        DROP TABLE IF EXISTS incidents_legacy_pre346;
        ALTER TABLE incidents RENAME TO incidents_legacy_pre346;

        -- 重建完整 incidents 表
        CREATE TABLE incidents (
          id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          probe_id         TEXT        NOT NULL,
          fingerprint      TEXT        NOT NULL UNIQUE,
          severity         TEXT        NOT NULL,
          evidence         JSONB       NOT NULL DEFAULT '{}',
          status           TEXT        NOT NULL DEFAULT 'open'
                                       CHECK (status IN ('open','triaged','fixing','resolved','postmortem_done')),
          task_id          UUID        REFERENCES tasks(id) ON DELETE SET NULL,
          recurrence_count INTEGER     NOT NULL DEFAULT 1,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

      ELSE
        -- 路径 B：非空表 → ALTER 补 fingerprint + 回填 + NOT NULL + UNIQUE
        RAISE NOTICE 'Migration 346: 路径 B - 非空旧表补 fingerprint 列并回填';

        -- 先加列（允许 NULL，否则回填前无法 ALTER）
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS fingerprint TEXT;

        -- 回填现有行（使用 LEGACY_ 前缀 + UUID 保证唯一）
        UPDATE incidents SET fingerprint = 'LEGACY_' || id::text WHERE fingerprint IS NULL;

        -- 加 NOT NULL 约束
        ALTER TABLE incidents ALTER COLUMN fingerprint SET NOT NULL;

        -- 加 UNIQUE 约束（若已存在则忽略）
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          WHERE tc.table_schema = 'public'
            AND tc.table_name = 'incidents'
            AND kcu.column_name = 'fingerprint'
            AND tc.constraint_type = 'UNIQUE'
        ) THEN
          ALTER TABLE incidents ADD CONSTRAINT incidents_fingerprint_unique UNIQUE (fingerprint);
        END IF;

      END IF;
    END IF;

  ELSE
    -- 路径 D：incidents 表不存在，直接建完整表
    RAISE NOTICE 'Migration 346: 路径 D - incidents 表不存在，直接建完整表';

    CREATE TABLE incidents (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      probe_id         TEXT        NOT NULL,
      fingerprint      TEXT        NOT NULL UNIQUE,
      severity         TEXT        NOT NULL,
      evidence         JSONB       NOT NULL DEFAULT '{}',
      status           TEXT        NOT NULL DEFAULT 'open'
                                   CHECK (status IN ('open','triaged','fixing','resolved','postmortem_done')),
      task_id          UUID        REFERENCES tasks(id) ON DELETE SET NULL,
      recurrence_count INTEGER     NOT NULL DEFAULT 1,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

  END IF;
END $$;

-- 索引：使用 IF NOT EXISTS 保证幂等
CREATE INDEX IF NOT EXISTS idx_incidents_fingerprint  ON incidents (fingerprint);
CREATE INDEX IF NOT EXISTS idx_incidents_status       ON incidents (status);
CREATE INDEX IF NOT EXISTS idx_incidents_probe_id     ON incidents (probe_id);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at   ON incidents (created_at DESC);
