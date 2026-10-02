import { randomUUID } from 'node:crypto';
import { releaseEvidenceDatabase, RELEASE_HEAD } from './release-evidence-db.js';
import { IMPACT_REPO } from './implementation-impact-db.js';

export async function coverageDatabase() {
  const f = await releaseEvidenceDatabase();
  try {
    for (const table of ['skill_registry', 'api_registry', 'journey_features', 'fact_snapshot_headers']) {
      await f.db.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`);
    }
    // resources 为既有生产台账；scratch 未初始化此历史表，仅建立隔离夹具。
    await f.db.query('CREATE TABLE resources(id uuid PRIMARY KEY,category text,name text,area_id uuid,config jsonb,notes text,tags text[])');
    const activity = f.activities.find(a => a.payload.implementation_bindings.some(b => b.kind === 'code'));
    const binding = activity.payload.implementation_bindings.find(b => b.kind === 'code');
    const ids = Object.fromEntries(['skill', 'retiredSkill', 'api', 'oldApi', 'otherApi', 'resource', 'feature', 'legacyFeature'].map(k => [k, randomUUID()]));
    await f.db.query(`INSERT INTO fact_snapshot_headers(kind,repo,source_revision,scanner_version,row_count,scanned_at)
      VALUES('graph','phone-source',$1,'fixture',1,NOW())`, [RELEASE_HEAD]);
    await f.db.query(`INSERT INTO skill_registry(id,name,status,source_path,content_digest,metadata,content_md,dispatch_command)
      VALUES($1,'controller','active','src/controller.js',$3,'{"workflow_id":"PRIVATE_METADATA"}','PRIVATE_CONTENT','PRIVATE_COMMAND'),
      ($2,'retired skill','deprecated',NULL,NULL,'{}',NULL,NULL)`, [ids.skill, ids.retiredSkill, binding.content_sha256]);
    await f.db.query(`INSERT INTO api_registry(id,repo,method,path,file_path,source_revision,request_schema)
      VALUES($1,'phone-source','GET','/controller','src/controller.js',$4,'{"token":"PRIVATE_API"}'),
      ($2,'phone-source','GET','/old','src/controller.js',$5,'{}'),
      ($3,'unregistered','GET','/other','src/controller.js',$4,'{}')`, [ids.api, ids.oldApi, ids.otherApi, RELEASE_HEAD, 'a'.repeat(40)]);
    await f.db.query(`INSERT INTO resources VALUES($1,'service','resource',NULL,'{"token":"PRIVATE_CONFIG"}','PRIVATE_NOTES','{}')`, [ids.resource]);
    await f.db.query(`INSERT INTO ops_workflows(source,wf_id,name,active,workflow_id,meta,dispatch)
      VALUES('scheduler','bound','bound schedule',false,$1,'{"secret":"PRIVATE_META"}','{"command":"PRIVATE_DISPATCH"}'),
      ('scheduler','unbound','same name as workflow',true,NULL,'{}','{}')`, [f.workflows[0].workflow_id]);
    await f.db.query(`INSERT INTO journey_features(id,name,step_id,status) VALUES($1,'linked feature',$3,'done'),($2,'old feature',NULL,'deprecated')`, [ids.feature, ids.legacyFeature, activity.activity_id]);
    return { ...f, coverageIds: ids, coverageActivity: activity, coverageSource: { repo: IMPACT_REPO, path: binding.path, revision: RELEASE_HEAD, digest: binding.digest } };
  } catch (error) { await f.close(); throw error; }
}
