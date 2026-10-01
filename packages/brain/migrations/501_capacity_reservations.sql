-- 非 Harness 执行的独立预约；所有未 released 行持续占用，任务终态不能级联删除。
CREATE TABLE IF NOT EXISTS capacity_reservations (
  id UUID PRIMARY KEY,
  machine_id TEXT NOT NULL,
  owner_kind TEXT NOT NULL CHECK (owner_kind = 'script'),
  owner_key TEXT NOT NULL,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  config_digest TEXT NOT NULL CHECK (config_digest ~ '^[a-f0-9]{64}$'),
  allocation_mode TEXT NOT NULL CHECK (allocation_mode = 'exclusive_unclassified'),
  policy_version TEXT NOT NULL,
  snapshot_time TIMESTAMPTZ NOT NULL,
  snapshot_digest TEXT NOT NULL CHECK (snapshot_digest ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN
    ('reserved','launching','running','cleanup_pending','blocked','released')),
  launch_generation INTEGER NOT NULL DEFAULT 1 CHECK (launch_generation > 0),
  intent_id UUID NOT NULL DEFAULT gen_random_uuid(),
  worker_id TEXT,
  worker_boot_id TEXT,
  container_id TEXT,
  cleanup_claim_owner TEXT,
  cleanup_claim_generation INTEGER NOT NULL DEFAULT 0,
  cleanup_claim_expires_at TIMESTAMPTZ,
  cleanup_challenge UUID,
  confirmed_receipt JSONB,
  last_error TEXT,
  retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  UNIQUE (owner_kind, owner_key),
  CHECK ((status = 'released') = (released_at IS NOT NULL)),
  CHECK (status <> 'released' OR confirmed_receipt IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS capacity_reservations_live_machine_idx
  ON capacity_reservations(machine_id) WHERE status <> 'released';
CREATE INDEX IF NOT EXISTS capacity_reservations_cleanup_idx
  ON capacity_reservations(retry_at) WHERE status <> 'released';

CREATE OR REPLACE FUNCTION guard_capacity_reservation_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'capacity_reservation_delete_forbidden';
  END IF;
  IF OLD.status = 'released' THEN
    RAISE EXCEPTION 'capacity_reservation_released_terminal';
  END IF;
  IF (NEW.id, NEW.machine_id, NEW.owner_kind, NEW.owner_key, NEW.task_id,
      NEW.config_digest, NEW.allocation_mode, NEW.policy_version, NEW.launch_generation, NEW.intent_id)
      IS DISTINCT FROM
     (OLD.id, OLD.machine_id, OLD.owner_kind, OLD.owner_key, OLD.task_id,
      OLD.config_digest, OLD.allocation_mode, OLD.policy_version, OLD.launch_generation, OLD.intent_id)
     OR (OLD.container_id IS NOT NULL AND NEW.container_id IS DISTINCT FROM OLD.container_id)
     OR (OLD.worker_id IS NOT NULL AND NEW.worker_id IS DISTINCT FROM OLD.worker_id)
     OR (OLD.worker_boot_id IS NOT NULL AND NEW.worker_boot_id IS DISTINCT FROM OLD.worker_boot_id) THEN
    RAISE EXCEPTION 'capacity_reservation_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER capacity_reservation_identity_guard BEFORE UPDATE OR DELETE ON capacity_reservations
  FOR EACH ROW EXECUTE FUNCTION guard_capacity_reservation_identity();
INSERT INTO schema_version(version, description, applied_at)
  VALUES ('501','脚本共享机器预约与强身份清理',NOW()) ON CONFLICT (version) DO NOTHING;
