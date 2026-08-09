-- Migration 395: Workbench 本地主链 + 可拆卸 projection/outbox

BEGIN;

-- 385 曾与旧分支迁移号碰撞，部分线上库留下 dest_type/dest_id。
-- canonical API 一律使用 destination_type/destination_id，旧列只用于一次性回填。
ALTER TABLE captures
  ADD COLUMN IF NOT EXISTS destination_type VARCHAR(30),
  ADD COLUMN IF NOT EXISTS destination_id UUID,
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

ALTER TABLE okr_projects
  ADD COLUMN IF NOT EXISTS notion_id TEXT,
  ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'captures' AND column_name = 'dest_type'
  ) THEN
    EXECUTE 'UPDATE captures SET destination_type = COALESCE(destination_type, dest_type)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'captures' AND column_name = 'dest_id'
  ) THEN
    EXECUTE 'UPDATE captures SET destination_id = COALESCE(destination_id, dest_id)';
  END IF;
END $$;

ALTER TABLE captures DROP CONSTRAINT IF EXISTS captures_destination_type_chk;
ALTER TABLE captures ADD CONSTRAINT captures_destination_type_chk
  CHECK (destination_type IS NULL OR destination_type IN ('initiative', 'project', 'task', 'dropped', 'na'));

CREATE TABLE IF NOT EXISTS projection_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target VARCHAR(40) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID NOT NULL,
  event_type VARCHAR(40) NOT NULL DEFAULT 'upsert',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  leased_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projection_outbox_ready
  ON projection_outbox (target, status, available_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS projection_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target VARCHAR(40) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID NOT NULL,
  external_id TEXT NOT NULL,
  content_hash TEXT,
  external_updated_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (target, entity_type, entity_id),
  UNIQUE (target, external_id)
);

CREATE TABLE IF NOT EXISTS projection_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target VARCHAR(40) NOT NULL,
  external_id TEXT NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID,
  command_type VARCHAR(40) NOT NULL
    CHECK (command_type IN ('start_requested', 'cancel_requested', 'annotate_requested')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'applied', 'rejected', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  leased_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  UNIQUE (target, external_id, command_type)
);

CREATE INDEX IF NOT EXISTS idx_projection_commands_pending
  ON projection_commands (status, available_at, created_at) WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS projection_targets (
  target VARCHAR(40) PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 每次 task/project 变化只产生本地 outbox；第三方不可进入状态机主链。
CREATE OR REPLACE FUNCTION enqueue_projection_change() RETURNS trigger AS $$
BEGIN
  INSERT INTO projection_outbox (
    target, entity_type, entity_id, event_type, payload, idempotency_key
  ) VALUES (
    'notion', CASE WHEN TG_TABLE_NAME='okr_projects' THEN 'projects' ELSE TG_TABLE_NAME END,
    NEW.id, 'upsert', to_jsonb(NEW),
    TG_TABLE_NAME || ':' || NEW.id::text || ':' || txid_current()::text
  )
  ON CONFLICT (idempotency_key) DO UPDATE
    SET payload = EXCLUDED.payload, status = 'pending', available_at = NOW(), updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_projection_outbox ON tasks;
CREATE TRIGGER trg_tasks_projection_outbox
  AFTER INSERT OR UPDATE OF title, description, status, priority, task_type, project_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION enqueue_projection_change();

DROP TRIGGER IF EXISTS trg_projects_projection_outbox ON okr_projects;
CREATE TRIGGER trg_projects_projection_outbox
  AFTER INSERT OR UPDATE OF title, status ON okr_projects
  FOR EACH ROW EXECUTE FUNCTION enqueue_projection_change();

-- 首次上线收编现有本地数据；唯一键保证 migration 重跑不重复。
INSERT INTO projection_outbox (target, entity_type, entity_id, payload, idempotency_key)
SELECT 'notion', 'projects', id, to_jsonb(p), 'bootstrap:projects:' || id::text
FROM okr_projects p
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO projection_outbox (target, entity_type, entity_id, payload, idempotency_key)
SELECT 'notion', 'tasks', id, to_jsonb(t), 'bootstrap:tasks:' || id::text
FROM tasks t
ON CONFLICT (idempotency_key) DO NOTHING;

DROP VIEW IF EXISTS capture_aging_sentinel;
CREATE VIEW capture_aging_sentinel AS
SELECT
  id, content, source, status, destination_type, destination_id, created_at,
  now() - created_at AS age,
  EXTRACT(EPOCH FROM (now() - created_at)) / 86400 AS age_days,
  CASE
    WHEN EXTRACT(EPOCH FROM (now() - created_at)) / 86400 >= 30 THEN 'critical'
    WHEN EXTRACT(EPOCH FROM (now() - created_at)) / 86400 >= 14 THEN 'warning'
    ELSE 'watch'
  END AS severity
FROM captures
WHERE status NOT IN ('done', 'dropped')
  AND destination_type IS NULL
  AND created_at < now() - INTERVAL '7 days';

INSERT INTO schema_version (version, description, applied_at)
VALUES ('395', 'Workbench canonical captures + generic projection outbox/link/commands', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
