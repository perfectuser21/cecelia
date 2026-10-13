// 固定依赖治理 schema 原件；只由隔离安装器显式执行。
export const runtimeVersionGraphSql = String.raw`-- 版本原件留在原表，本层只记录带真实外键的版本引用与固定依赖。
CREATE TABLE __catalog__.agent_configuration_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),agent_id uuid NOT NULL REFERENCES __catalog__.agent_identities(id),
 source_repo text NOT NULL CHECK(length(trim(source_repo))>0),source_path text NOT NULL CHECK(length(trim(source_path))>0),
 source_commit text NOT NULL CHECK(source_commit ~ '^[0-9a-f]{40}$'),manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
 executor_kind text NOT NULL CHECK(length(trim(executor_kind))>0),model_provider text NOT NULL CHECK(length(trim(model_provider))>0),model_name text NOT NULL CHECK(length(trim(model_name))>0),
 actor text NOT NULL CHECK(length(trim(actor))>0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(agent_id,id),
 UNIQUE(agent_id,source_repo,source_path,source_commit,manifest_sha256)
);
CREATE TABLE __catalog__.implementation_components(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),component_key text NOT NULL UNIQUE CHECK(length(trim(component_key))>0),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE __catalog__.implementation_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),component_id uuid NOT NULL REFERENCES __catalog__.implementation_components(id),
 source_repo text NOT NULL CHECK(length(trim(source_repo))>0),source_path text NOT NULL CHECK(length(trim(source_path))>0),
 source_commit text NOT NULL CHECK(source_commit ~ '^[0-9a-f]{40}$'),artifact_sha256 text NOT NULL CHECK(artifact_sha256 ~ '^[0-9a-f]{64}$'),
 actor text NOT NULL CHECK(length(trim(actor))>0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(component_id,id),
 UNIQUE(component_id,source_repo,source_path,source_commit,artifact_sha256)
);
CREATE TABLE __catalog__.version_refs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN('workflow_definition','activity_contract','activity_build','skill_source','agent_configuration','implementation')),
 object_id uuid NOT NULL,source_version_id uuid NOT NULL,
 workflow_definition_id uuid,activity_contract_id uuid,activity_build_id uuid,skill_source_id uuid,agent_configuration_id uuid,implementation_id uuid,
 FOREIGN KEY(object_id,workflow_definition_id) REFERENCES __source__.workflow_definition_versions(workflow_id,id),
 FOREIGN KEY(object_id,activity_contract_id) REFERENCES __source__.activity_versions(activity_id,id),
 FOREIGN KEY(object_id,activity_build_id) REFERENCES __source__.activity_definition_versions(activity_id,id),
 FOREIGN KEY(object_id,skill_source_id) REFERENCES __catalog__.skill_source_versions(skill_id,id),
 FOREIGN KEY(object_id,agent_configuration_id) REFERENCES __catalog__.agent_configuration_versions(agent_id,id),
 FOREIGN KEY(object_id,implementation_id) REFERENCES __catalog__.implementation_versions(component_id,id),
 CHECK(num_nonnulls(workflow_definition_id,activity_contract_id,activity_build_id,skill_source_id,agent_configuration_id,implementation_id)=1),
 CHECK(source_version_id=CASE kind WHEN 'workflow_definition' THEN workflow_definition_id WHEN 'activity_contract' THEN activity_contract_id
   WHEN 'activity_build' THEN activity_build_id WHEN 'skill_source' THEN skill_source_id WHEN 'agent_configuration' THEN agent_configuration_id WHEN 'implementation' THEN implementation_id END),
 -- CASE为NULL时CHECK会放行，因此类型与非空列还需独立锁定。
 CHECK((kind='workflow_definition')=(workflow_definition_id IS NOT NULL) AND (kind='activity_contract')=(activity_contract_id IS NOT NULL)
   AND (kind='activity_build')=(activity_build_id IS NOT NULL) AND (kind='skill_source')=(skill_source_id IS NOT NULL)
   AND (kind='agent_configuration')=(agent_configuration_id IS NOT NULL) AND (kind='implementation')=(implementation_id IS NOT NULL)),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(kind,source_version_id)
);
CREATE TABLE __catalog__.version_edges(
 consumer_id uuid NOT NULL REFERENCES __catalog__.version_refs(id),dependency_id uuid NOT NULL REFERENCES __catalog__.version_refs(id),
 relation text NOT NULL CHECK(relation IN('contract','implements','uses_source','uses_configuration','executes_implementation')),
 actor text NOT NULL CHECK(length(trim(actor))>0),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(consumer_id,dependency_id),CHECK(consumer_id<>dependency_id)
);
CREATE TABLE __catalog__.version_seals(
 version_id uuid PRIMARY KEY REFERENCES __catalog__.version_refs(id),dependency_sha256 text NOT NULL,
 actor text NOT NULL CHECK(length(trim(actor))>0),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION __catalog__.lock_version_graph(p_schema text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('transaction_isolation') NOT IN('read committed','read uncommitted') THEN
  RAISE EXCEPTION '版本图写入必须使用READ COMMITTED' USING ERRCODE='25000';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_schema,'version-graph')::text,621));
END $$;
CREATE FUNCTION __catalog__.guard_version_edge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; d record; cycle boolean;
BEGIN
 PERFORM __catalog__.lock_version_graph(TG_TABLE_SCHEMA);
 SELECT * INTO c FROM __catalog__.version_refs WHERE id=NEW.consumer_id;
 SELECT * INTO d FROM __catalog__.version_refs WHERE id=NEW.dependency_id;
 IF c.id IS NULL OR d.id IS NULL THEN RAISE EXCEPTION '版本引用不存在' USING ERRCODE='23503'; END IF;
 IF EXISTS(SELECT 1 FROM __catalog__.version_seals WHERE version_id=c.id) THEN RAISE EXCEPTION '已封存版本不能追加依赖' USING ERRCODE='23514'; END IF;
 IF NOT(CASE NEW.relation
  WHEN 'contract' THEN c.kind='workflow_definition' AND d.kind='activity_contract'
  WHEN 'implements' THEN c.kind='activity_build' AND d.kind='activity_contract' AND c.object_id=d.object_id
  WHEN 'uses_source' THEN c.kind IN('activity_build','agent_configuration','implementation','skill_source') AND d.kind='skill_source'
  WHEN 'uses_configuration' THEN c.kind IN('activity_build','agent_configuration','implementation') AND d.kind='agent_configuration'
  WHEN 'executes_implementation' THEN c.kind IN('activity_build','agent_configuration','implementation') AND d.kind='implementation'
  ELSE false END) THEN RAISE EXCEPTION '版本依赖类型不匹配' USING ERRCODE='23514'; END IF;
 IF NEW.relation='implements' AND NOT EXISTS(SELECT 1 FROM __source__.activity_version_builds
   WHERE build_id=c.source_version_id AND activity_version_id=d.source_version_id AND activity_id=c.object_id) THEN
  RAISE EXCEPTION '构建与契约绑定须来自原件' USING ERRCODE='23514';
 END IF;
 WITH RECURSIVE reach(id) AS(SELECT NEW.dependency_id UNION SELECT e.dependency_id FROM __catalog__.version_edges e JOIN reach r ON e.consumer_id=r.id)
 SELECT EXISTS(SELECT 1 FROM reach WHERE id=NEW.consumer_id) INTO cycle;
 IF cycle THEN RAISE EXCEPTION '版本依赖不能成环' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checked_version_edge BEFORE INSERT ON __catalog__.version_edges FOR EACH ROW EXECUTE FUNCTION __catalog__.guard_version_edge();
CREATE FUNCTION __catalog__.seal_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text; body text;
BEGIN
 PERFORM __catalog__.lock_version_graph(TG_TABLE_SCHEMA);
 SELECT v.kind INTO kind FROM __catalog__.version_refs v WHERE v.id=NEW.version_id;
 IF kind IS NULL THEN RAISE EXCEPTION '版本引用不存在' USING ERRCODE='23503'; END IF;
 IF EXISTS(SELECT 1 FROM __catalog__.version_edges e LEFT JOIN __catalog__.version_seals s ON s.version_id=e.dependency_id WHERE e.consumer_id=NEW.version_id AND s.version_id IS NULL)
  THEN RAISE EXCEPTION '依赖尚未封存' USING ERRCODE='23514'; END IF;
 IF kind='workflow_definition' AND NOT EXISTS(SELECT 1 FROM __catalog__.version_edges WHERE consumer_id=NEW.version_id AND relation='contract')
  THEN RAISE EXCEPTION '空Workflow不能封存执行依赖' USING ERRCODE='23514'; END IF;
 IF kind='activity_build' AND ((SELECT count(*) FROM __catalog__.version_edges WHERE consumer_id=NEW.version_id AND relation='implements')<>1
   OR NOT EXISTS(SELECT 1 FROM __catalog__.version_edges WHERE consumer_id=NEW.version_id AND relation IN('uses_source','executes_implementation')))
  THEN RAISE EXCEPTION 'Activity构建缺契约或执行来源' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('dependency_id',dependency_id,'relation',relation) ORDER BY dependency_id,relation),'[]'::jsonb)::text INTO body
  FROM __catalog__.version_edges WHERE consumer_id=NEW.version_id;
 NEW.dependency_sha256=encode(sha256(convert_to(body,'UTF8')),'hex');RETURN NEW;
END $$;
CREATE TRIGGER checked_version_seal BEFORE INSERT ON __catalog__.version_seals FOR EACH ROW EXECUTE FUNCTION __catalog__.seal_version();
CREATE FUNCTION __catalog__.validate_frozen_slots(slots jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item jsonb;
BEGIN
 IF jsonb_typeof(slots) IS DISTINCT FROM 'array' OR jsonb_array_length(slots)=0 THEN RAISE EXCEPTION '固定slot必须非空数组' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(slots) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'slot_key') IS DISTINCT FROM 'string' OR length(trim(item->>'slot_key'))=0
   OR jsonb_typeof(item->'sequence_no') IS DISTINCT FROM 'number' OR (item->>'sequence_no') !~ '^[1-9][0-9]*$'
   OR jsonb_typeof(item->'activity_id') IS DISTINCT FROM 'string' OR (item->>'activity_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(item->'activity_version_id') IS DISTINCT FROM 'string' OR (item->>'activity_version_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   THEN RAISE EXCEPTION '固定slot成员不完整或非法' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(slots) e GROUP BY e->>'slot_key' HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(slots) e GROUP BY e->>'sequence_no' HAVING count(*)>1)
  THEN RAISE EXCEPTION 'slot或顺序不能重复' USING ERRCODE='23514'; END IF;
END $$;
CREATE TABLE __catalog__.execution_compositions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workflow_id uuid NOT NULL,workflow_definition_id uuid NOT NULL,
 recipe_id bigint NOT NULL REFERENCES __source__.workflow_production_recipes(id),
 agent_id uuid NOT NULL,agent_configuration_id uuid NOT NULL,implementation_component_id uuid NOT NULL,implementation_version_id uuid NOT NULL,
 build_bindings jsonb NOT NULL,member_refs uuid[],composition_sha256 text,
 actor text NOT NULL CHECK(length(trim(actor))>0),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workflow_id,workflow_definition_id) REFERENCES __source__.workflow_definition_versions(workflow_id,id),
 FOREIGN KEY(agent_id,agent_configuration_id) REFERENCES __catalog__.agent_configuration_versions(agent_id,id),
 FOREIGN KEY(implementation_component_id,implementation_version_id) REFERENCES __catalog__.implementation_versions(component_id,id),
 UNIQUE(workflow_id,composition_sha256)
);
CREATE FUNCTION __catalog__.freeze_composition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipe jsonb; snapshot jsonb; frozen jsonb; expected_contract uuid; item jsonb; binding jsonb; build record; contract uuid; wf uuid; cfg uuid; impl uuid;
 roots uuid[]; contracts uuid[]='{}'; expected uuid[]; members uuid[]; body jsonb;
BEGIN
 PERFORM __catalog__.lock_version_graph(TG_TABLE_SCHEMA);
 SELECT r.recipe INTO recipe FROM __source__.workflow_production_recipes r WHERE r.id=NEW.recipe_id AND r.workflow_id=NEW.workflow_id;
 PERFORM __catalog__.validate_frozen_slots(recipe);
 SELECT w.payload->'activities' INTO snapshot FROM __source__.workflow_definition_versions w WHERE w.id=NEW.workflow_definition_id AND w.workflow_id=NEW.workflow_id;
 PERFORM __catalog__.validate_frozen_slots(snapshot);
 IF jsonb_array_length(snapshot)<>jsonb_array_length(recipe) THEN RAISE EXCEPTION 'Recipe槽位数与Workflow原件不一致' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.build_bindings) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.build_bindings)<>jsonb_array_length(recipe)
  THEN RAISE EXCEPTION '必须逐slot绑定构建' USING ERRCODE='23514'; END IF;
 SELECT id INTO wf FROM __catalog__.version_refs WHERE kind='workflow_definition' AND source_version_id=NEW.workflow_definition_id AND object_id=NEW.workflow_id;
 SELECT id INTO cfg FROM __catalog__.version_refs WHERE kind='agent_configuration' AND source_version_id=NEW.agent_configuration_id AND object_id=NEW.agent_id;
 SELECT id INTO impl FROM __catalog__.version_refs WHERE kind='implementation' AND source_version_id=NEW.implementation_version_id AND object_id=NEW.implementation_component_id;
 IF wf IS NULL OR cfg IS NULL OR impl IS NULL THEN RAISE EXCEPTION '组合根版本尚未登记' USING ERRCODE='23514'; END IF;
 roots=ARRAY[wf,cfg,impl];
 FOR binding IN SELECT value FROM jsonb_array_elements(NEW.build_bindings) LOOP
  IF jsonb_typeof(binding) IS DISTINCT FROM 'object' OR (binding-'slot_key'-'build_ref')<>'{}'::jsonb
   OR jsonb_typeof(binding->'slot_key') IS DISTINCT FROM 'string' OR length(trim(binding->>'slot_key'))=0
   OR jsonb_typeof(binding->'build_ref') IS DISTINCT FROM 'string' OR (binding->>'build_ref') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   THEN RAISE EXCEPTION 'slot构建声明非法' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.build_bindings) e GROUP BY e->>'slot_key' HAVING count(*)>1)
  THEN RAISE EXCEPTION 'slot不能重复' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(recipe) LOOP
  SELECT value INTO frozen FROM jsonb_array_elements(snapshot) WHERE value->>'slot_key'=item->>'slot_key';
  IF frozen IS NULL OR frozen->>'sequence_no' IS DISTINCT FROM item->>'sequence_no' OR frozen->>'activity_id' IS DISTINCT FROM item->>'activity_id'
   THEN RAISE EXCEPTION 'Recipe改变了Workflow固定槽位、顺序或Activity' USING ERRCODE='23514'; END IF;
  -- 原Workflow快照的activity_version_id属于定义构建族；Recipe引用内容契约族，两者须由原件映射连接。
  SELECT b.activity_version_id INTO expected_contract FROM __source__.activity_version_builds b
    WHERE b.build_id=(frozen->>'activity_version_id')::uuid AND b.activity_id=(frozen->>'activity_id')::uuid;
  IF expected_contract IS NULL OR expected_contract IS DISTINCT FROM (item->>'activity_version_id')::uuid
   THEN RAISE EXCEPTION 'Recipe契约与Workflow快照不兼容' USING ERRCODE='23514'; END IF;
  SELECT value INTO binding FROM jsonb_array_elements(NEW.build_bindings) WHERE value->>'slot_key'=item->>'slot_key';
  IF binding IS NULL THEN RAISE EXCEPTION 'slot构建缺失' USING ERRCODE='23514'; END IF;
  SELECT * INTO build FROM __catalog__.version_refs WHERE id=(binding->>'build_ref')::uuid AND kind='activity_build';
  IF build.id IS NULL OR build.object_id IS DISTINCT FROM (item->>'activity_id')::uuid THEN RAISE EXCEPTION 'slot构建不属于目标Activity' USING ERRCODE='23514'; END IF;
  SELECT v.id INTO contract FROM __catalog__.version_edges e JOIN __catalog__.version_refs v ON v.id=e.dependency_id
   WHERE e.consumer_id=build.id AND e.relation='implements' AND v.source_version_id=(item->>'activity_version_id')::uuid;
  IF contract IS NULL THEN RAISE EXCEPTION '构建不实现Recipe固定契约' USING ERRCODE='23514'; END IF;
  roots=array_append(roots,build.id);contracts=array_append(contracts,contract);
 END LOOP;
 SELECT array_agg(DISTINCT id ORDER BY id) INTO contracts FROM unnest(contracts) id;
 SELECT array_agg(dependency_id ORDER BY dependency_id) INTO expected FROM __catalog__.version_edges WHERE consumer_id=wf AND relation='contract';
 IF contracts IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Workflow固定契约与Recipe不一致' USING ERRCODE='23514'; END IF;
 WITH RECURSIVE closure(id) AS(SELECT unnest(roots) UNION SELECT e.dependency_id FROM __catalog__.version_edges e JOIN closure c ON c.id=e.consumer_id)
 SELECT array_agg(id ORDER BY id) INTO members FROM closure;
 IF EXISTS(SELECT 1 FROM unnest(members) id LEFT JOIN __catalog__.version_seals s ON s.version_id=id WHERE s.version_id IS NULL)
  THEN RAISE EXCEPTION '组合存在未封存依赖' USING ERRCODE='23514'; END IF;
 SELECT jsonb_agg(value ORDER BY (value->>'slot_key') COLLATE "C") INTO NEW.build_bindings FROM jsonb_array_elements(NEW.build_bindings);
 NEW.member_refs=members;
 body=jsonb_build_object('workflow_definition',wf,'recipe',NEW.recipe_id,'agent_configuration',cfg,'implementation',impl,'build_bindings',NEW.build_bindings,'members',members);
 NEW.composition_sha256=encode(sha256(convert_to(body::text,'UTF8')),'hex');RETURN NEW;
END $$;
CREATE TRIGGER checked_composition BEFORE INSERT ON __catalog__.execution_compositions FOR EACH ROW EXECUTE FUNCTION __catalog__.freeze_composition();
CREATE TABLE __catalog__.catalog_structure_seals(
 module text PRIMARY KEY REFERENCES __catalog__.catalog_versions(module),fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION __catalog__.validate_git_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF left(NEW.source_path,1)='/' OR NEW.source_path ~ '^[A-Za-z]:' OR position(chr(92) IN NEW.source_path)>0 OR string_to_array(NEW.source_path,'/') && ARRAY['..','.','']
  THEN RAISE EXCEPTION 'Git来源必须为规范相对路径' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER config_git_path BEFORE INSERT ON __catalog__.agent_configuration_versions FOR EACH ROW EXECUTE FUNCTION __catalog__.validate_git_location();
CREATE TRIGGER implementation_git_path BEFORE INSERT ON __catalog__.implementation_versions FOR EACH ROW EXECUTE FUNCTION __catalog__.validate_git_location();
DO $$ DECLARE table_name text;BEGIN
 FOREACH table_name IN ARRAY ARRAY['agent_configuration_versions','implementation_components','implementation_versions','version_refs','version_edges','version_seals','execution_compositions','catalog_structure_seals'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_version_graph BEFORE UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION __catalog__.reject_history_change()', '__CATALOG_NAME__',table_name);
 END LOOP;
END $$;
`;
