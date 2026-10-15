import {randomUUID} from 'node:crypto';
import {versionsDatabase} from './definition-versions-db.js';
import {migrationTable} from './minimum-definition-schema.js';
import {submitAuthoring} from '../../workflow-authoring/store.js';
import {registerWorkflow,validateReferences,registrationDigest} from '../../workflow-authoring/registration.js';
export const ASSEMBLY_TABLES=['workflows','activities','steps','workflow_activity_refs','warehouse_items','activity_uses','activity_definition_versions','workflow_definition_versions','activity_versions','activity_version_builds','activity_release_state','activity_release_events','workflow_production_recipes','tasks'];
const schema=(...names)=>({type:'object',properties:Object.fromEntries(names.map(n=>[n,{type:'string'}])),required:names});
export async function assemblyDatabase(){
 const f=await versionsDatabase();
 try{
  await f.migrate();const db=f.db;
  await db.query(migrationTable('283_skill_registry_and_journey_step_links.sql','skill_registry'));
  await db.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS claimed_by text,ADD COLUMN IF NOT EXISTS result jsonb');
  await db.query(`ALTER TABLE warehouse_items ADD COLUMN shelf text,ADD COLUMN source_table text,ADD COLUMN source_ref text;
   ALTER TABLE activities ADD COLUMN inputs jsonb,ADD COLUMN outputs jsonb,ADD COLUMN preconditions jsonb,ADD COLUMN invariants jsonb,ADD COLUMN nfr jsonb,ADD COLUMN failure jsonb,ADD COLUMN readback jsonb;`);
  for(const table of ['activity_versions','activity_version_builds','activity_release_state','activity_release_events','workflow_production_recipes'])await db.query(migrationTable('541_release_line.sql',table));
  const cap=randomUUID(),skill=randomUUID(),vs=randomUUID();
  await db.query("INSERT INTO value_streams(id,name) VALUES($1,'隔离装配价值流')",[vs]);
  await db.query("INSERT INTO capabilities(id,name,parent_journey_id,status) VALUES($1,'隔离装配能力',$2,'active')",[cap,vs]);
  await db.query("INSERT INTO skill_registry(id,name,location,status) VALUES($1,'assembly-fixture','/fixture/SKILL.md','active')",[skill]);
  const documents=new Map();
  function definition(key='assembly.report',revision='a'.repeat(40)){
   return {key,name:'隔离装配报告',capability_id:cap,channel:'internal',form:'code',version:'1.0.0',source:{repo:'perfectuser21/cecelia',ref:`contracts/${key}.json`,revision},
    runtime:{skill_id:skill,entrypoint:'report',transport:'script'},input_schema:schema('topic'),output_schema:schema('report'),
    warehouse_items:[{key:'assembly.renderer',name:'报告渲染器',kind:'code',shelf:'generic_action',impl_ref:'src/render.js'}],
    activities:[{key:'render',name:'生成报告',executor_kind:'code',acceptance:['读回报告'],input_schema:schema('topic'),output_schema:schema('report'),
     implementation:{kind:'code',ref:'src/render.js',version:'1.0.0',repo:'perfectuser21/cecelia',path:'src/render.js',revision:'contract'},
     warehouse_dependencies:[{key:'assembly.renderer'}],steps:[{key:'read',name:'读回',reads:['topic'],writes:['report'],dod:{readback:{type:'sql',query:'SELECT 1'}}}]}]};
  }
  async function submit(d,{operation='create',expectedVersion,workflowId}={}){
   const {source,...document}=d;documents.set(`${source.revision}:${source.ref}`,JSON.stringify(document));
   const id=randomUUID(),state={schema_version:1,stage:'register',revision:5,request:{operation,actor:'fixture:assembly',goal:'隔离验收',registration_protocol:'definition-freeze-v1',assembly_mode:true,expected_version:expectedVersion},outputs:{compose:{definition:d,definition_sha256:registrationDigest(d)},intake:{workflow_id:workflowId}},receipts:[]};
   await db.query("INSERT INTO tasks(id,title,status,claimed_by,payload,result) VALUES($1,'隔离装配验收','in_progress','fixture', $2,$3)",[id,{workflow_authoring:true},{workflow_authoring:state}]);
   const body={stage:'register',revision:5,submission_id:'register-1',output:{}};
   const deps={registerWorkflow,validateReferences,freezeOptions:{readFile:async s=>documents.get(`${s.revision}:${s.path}`)??'export const render = true;'}};
   return {id,run:()=>submitAuthoring(db,id,body,deps)};
  }
  async function snapshot(){const out={};for(const table of ASSEMBLY_TABLES)out[table]=(await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows.map(x=>x.row);return out;}
  return {...f,definition,submit,snapshot,documents};
 }catch(e){await f.close();throw e;}
}
