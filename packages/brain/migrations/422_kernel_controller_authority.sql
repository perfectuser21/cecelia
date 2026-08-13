BEGIN;
CREATE TABLE IF NOT EXISTS kernel_controller_sessions (
  id TEXT PRIMARY KEY,
  run_id UUID UNIQUE REFERENCES initiative_runs(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  generation BIGINT NOT NULL DEFAULT 1 CHECK (generation > 0),
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE initiative_runs ADD COLUMN IF NOT EXISTS controller_generation BIGINT;
INSERT INTO kernel_controller_sessions (id,run_id,task_id,generation,source,status,last_heartbeat_at,lease_expires_at)
SELECT gen_random_uuid()::text, run.id, run.current_task_id, 1, 'migration-422',
       CASE WHEN run.phase IN ('done','failed') THEN 'closed' ELSE 'active' END,
       COALESCE(run.orchestrator_heartbeat_at,run.started_at,NOW()),
       CASE WHEN run.phase IN ('done','failed') THEN NOW()
            ELSE GREATEST(COALESCE(run.controller_lease_expires_at,NOW()),NOW()+INTERVAL '30 minutes') END
FROM initiative_runs run WHERE run.orchestrator_version='v2' AND run.current_task_id IS NOT NULL
ON CONFLICT (run_id) DO NOTHING;
UPDATE initiative_runs run SET controller_session_id=session.id,
 controller_generation=session.generation,controller_lease_expires_at=session.lease_expires_at
FROM kernel_controller_sessions session WHERE session.run_id=run.id AND run.orchestrator_version='v2';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='initiative_runs'::regclass AND conname='initiative_runs_controller_session_fkey') THEN
 ALTER TABLE initiative_runs ADD CONSTRAINT initiative_runs_controller_session_fkey
 FOREIGN KEY (controller_session_id) REFERENCES kernel_controller_sessions(id);
END IF; END $$;
CREATE INDEX IF NOT EXISTS idx_kernel_controller_sessions_active_lease ON kernel_controller_sessions(lease_expires_at) WHERE status='active';
INSERT INTO schema_version(version,description,applied_at)
VALUES ('422','Durable server-issued Kernel Controller authority and generation leases',NOW())
ON CONFLICT(version) DO NOTHING;
COMMIT;
