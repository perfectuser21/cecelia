BEGIN;
CREATE TABLE IF NOT EXISTS kernel_controller_sessions (
  id TEXT PRIMARY KEY,
  run_id UUID REFERENCES initiative_runs(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  generation BIGINT NOT NULL DEFAULT 1 CHECK (generation > 0),
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE initiative_runs ADD COLUMN IF NOT EXISTS controller_generation BIGINT;

-- Pre-422 controller strings have no durable authority row and therefore
-- cannot prove a live owner.  Never bless them with a fresh lease: preserve
-- the ownerless state so the startup sweeper immediately fails closed.
UPDATE initiative_runs
   SET controller_session_id=NULL,
       controller_generation=NULL,
       controller_lease_expires_at=NULL
 WHERE orchestrator_version='v2'
   AND phase NOT IN ('done','failed');

-- Terminal history gets a closed audit identity only; it is never executable.
INSERT INTO kernel_controller_sessions (id,run_id,task_id,generation,source,status,last_heartbeat_at,lease_expires_at)
SELECT gen_random_uuid()::text, run.id, run.current_task_id, 1, 'migration-422',
       'closed',
       COALESCE(run.orchestrator_heartbeat_at,run.started_at,NOW()),
       NOW()
FROM initiative_runs run WHERE run.orchestrator_version='v2'
 AND run.phase IN ('done','failed') AND run.current_task_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM kernel_controller_sessions existing WHERE existing.run_id=run.id)
ON CONFLICT DO NOTHING;
UPDATE initiative_runs run SET controller_session_id=session.id,
 controller_generation=session.generation,controller_lease_expires_at=session.lease_expires_at
FROM kernel_controller_sessions session WHERE session.run_id=run.id AND run.orchestrator_version='v2';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='initiative_runs'::regclass AND conname='initiative_runs_controller_session_fkey') THEN
 ALTER TABLE initiative_runs ADD CONSTRAINT initiative_runs_controller_session_fkey
 FOREIGN KEY (controller_session_id) REFERENCES kernel_controller_sessions(id);
END IF; END $$;
CREATE INDEX IF NOT EXISTS idx_kernel_controller_sessions_active_lease ON kernel_controller_sessions(lease_expires_at) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_kernel_controller_sessions_one_active_run
  ON kernel_controller_sessions(run_id) WHERE status='active';

CREATE OR REPLACE FUNCTION enforce_v2_controller_authority()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.orchestrator_version='v2'
     AND NEW.phase NOT IN ('done','failed') THEN
    IF NEW.controller_session_id IS NULL
       OR NEW.controller_generation IS NULL
       OR NEW.controller_lease_expires_at IS NULL THEN
      RAISE EXCEPTION 'active_v2_run_requires_controller_authority';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM kernel_controller_sessions session
       WHERE session.id=NEW.controller_session_id
         AND session.generation=NEW.controller_generation
         AND session.task_id=NEW.current_task_id
         AND session.status='active'
         AND (session.run_id IS NULL OR session.run_id=NEW.id)
         AND session.lease_expires_at IS NOT DISTINCT FROM NEW.controller_lease_expires_at
    ) THEN
      RAISE EXCEPTION 'active_v2_controller_authority_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS v2_controller_authority_required ON initiative_runs;
CREATE TRIGGER v2_controller_authority_required
BEFORE INSERT OR UPDATE OF phase,orchestrator_version,controller_session_id,
  controller_generation,controller_lease_expires_at ON initiative_runs
FOR EACH ROW EXECUTE FUNCTION enforce_v2_controller_authority();

INSERT INTO schema_version(version,description,applied_at)
VALUES ('422','Durable server-issued Kernel Controller authority and generation leases',NOW())
ON CONFLICT(version) DO NOTHING;
COMMIT;
