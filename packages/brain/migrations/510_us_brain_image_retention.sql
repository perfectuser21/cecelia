-- 仅新增固定US自有镜像策略，保留现场原执行器约束。
DO $$ DECLARE definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conrelid='tasks'::regclass AND conname='tasks_executor_kind_check';
  IF definition IS NULL THEN RAISE EXCEPTION 'missing executor contract'; END IF;
  ALTER TABLE tasks DROP CONSTRAINT tasks_executor_kind_check;
  EXECUTE format('ALTER TABLE tasks ADD CONSTRAINT tasks_executor_kind_check CHECK ((%s) OR executor_kind=%L)',
    substring(definition FROM 8 FOR length(definition)-8),'image-janitor');
END $$;
CREATE TABLE janitor_image_intents (
  source_id TEXT PRIMARY KEY,
  task_id UUID NOT NULL UNIQUE REFERENCES tasks(id),
  run_id UUID NOT NULL REFERENCES janitor_runs(id),
  request JSONB NOT NULL,
  binding JSONB NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  claimant TEXT NOT NULL,
  receipt JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ,
  CHECK ((receipt IS NULL) = (settled_at IS NULL))
);
CREATE INDEX janitor_image_intents_pending ON janitor_image_intents(run_id) WHERE settled_at IS NULL;
CREATE FUNCTION preserve_janitor_image_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.source_id,NEW.task_id,NEW.run_id,NEW.request,NEW.binding,NEW.digest,NEW.claimant)
     IS DISTINCT FROM (OLD.source_id,OLD.task_id,OLD.run_id,OLD.request,OLD.binding,OLD.digest,OLD.claimant)
     OR (OLD.settled_at IS NOT NULL AND (NEW.receipt,NEW.settled_at) IS DISTINCT FROM (OLD.receipt,OLD.settled_at))
  THEN RAISE EXCEPTION 'immutable image cleanup intent'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER janitor_image_intent_immutable BEFORE UPDATE ON janitor_image_intents
  FOR EACH ROW EXECUTE FUNCTION preserve_janitor_image_intent();
INSERT INTO janitor_config(job_id,enabled) VALUES('us-brain-image-retention-v1',false)
  ON CONFLICT(job_id) DO NOTHING;
