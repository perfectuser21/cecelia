import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {assertActiveDevelopmentTask,getTaskType,TICK_DISPATCH_EXCLUDED} from '../../../../packages/brain/src/lib/task-type-registry.js';
import {assertTaskTypeHasExecutor,resolveDispatchRoute} from '../../../../packages/brain/src/lib/dispatch-route.js';
import {createRoutedTask} from '../../../../packages/brain/src/work-routing-store.js';
import {routeWork} from '../../../../packages/brain/src/work-router.js';
const root=new URL('../../../../',import.meta.url);
const source=readFileSync(new URL('scripts/ops/janitor.sh',root),'utf8');
function captured(name,setup){
 const block=source.match(new RegExp(`^  ${name}\\(\\) \\{[\\s\\S]*?^  \\}`,'m'))?.[0];assert.ok(block,`missing ${name}`);
 const dir=mkdtempSync(join(tmpdir(),'janitor-admission-'));
 try{
  const capture=join(dir,'requests');
  const script=`set -eu\nsource "$1"\ncurl(){ while [ "$#" -gt 0 ]; do if [ "$1" = -d ]; then printf '%s\\n' "$2" >> "$CAPTURE"; return; fi; shift; done; exit 97; }\nsudo(){ echo forbidden-reboot >&2; exit 98; }\nsleep(){ :; }\n${block}\n${setup}\n${name}`;
  const result=spawnSync('bash',['-c',script,'_',new URL('scripts/ops/janitor-effects.sh',root).pathname],{encoding:'utf8',env:{...process.env,HOME:dir,CAPTURE:capture,BRAIN_URL:'http://invalid.test',DRY_RUN:'false',JANITOR_NO_REBOOT:'1'}});
  assert.equal(result.status,0,result.stderr);return readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
function admit(body){
 assertActiveDevelopmentTask(body);
 const decision=routeWork({source:'api',source_id:'janitor-fixture',title:body.title,description:body.description,requested_task_type:body.task_type,declared_domain:body.domain,mutation_intent:body.mutation_intent??'read_only',metadata:body.payload??{},task:{status:body.status??'queued'}});
 assertTaskTypeHasExecutor({task_type:decision.canonical_task_type,status:body.status??'queued',payload:body.payload??{}});
 return decision;
}
test('Janitor实际CPU/kalloc请求可准入但永不取得自动执行资格',()=>{
 const requests=[...captured('check_cpu_pressure_alert','CPU_PCT=97; CPU_ALERT_THRESHOLD=85'),...captured('check_kalloc_guard','KALLOC_KB=$((5*1024*1024)); KALLOC_HOUR=10'),...captured('check_kalloc_guard','KALLOC_KB=$((7*1024*1024)); KALLOC_HOUR=10')];
 assert.equal(requests.length,3);
 for(const body of requests){
  const decision=admit(body);assert.equal(decision.canonical_task_type,'exploratory');assert.equal(body.status,'blocked');
  assert.equal(body.mutation_intent,'none');assert.equal(body.blocked_reason,'human_intervention_required');assert.deepEqual(body.payload,{alert:true,event:'janitor',manual_only:true});assert.equal(getTaskType(body.task_type).surface,'none');assert.equal(getTaskType(body.task_type).tick_dispatchable,false);assert.ok(TICK_DISPATCH_EXCLUDED.includes(body.task_type));
  admit({...body,status:'queued'});assert.deepEqual(resolveDispatchRoute({...body,status:'queued'}),{route:'own-consumer',available:true,executor:'none',reason:null});
 }
});
test('真实准入仍拒绝旧harness告警，不因blocked恢复退休类型',()=>{
 assert.throws(()=>admit({title:'old',task_type:'harness_intervention',status:'blocked',mutation_intent:'none'}),/task_type_retired/);
});

test('真实路由存储准入将告警保留为blocked账本，解锁成queued也无执行体',async()=>{
 const [body]=captured('check_cpu_pressure_alert','CPU_PCT=97; CPU_ALERT_THRESHOLD=85');
 let inserted;
 const db={query:async(sql,args=[])=>{
  if(sql.includes('INSERT INTO tasks')){inserted=args;return {rows:[{id:'fixture-task',task_type:args[3],status:args[4],blocked_reason:args[27]}]};}
  if(sql.includes('INSERT INTO work_routing_receipts'))return {rows:[{id:'fixture-receipt'}]};
  return {rows:[]};
 }};
 const result=await createRoutedTask(db,{source:'api',source_id:'janitor-fixture',title:body.title,description:body.description,requested_task_type:body.task_type,declared_domain:body.domain,mutation_intent:body.mutation_intent,metadata:body.payload,task:{status:body.status,blocked_reason:body.blocked_reason}},[]);
 assert.equal(result.task.status,'blocked');assert.equal(result.task.task_type,'exploratory');assert.equal(inserted[27],'human_intervention_required');
 assert.equal(JSON.parse(inserted[9]).manual_only,true);assert.equal(result.decision.work_kind,'operations');
 assertTaskTypeHasExecutor({...result.task,status:'queued'});assert.equal(resolveDispatchRoute(result.task).executor,'none');
});

test('真实选择器构建的SQL排除已解锁的exploratory告警（隔离SQL边界，不连PG）',async()=>{
 const text=readFileSync(new URL('packages/brain/src/dispatch-helpers.js',root),'utf8');
 const body=text.slice(text.indexOf('export async function selectNextDispatchableTask'),text.indexOf('export async function autoCreateTasksFromCortex')).replace('export async function','async function');
 let captured;
 const pool={query:async(sql,args)=>{captured={sql,args};return {rows:[]};}};
 const selector=new Function('pool','TICK_DISPATCH_EXCLUDED','sortTasksByWeight','verificationTaskSql','deterministicScriptSql','tickLog','shouldBypassBackpressure',body+'; return selectNextDispatchableTask;')(pool,TICK_DISPATCH_EXCLUDED,x=>x,()=>'',()=>'',()=>{},()=>false);
 assert.equal(await selector(null),null);
 const match=captured.sql.match(/AND NOT \(t.task_type = ANY\(\$(\d+)::text\[\]\)\)/);assert.ok(match);
 assert.ok(captured.args[Number(match[1])-1].includes('exploratory'));
});

test('所有七处告警请求模板均通过真实准入，不遗留磁盘/孤儿分支退休类型',()=>{
 const templates=[...source.matchAll(/-d ("(?:\\.|[^"\\])*")/g)].map(m=>m[1]).filter(template=>template.includes('title'));
 assert.equal(templates.length,7);
 for(const template of templates){
  // 仅执行原请求的双引号JSON展开，不执行Janitor分支、curl或任何设备操作。
  const r=spawnSync('bash',['-c',`printf '%s\\n' ${template}`],{encoding:'utf8',env:{PATH:process.env.PATH,CPU_PCT:'97',CPU_ALERT_THRESHOLD:'85',KALLOC_CRITICAL_GB:'7',KALLOC_ALERT_GB:'5',KALLOC_SAFE_TZ:'Asia/Shanghai',KALLOC_SAFE_HOUR_START:'3',KALLOC_SAFE_HOUR_END:'5',tzdir:'/fixture/zoneinfo',gb:'7.00',branch:'cp-fixture',pid:'900001',USAGE_PCT:'90',description:'fixture disk alert'}});
  assert.equal(r.status,0,r.stderr);const body=JSON.parse(r.stdout);admit(body);
  assert.equal(body.status,'blocked');assert.equal(body.blocked_reason,'human_intervention_required');assert.equal(body.mutation_intent,'none');assert.equal(body.domain,'operations');assert.equal(body.payload.manual_only,true);
 }
});
