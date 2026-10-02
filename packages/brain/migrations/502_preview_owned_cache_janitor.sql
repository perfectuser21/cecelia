-- 固定HTTP运维任务；保留现场CHECK已有全部值，不依赖501，不改任何已有任务。
DO $$
DECLARE item RECORD; definition TEXT;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('tasks_task_type_check','task_type','janitor'),
    ('tasks_executor_kind_check','executor_kind','preview-janitor')
  ) AS x(name,col,value) LOOP
    SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
      WHERE conrelid='tasks'::regclass AND conname=item.name;
    IF definition IS NULL THEN RAISE EXCEPTION 'missing task contract %',item.name; END IF;
    EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I',item.name);
    EXECUTE format('ALTER TABLE tasks ADD CONSTRAINT %I CHECK ((%s) OR %I=%L)',
      item.name,substring(definition FROM 8 FOR length(definition)-8),item.col,item.value);
  END LOOP;
END $$;

CREATE TABLE janitor_cache_intents (
  source_id TEXT PRIMARY KEY,
  task_id UUID NOT NULL UNIQUE REFERENCES tasks(id),
  run_id UUID NOT NULL REFERENCES janitor_runs(id),
  request JSONB NOT NULL,
  digest TEXT NOT NULL,
  claimant TEXT NOT NULL,
  receipt JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);
CREATE INDEX janitor_cache_intents_pending ON janitor_cache_intents(run_id) WHERE settled_at IS NULL;
CREATE FUNCTION preserve_janitor_cache_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.source_id,NEW.task_id,NEW.run_id,NEW.request,NEW.digest,NEW.claimant)
    IS DISTINCT FROM (OLD.source_id,OLD.task_id,OLD.run_id,OLD.request,OLD.digest,OLD.claimant)
  THEN RAISE EXCEPTION 'immutable janitor intent'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER janitor_cache_intent_immutable BEFORE UPDATE ON janitor_cache_intents
  FOR EACH ROW EXECUTE FUNCTION preserve_janitor_cache_intent();
-- 默认停用：部署迁移也不会产生删除动作。
INSERT INTO janitor_config(job_id,enabled) VALUES('preview-owned-npm-cache-expiry-v1',false)
  ON CONFLICT(job_id) DO NOTHING;
