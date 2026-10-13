-- 显式安装包；不在自动 migrations 目录。标识符由隔离安装器验证后替换。
CREATE TABLE __catalog__.agent_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), display_name text NOT NULL CHECK(length(trim(display_name))>0),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE __catalog__.agent_identity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_id uuid NOT NULL REFERENCES __catalog__.agent_identities(id),
  ops_agent_id bigint NOT NULL REFERENCES __source__.ops_agents(id), source text NOT NULL,
  host_alias text NOT NULL, source_agent_id text NOT NULL, active boolean NOT NULL DEFAULT true,
  evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND evidence<>'{}'::jsonb),
  verified_by text NOT NULL CHECK(length(trim(verified_by))>0), verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agent_active_source ON __catalog__.agent_identity_links(source,host_alias,source_agent_id) WHERE active;
CREATE UNIQUE INDEX agent_active_collector ON __catalog__.agent_identity_links(ops_agent_id) WHERE active;
CREATE TABLE __catalog__.skill_source_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), skill_id uuid NOT NULL REFERENCES __source__.skill_registry(id),
  source_repo text NOT NULL CHECK(length(trim(source_repo))>0), source_path text NOT NULL CHECK(length(trim(source_path))>0),
  source_commit text NOT NULL CHECK(source_commit ~ '^[0-9a-f]{40}$'),
  manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='array' AND jsonb_array_length(manifest)>0),
  manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
  actor text NOT NULL CHECK(length(trim(actor))>0), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(skill_id,id), UNIQUE(skill_id,source_repo,source_path,source_commit,manifest_sha256)
);
CREATE INDEX pinned_skill_source ON __catalog__.skill_source_versions(source_repo,source_path,source_commit);
CREATE TABLE __catalog__.legacy_skill_links (
  old_ops_skill_id bigint PRIMARY KEY REFERENCES __source__.ops_skills(id),
  skill_id uuid REFERENCES __source__.skill_registry(id),
  resolution_state text NOT NULL DEFAULT 'unresolved' CHECK(resolution_state IN ('unresolved','verified','rejected')),
  candidate_skill_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(candidate_skill_ids)='array'),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(evidence)='object'),
  verified_by text, verified_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((resolution_state='verified' AND skill_id IS NOT NULL AND evidence<>'{}'::jsonb
    AND length(trim(verified_by))>0 AND verified_at IS NOT NULL AND verified_by IS NOT NULL)
    OR (resolution_state IN ('unresolved','rejected') AND skill_id IS NULL))
);
CREATE TABLE __catalog__.identity_link_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), object_kind text NOT NULL CHECK(object_kind IN ('agent','skill')),
  source_link_id uuid REFERENCES __catalog__.agent_identity_links(id),
  old_ops_skill_id bigint REFERENCES __catalog__.legacy_skill_links(old_ops_skill_id),
  event_kind text NOT NULL CHECK(event_kind IN ('INSERT','UPDATE')),
  before_value jsonb, after_value jsonb NOT NULL, actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((object_kind='agent' AND source_link_id IS NOT NULL AND old_ops_skill_id IS NULL)
    OR (object_kind='skill' AND source_link_id IS NULL AND old_ops_skill_id IS NOT NULL))
);
CREATE FUNCTION __catalog__.reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '封存历史不可修改或删除'; END $$;
CREATE TRIGGER immutable_source_version BEFORE UPDATE OR DELETE OR TRUNCATE ON __catalog__.skill_source_versions
  FOR EACH STATEMENT EXECUTE FUNCTION __catalog__.reject_history_change();
CREATE TRIGGER immutable_link_events BEFORE UPDATE OR DELETE OR TRUNCATE ON __catalog__.identity_link_events
  FOR EACH STATEMENT EXECUTE FUNCTION __catalog__.reject_history_change();
CREATE TRIGGER immutable_catalog_version BEFORE UPDATE OR DELETE OR TRUNCATE ON __catalog__.catalog_versions
  FOR EACH STATEMENT EXECUTE FUNCTION __catalog__.reject_history_change();

CREATE FUNCTION __catalog__.normalize_source_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry jsonb; path text;
BEGIN
  -- 旧快照在锁等待后仍看不到刚提交的版本，显式拒绝该写入模式。
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION '源版本登记必须使用READ COMMITTED事务' USING ERRCODE='25000';
  END IF;
  path=NEW.source_path;
  IF length(trim(path))=0 OR left(path,1)='/' OR path ~ '^[A-Za-z]:' OR position(chr(92) IN path)>0
    OR string_to_array(path,'/') && ARRAY['..','.',''] THEN
    RAISE EXCEPTION 'Skill目录必须规范仓库相对路径' USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(NEW.manifest) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.manifest)=0 THEN
    RAISE EXCEPTION '源文件清单必须非空' USING ERRCODE='23514';
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(NEW.manifest) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR (entry-'path'-'sha256')<>'{}'::jsonb
      OR jsonb_typeof(entry->'path') IS DISTINCT FROM 'string' OR jsonb_typeof(entry->'sha256') IS DISTINCT FROM 'string'
      OR (entry->>'sha256') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION '清单只保存文件路径和摘要' USING ERRCODE='23514';
    END IF;
    path=entry->>'path';
    IF length(trim(path))=0 OR left(path,1)='/' OR path ~ '^[A-Za-z]:' OR position(chr(92) IN path)>0
      OR string_to_array(path,'/') && ARRAY['..','.',''] THEN
      RAISE EXCEPTION '必须规范相对路径' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.manifest) e GROUP BY e->>'path' HAVING count(*)>1)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.manifest) e WHERE e->>'path'='SKILL.md') THEN
    RAISE EXCEPTION '清单重复或缺SKILL.md' USING ERRCODE='23514';
  END IF;
  SELECT jsonb_agg(e ORDER BY (e->>'path') COLLATE "C") INTO NEW.manifest FROM jsonb_array_elements(NEW.manifest) e;
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(TG_TABLE_SCHEMA,NEW.source_repo,NEW.source_path,NEW.source_commit)::text,621));
  IF EXISTS(SELECT 1 FROM __catalog__.skill_source_versions v
    CROSS JOIN LATERAL jsonb_array_elements(v.manifest) old_file
    JOIN jsonb_array_elements(NEW.manifest) new_file ON old_file->>'path'=new_file->>'path'
    WHERE v.source_repo=NEW.source_repo AND v.source_path=NEW.source_path AND v.source_commit=NEW.source_commit
      AND old_file->>'sha256' IS DISTINCT FROM new_file->>'sha256') THEN
    RAISE EXCEPTION '固定Git来源的文件摘要冲突' USING ERRCODE='23514';
  END IF;
  NEW.manifest_sha256=encode(sha256(convert_to(NEW.manifest::text,'UTF8')),'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER source_manifest_hash BEFORE INSERT ON __catalog__.skill_source_versions
  FOR EACH ROW EXECUTE FUNCTION __catalog__.normalize_source_manifest();

CREATE FUNCTION __catalog__.guard_agent_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION '稳定Agent身份只能退役，不能改ID或删除' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stable_agent_identity BEFORE UPDATE OR DELETE ON __catalog__.agent_identities
  FOR EACH ROW EXECUTE FUNCTION __catalog__.guard_agent_identity();
CREATE FUNCTION __catalog__.guard_agent_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE observed record;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.identity_id,NEW.ops_agent_id,NEW.source,NEW.host_alias,NEW.source_agent_id)
    IS DISTINCT FROM (OLD.identity_id,OLD.ops_agent_id,OLD.source,OLD.host_alias,OLD.source_agent_id) THEN
    RAISE EXCEPTION '来源历史不可改写；先失效再新增链接' USING ERRCODE='23514';
  END IF;
  IF NEW.active OR TG_OP='INSERT' THEN
    SELECT * INTO observed FROM __source__.ops_agents WHERE id=NEW.ops_agent_id FOR SHARE;
    IF NOT FOUND OR NEW.source<>'openclaw' OR observed.agent_type IS DISTINCT FROM 'openclaw_agent'
      OR (observed.source,observed.host_alias,observed.name) IS DISTINCT FROM (NEW.source,NEW.host_alias,NEW.source_agent_id) THEN
      RAISE EXCEPTION '来源不是匹配的OpenClaw Agent' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verified_agent_link BEFORE INSERT OR UPDATE ON __catalog__.agent_identity_links
  FOR EACH ROW EXECUTE FUNCTION __catalog__.guard_agent_link();
CREATE FUNCTION __catalog__.record_link_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; kind text; link_id uuid; old_id bigint;
BEGIN
  IF TG_OP='UPDATE' THEN previous=to_jsonb(OLD); END IF;
  IF TG_TABLE_NAME='agent_identity_links' THEN kind='agent';link_id=NEW.id;
  ELSE kind='skill';old_id=NEW.old_ops_skill_id; END IF;
  INSERT INTO __catalog__.identity_link_events(object_kind,source_link_id,old_ops_skill_id,event_kind,before_value,after_value,actor)
    VALUES(kind,link_id,old_id,TG_OP,previous,to_jsonb(NEW),
      COALESCE(NULLIF(current_setting('app.actor',true),''),current_user));
  RETURN NEW;
END $$;
CREATE TRIGGER agent_link_history AFTER INSERT OR UPDATE ON __catalog__.agent_identity_links
  FOR EACH ROW EXECUTE FUNCTION __catalog__.record_link_event();
CREATE TRIGGER skill_link_history AFTER INSERT OR UPDATE ON __catalog__.legacy_skill_links
  FOR EACH ROW EXECUTE FUNCTION __catalog__.record_link_event();
CREATE FUNCTION __catalog__.touch_skill_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at=clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER skill_link_updated BEFORE UPDATE ON __catalog__.legacy_skill_links
  FOR EACH ROW EXECUTE FUNCTION __catalog__.touch_skill_link();
