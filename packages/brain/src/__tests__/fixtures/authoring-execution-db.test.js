import express from 'express';
import request from 'supertest';
import {createWorkflowAuthoringRouter} from '../../routes/workflow-authoring.js';
import {prepareInvocationDispatch,guardInvocationCallback} from '../../invocations/runtime.js';
import {finishRun} from '../../lib/task-run.js';
import {finalizeTask} from '../../lib/task-terminal.js';
import {it,expect} from 'vitest';
import {requireCandidateEnvironment} from '../../workflow-authoring/assembly-orchestration.js';
import {createIntakeTestDatabase} from './task-intake-db.js';
import {randomUUID} from 'node:crypto';
/** 全部对象和执行账均为scratch私有schema，生产结构只读复制，结束完整删除。 */
export async function authoringExecutionDatabase(){
 const f=await createIntakeTestDatabase();
 try{
  for(const table of ['value_streams','capabilities','workflows','activities','steps','workflow_activity_refs','warehouse_items','activity_uses',
   'skill_registry','activity_definition_versions','workflow_definition_versions','activity_versions','activity_version_builds',
   'release_versions','activity_release_state','activity_release_events','workflow_production_recipes','task_events','task_runs','spans','runs'])
   await f.pool.query(`CREATE TABLE ${f.schema}.${table}(LIKE public.${table} INCLUDING ALL)`);
  // LIKE不复制外键；明确恢复实际执行对象的归属约束，防候选UUID无实体也伪造span。
  await f.pool.query('ALTER TABLE spans ADD FOREIGN KEY(activity_id) REFERENCES activities(id),ADD FOREIGN KEY(step_id) REFERENCES steps(id),ADD FOREIGN KEY(workflow_id) REFERENCES workflows(id)');
  await f.pool.query('CREATE TRIGGER spans_ensure_run BEFORE INSERT ON spans FOR EACH ROW EXECUTE FUNCTION public.spans_ensure_run()');
  await f.pool.query('ALTER TABLE spans ADD FOREIGN KEY(run_id) REFERENCES runs(run_id)');
  const cap=randomUUID(),skill=randomUUID(),vs=randomUUID();
  await f.pool.query("INSERT INTO value_streams(id,name) VALUES($1,'隔离候选价值流')",[vs]);
  await f.pool.query("INSERT INTO capabilities(id,name,parent_journey_id,status) VALUES($1,'隔离候选能力',$2,'active')",[cap,vs]);
  await f.pool.query("INSERT INTO skill_registry(id,name,location,status) VALUES($1,'authoring-pure','fixture/SKILL.md','active')",[skill]);
  const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
  const definition={key:`pure${cap.slice(0,8)}`,name:'纯Skill候选',capability_id:cap,channel:'internal',form:'code',version:'1.0.0',
   source:{repo:'perfectuser21/cecelia',ref:'contracts/pure.json',revision:'a'.repeat(40)},runtime:{skill_id:skill,entrypoint:'pure',transport:'codex-bridge'},
   input_schema:schema,output_schema:schema,activities:[{key:'uppercase',name:'大写',executor_kind:'agent',mutation_intent:'none',acceptance:['大写结果'],
    input_schema:schema,output_schema:schema,
    implementation:{kind:'skill',skill_id:skill,ref:'skills/pure/SKILL.md',path:'skills/pure/SKILL.md',version:'1.0.0',repo:'perfectuser21/cecelia',revision:'contract'}}]};
  const content='---\nname: authoring-pure\nversion: 1.0.0\n---\n仅把输入text转成大写，输出text字段。禁止工具、文件、消息及其它副作用。';
  const reader=async(s,options={})=>{
   if(s.repo!==definition.source.repo||s.revision!==definition.source.revision)throw Error('fixture_source_unknown');
   if(s.path===definition.source.ref)return JSON.stringify(Object.fromEntries(Object.entries(definition).filter(([k])=>k!=='source')));
   if(s.path==='skills/pure/SKILL.md')return content;
   if(s.path==='.skills-source.json'&&options.allowMissing===true)return null;
   throw Error('fixture_file_missing');
  };
  return {...f,definition,reader,content,skill};
 }catch(error){await f.close();throw error;}
}

it('候选fixture遵守实际库边界，生产同名schema不能当scratch',async()=>{await expect(requireCandidateEnvironment({query:async()=>({rows:[{name:'cecelia'}]})})).rejects.toMatchObject({code:'candidate_environment_unsupported'});});

export async function startPureAuthoring(f,invocationOptions={},tenantId='default'){
 const id=randomUUID();
 if(tenantId!=='default')f.definition.tenant_id=tenantId;
 await f.pool.query("INSERT INTO tasks(id,title,status,task_type,claimed_by,payload) VALUES($1,$2,'in_progress','research','fixture',$3)",[id,`自动装配${id}`,{workflow_authoring:true,tenant_id:tenantId}]);
 const app=express();app.use(express.json());app.use('/api/brain/workflow-authoring',createWorkflowAuthoringRouter({db:f.pool,freezeOptions:{readFile:f.reader},invocationOptions:{readFile:f.reader,probeRuntime:async()=>({ready:true}),...invocationOptions}}));
 const post=(path,body)=>{const call=request(app).post(`/api/brain/workflow-authoring/runs/${id}${path}`).set('x-tenant-id',tenantId);
  if(process.env.CECELIA_INTERNAL_TOKEN)call.set('x-internal-token',process.env.CECELIA_INTERNAL_TOKEN);return call.send(body);};
 let initialized=await post('/init',{operation:'create',goal:'无副作用纯Skill自动装配',actor:'fixture',assembly_mode:true,registration_protocol:'definition-freeze-v1',execution_protocol:'workflow-authoring-execution-v1',validation_input:{text:'abc'}});
 expect(initialized.status).toBe(200);
 const submit=async(stage,output,revision)=>{const r=await post('/submit',{stage,output,revision,submission_id:`${stage}-one`});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;};
 await submit('intake',{goal:'纯Skill产物验真',inputs:['text'],outputs:['text'],acceptance:['ABC'],capability_id:f.definition.capability_id},0);
 await submit('reuse',{search_terms:['pure'],candidates:[{kind:'skill',id:f.skill,decision:'reuse',reason:'已有固定纯Skill'}]},1);
 const compose=await submit('compose',{definition:f.definition},2);
 return {id,app,post,compose};
}

export async function settleInvocation(f,taskId,actualOutput){
 const task=(await f.pool.query('SELECT * FROM tasks WHERE id=$1',[taskId])).rows[0],runId=`authoring-${randomUUID()}`;
 const options={readFile:f.reader,probeRuntime:async()=>({ready:true})};
 const {envelope:e}=await prepareInvocationDispatch(f.pool,task,runId,options);
 const result=typeof actualOutput==='function'?await actualOutput(task,runId):actualOutput??{protocol:'skill-invocation-result-v1',task_id:taskId,run_id:runId,tenant_id:e.tenant_id,target:e.target,input_sha256:e.input_sha256,
  activities:e.activities.map(a=>({key:a.key,skill_sha256:a.skill_sha256,outputs:{text:'ABC'}})),outputs:{text:'ABC'}};
 await guardInvocationCallback(f.pool,{task_id:taskId,run_id:runId,status:'AI Done',result});
 await finishRun({runId,status:'success',exitCode:0,result:{source:actualOutput?'actual-codex-cli':'callback-contract-regression'}},{pool:f.pool});
 await finalizeTask(f.pool,taskId,'completed',{relay:false});
 return runId;
}

it('历史无锁fixture只在显式allowMissing时证明锁缺失，未知正文路径不可冒充Skill',async()=>{
 const f=await authoringExecutionDatabase();
 try{
  const source={repo:f.definition.source.repo,revision:f.definition.source.revision,path:'.skills-source.json'};
  expect(await f.reader(source,{allowMissing:true})).toBeNull();
  await expect(f.reader(source)).rejects.toThrow('fixture_file_missing');
  await expect(f.reader({...source,path:'unknown/SKILL.md'})).rejects.toThrow('fixture_file_missing');
  expect(await f.reader({...source,path:'skills/pure/SKILL.md'})).toBe(f.content);
 }finally{await f.close();}
});
