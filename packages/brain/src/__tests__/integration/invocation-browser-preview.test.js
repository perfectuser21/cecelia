import {it,expect} from 'vitest';
/** 受控验收夹具：scratch私有schema + 本机HTTP；stdin单次驱动既有Bridge进程，无轮询或生产注册。 */
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createIntakeTestDatabase } from '../fixtures/task-intake-db.js';
import { createInvocationsRouter } from '../../routes/invocations.js';
import { definitionDigest } from '../../workflow-authoring/contracts.js';
import { prepareInvocationDispatch,invocationTaskPrompt,guardInvocationCallback } from '../../invocations/runtime.js';
import { finishRun } from '../../lib/task-run.js';
import { finalizeTask } from '../../lib/task-terminal.js';

it.runIf(process.env.INVOCATION_BROWSER_PREVIEW==='1')('受控scratch浏览器候选调用服务',async()=>{
if(process.env.DB_NAME!=='cecelia_scratch'||process.env.DB_HOST!=='/tmp')throw Error('本夹具只接受本机scratch');
const directory=mkdtempSync(join(tmpdir(),'invocation-browser-fixture-'));
const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const content='---\nname: pure-uppercase\nversion: 1.0.0\n---\n只对输入text转成大写，输出text字段；不调用工具、不写文件、不发送消息。';
mkdirSync(join(directory,'skills/pure'),{recursive:true});writeFileSync(join(directory,'skills/pure/SKILL.md'),content);
git(['init','-b','cp-10152144-invocation-preview-fixture']);git(['config','user.name','Invocation fixture']);git(['config','user.email','fixture@example.invalid']);git(['add','skills/pure/SKILL.md']);git(['commit','-m','test: fixed pure skill']);
const commit=git(['rev-parse','HEAD']);
const fixture=await createIntakeTestDatabase(),db=fixture.pool;
for(const table of ['task_events','task_runs','skill_registry','activity_definition_versions','workflow_definition_versions','warehouse_items','workflows','activities'])await db.query(`CREATE TABLE ${fixture.schema}.${table}(LIKE public.${table} INCLUDING ALL)`);
const taskId=randomUUID(),activityId=randomUUID(),skillId=randomUUID();
const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
const activity={id:activityId,key:'uppercase',name:'纯Skill大写转换',executor_kind:'agent',runtime:{transport:'codex-bridge'},mutation_intent:'none',input_schema:schema,output_schema:schema,acceptance:['真实大写结构化产物'],implementation:{kind:'skill',skill_id:skillId,repo:'perfectuser21/cecelia',path:'skills/pure/SKILL.md',revision:commit}};
const definition={key:'preview-uppercase',name:'纯Skill候选验收',source:{repo:'perfectuser21/cecelia',ref:'flow.json',revision:commit},input_schema:schema,output_schema:schema,activities:[activity]};
const activityVersion=randomUUID(),workflowVersion=randomUUID();
await db.query('INSERT INTO workflows(id,capability_id,key,name,channel,current_definition_version_id) VALUES($1,$2,$3,$4,$5,$6)',[taskId,randomUUID(),definition.key,definition.name,'preview',workflowVersion]);
await db.query('INSERT INTO activities(id,name,contract,current_definition_version_id) VALUES($1,$2,$3,$4)',[activityId,activity.name,activity,activityVersion]);
for(const [table,id,objectId,payload]of [['activity_definition_versions',activityVersion,activityId,{activity_id:activityId,contract:activity}],['workflow_definition_versions',workflowVersion,taskId,{workflow_id:taskId,contract:definition,activities:[{slot_key:activity.key,activity_id:activityId,activity_version_id:activityVersion}]}]]){
 const kind=table.startsWith('activity')?'activity':'workflow';
 await db.query(`INSERT INTO ${table}(id,${kind}_id,payload,contract_sha256,payload_sha256,source_repo,source_path,source_commit) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,objectId,payload,definitionDigest(payload.contract),definitionDigest(payload),'perfectuser21/cecelia','flow.json',commit]);
}
await db.query('INSERT INTO skill_registry(id,name) VALUES($1,$2)',[skillId,`preview-${skillId}`]);
await db.query("INSERT INTO tasks(id,title,status,task_type,payload,result) VALUES($1,'预览纯Skill候选管理','in_progress','research',$2,$3)",[taskId,{workflow_authoring:true,tenant_id:'default'},{workflow_authoring:{request:{operation:'create'},outputs:{compose:{definition}}}}]);
const options={readFile:async source=>git(['show',`${source.revision}:${source.path}`]),probeRuntime:async()=>({ready:true,transport:'codex-bridge',machine_id:'isolated-preview'})};
const app=express();app.use(express.json());app.use('/api/brain/invocations',createInvocationsRouter({db,...options}));
app.get('/api/brain/map/registry',async(_req,res)=>{
 const workflows=(await db.query('SELECT id,key,name,current_definition_version_id FROM workflows')).rows.map(w=>({...w,activities:[]}));
 const activities=(await db.query('SELECT id,name,current_definition_version_id FROM activities')).rows.map(a=>({...a,consumers:[],implementation_bindings:[]}));
 res.json({generated_at:new Date().toISOString(),counts:{workflows:{total:workflows.length},activities:{total:activities.length}},areas:[],journeys:[],workflows,activities,steps:[],enablers:[],gaps:[],source_repos:[],preview_candidate_only:true});
});
app.get('/api/brain/invocation-preview-directory',async(_req,res)=>{
 const original=(await db.query('SELECT id,result FROM tasks WHERE id=$1',[taskId])).rows[0];
 res.json({workflow:{id:original.id,name:original.result.workflow_authoring.outputs.compose.definition.name},activity:{id:activityId,name:activity.name},authoring_task_id:taskId,compose_sha256:definitionDigest(definition)});
});
const server=await new Promise(resolve=>{const server=app.listen(Number(process.env.INVOCATION_PREVIEW_PORT??15283),'127.0.0.1',()=>resolve(server));});
const previewPort=server.address().port;
process.stdout.write(JSON.stringify({preview:true,port:server.address().port,authoring_task_id:taskId,workflow_id:taskId,activity_id:activityId,compose_sha256:definitionDigest(definition),input:{text:'abc'},expected_outputs:{text:'ABC'},schema:fixture.schema,git_commit:commit})+'\n');
const require=createRequire(import.meta.url),{executeCodex}=require('../../../scripts/codex-bridge/codex-bridge.cjs');
let running=false;
async function drive(task_id){
 if(running)throw Error('夹具一次只驱动一个显式调用');running=true;
 try{
  const task=(await db.query('SELECT * FROM tasks WHERE id=$1',[task_id])).rows[0];
  if(!task?.payload?.invocation)throw Error('不是本夹具调用任务');
  const run_id=`browser-preview-${randomUUID()}`;
  const dispatch=await prepareInvocationDispatch(db,task,run_id,options);
  if(dispatch.already)return {task_id,run_id:dispatch.runId,already:true};
  const result=await executeCodex(process.env.CODEX_HOME,invocationTaskPrompt(task,run_id),{workDir:directory,sandbox:'read-only',timeoutMs:180000});
  await guardInvocationCallback(db,{task_id,run_id,status:'AI Done',result:result.output});
  await finishRun({runId:run_id,status:'success',exitCode:0,result:{actual_process:true,duration_ms:result.elapsed}},{pool:db});
  await finalizeTask(db,task_id,'completed');
  return {task_id,run_id,actual_process:true};
 }finally{running=false;}
}
app.post('/__fixture/drive/:task_id',async(req,res)=>{
 if(req.get('x-internal-token')!==process.env.CECELIA_INTERNAL_TOKEN)return res.sendStatus(401);
 try{res.json(await drive(req.params.task_id));}catch(error){res.status(409).json({error:error.message});}
});
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{Promise.resolve().then(()=>drive(JSON.parse(line).task_id)).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>process.stderr.write(error.message+'\n'));});
let closePromise,completeStop;
const previewStopped=new Promise(resolve=>{completeStop=resolve;});
function closePreview(){
 if(!closePromise)closePromise=(async()=>{
  await new Promise(resolve=>server.close(resolve));lines.close();await fixture.close();
  rmSync(directory,{recursive:true,force:true});completeStop();
 })();
 return closePromise;
}
const stop=()=>closePreview().catch(error=>process.stderr.write(error.message+'\n'));
process.on('SIGTERM',stop);process.on('SIGINT',stop);process.on('SIGUSR2',stop);

const response=await fetch(`http://127.0.0.1:${previewPort}/api/brain/map/registry`);
const registry=await response.json();
expect(response.status).toBe(200);expect(registry.preview_candidate_only).toBe(true);expect(registry.workflows).toHaveLength(1);
await previewStopped;
},600000);
