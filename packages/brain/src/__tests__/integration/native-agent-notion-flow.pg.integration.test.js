import {afterAll,beforeAll,expect,test,vi} from 'vitest';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createIntakeTestDatabase} from '../fixtures/task-intake-db.js';
import {createNativeAgentHostFixture} from '../helpers/native-agent-host-fixture.js';
const state=vi.hoisted(()=>({pool:null}));
vi.mock('../../db.js',()=>({default:{query:(...args)=>state.pool.query(...args),connect:(...args)=>state.pool.connect(...args)}}));
import {ingestDelegatedPage} from '../../notion-push-sync.js';
import {applyOwnerStops,pushQiumiStatus} from '../../notion-gtd-sync.js';
import {applyProjectionCommands} from '../../projection/commands.js';
import {dispatchQiumiTask} from '../../dispatcher.js';
import {triggerNativeAgent} from '../../native-agent-executor.js';
import {reconcileNativeAgentResources} from '../../lib/native-agent-resource-reconciliation.js';
let fixture,host,server,base;
const pages=new Map(),bodies=new Map(),writes=[];
const nativeFetch=globalThis.fetch;
const read=async id=>(await state.pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];
const string=items=>(items??[]).map(item=>item.plain_text??item.text?.content??'').join('');
const paragraph=text=>({type:'paragraph',paragraph:{rich_text:[{plain_text:text}]}});
beforeAll(async()=>{
 fixture=await createIntakeTestDatabase();state.pool=fixture.pool;host=createNativeAgentHostFixture();
 for(const name of ['task_runs','workflows','task_events','device_locks','task_leases','working_memory','ops_agents','phone_registry','projection_commands','pending_actions'])await state.pool.query(`CREATE TABLE ${fixture.schema}.${name} (LIKE public.${name} INCLUDING ALL)`);
 server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://fixture');let raw='';for await(const chunk of req)raw+=chunk;
   const body=raw?JSON.parse(raw):null;let result;
   if(req.method==='POST'&&url.pathname.includes('/databases/')){
    const status=body.filter.and.find(item=>item.property==='状态')?.status?.equals;
    result={results:[...pages.values()].filter(page=>page.properties.状态?.status?.name===status&&string(page.properties.OpenClaw任务号?.rich_text).startsWith('brain:')),has_more:false};
   }else if(url.pathname.startsWith('/blocks/')){
    const id=url.pathname.split('/')[2],bodyText=bodies.get(id);
    if(bodyText===undefined)throw Error('fixture_body_unknown');
    result={results:bodyText?[paragraph(bodyText)]:[],has_more:false};
   }else if(url.pathname.startsWith('/pages/')){
    const id=url.pathname.split('/')[2],page=pages.get(id);if(!page)throw Error('fixture_page_unknown');
    if(req.method==='PATCH'){Object.assign(page.properties,body.properties);writes.push({id,body});}
    result=page;
   }else throw Error('fixture_route_unknown');
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
  }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({message:error.message}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
 vi.stubGlobal('fetch',async(url,options)=>{
  const target=new URL(url);if(target.origin!=='https://api.notion.com'||!target.pathname.startsWith('/v1/'))throw Error('external_network_forbidden');
  return nativeFetch(base+target.pathname.slice(3)+target.search,options);
 });
});
afterAll(async()=>{
 vi.unstubAllGlobals();if(server)await new Promise(resolve=>server.close(resolve));host?.close();await fixture?.close();
});
async function poll(id){
 for(let index=0;index<100;index++){
  const task=await read(id);if(task.status!=='in_progress')return task;
  await triggerNativeAgent(task,{pool:state.pool,env:host.env,resolveHost:async()=>host.host,transport:host.transport});
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw Error('native_notion_fixture_not_settled');
}
function setup(marker){
 const enId=randomUUID(),zhId=randomUUID(),title='完整交办 '+marker;
 const en={id:enId,properties:{Name:{title:[{plain_text:title}]},Description:{rich_text:[{plain_text:`[zh:${zhId.replaceAll('-','')}]`}]},Status:{status:{name:'Delegated'}}}};
 const zh={id:zhId,properties:{名称:{title:[{plain_text:title}]},状态:{status:{name:'委派'}},优先级:{select:{name:'高'}},备注:{rich_text:[]},OpenClaw任务号:{rich_text:[]}}};
 pages.set(enId,en);pages.set(zhId,zh);bodies.set(enId,'');bodies.set(zhId,('完整真实正文。'.repeat(400))+marker);
 return {enId,zhId,en,zh,body:bodies.get(zhId)};
}
for(const [marker,expected,zhStatus,enStatus] of [['NATIVE_DONE','completed_no_pr','已完成','Done'],['NATIVE_FAIL','failed','失败','Failed'],['NATIVE_HANG','cancelled','淘汰','Cancelled']])test(`loopback Notion完整接单→真实PG/原生会话→${expected}→双页回写`,async()=>{
 const input=setup(marker);
 const stalePage=structuredClone(input.en);
 const {taskId}=await ingestDelegatedPage(state.pool,'isolated-notion-fixture',input.en,{env:{QIUMI_DISPATCH_ENABLED:'true',NOTION_TENANT_MAP:JSON.stringify({'c69c40c2-ba63-8271-badf-01c5410d8929':'fixture-native'})}});
 const queued=await read(taskId);
 const replay=await ingestDelegatedPage(state.pool,'isolated-notion-fixture',stalePage,{env:{QIUMI_DISPATCH_ENABLED:'true',NOTION_TENANT_MAP:JSON.stringify({'c69c40c2-ba63-8271-badf-01c5410d8929':'fixture-native'})}});
 expect(replay.taskId).toBe(taskId);
 expect((await state.pool.query("SELECT id FROM tasks WHERE payload->>'notion_page_id'=$1",[input.enId])).rows).toHaveLength(1);
 expect(queued.task_type).toBe('qiumi_task');expect(queued.executor_kind).toBe('external-worker');expect(queued.tenant_id).toBe('fixture-native');
 expect(queued.payload.qiumi_source.body).toBe(input.body);expect(queued.payload.native_agent_content.complete).toBe(true);
 expect(queued.payload.notion_page_id).toBe(input.enId);expect(queued.payload.notion_zh_page_id).toBe(input.zhId);
 expect((await dispatchQiumiTask(queued,{env:host.env})).outcome).toBe('proceed');
 expect((await triggerNativeAgent(await read(taskId),{pool:state.pool,env:host.env,resolveHost:async()=>host.host,transport:host.transport})).runId).toBeTruthy();
 const runId=(await read(taskId)).payload.run_id;
 if(marker==='NATIVE_HANG'){
  for(let count=0;count<50&&!host.launches().some(entry=>entry.text.includes(input.body));count++)await new Promise(resolve=>setTimeout(resolve,30));
  input.zh.properties.状态.status.name='淘汰';
  await applyOwnerStops(state.pool,'isolated-notion-fixture');
  expect(await applyProjectionCommands(state.pool)).toMatchObject({applied:1,rejected:0,failed:0});
  const pending=await read(taskId);expect(pending.status).toBe('in_progress');expect(pending.result.native_agent.cancel_requested).toBe(true);
 }
 const done=await poll(taskId);expect(done.status).toBe(expected);expect(done.payload.run_id).toBe(runId);
 const runs=(await state.pool.query('SELECT * FROM task_runs WHERE task_id=$1',[taskId])).rows;
 expect(runs).toHaveLength(1);expect(runs[0].ended_at).not.toBeNull();
 expect(host.launches().filter(entry=>entry.text.includes(input.body))).toHaveLength(1);
 await pushQiumiStatus(state.pool,'isolated-notion-fixture');
 expect(input.zh.properties.状态.status.name).toBe(zhStatus);expect(input.en.properties.Status.status.name).toBe(enStatus);
 expect(writes.some(write=>write.id===input.enId&&write.body.properties.Status?.status?.name===enStatus)).toBe(true);
 expect((await read(taskId)).notion_props.qiumi_pushed_status).toBe(expected);
});

test('资源原生任务待复核时Notion取消只登记原run意图，独立清场后人控取消优先且保原成功事实',async()=>{
 const input=setup('NATIVE_REVIEW'),serial='notion-review-'+randomUUID();
 bodies.set(input.zhId,'【执行参数】\n设备：'+serial+'\n【执行参数结束】\nNATIVE_REVIEW '+serial);
 await state.pool.query("INSERT INTO phone_registry(serial,nickname,enabled,host) VALUES($1,$1,true,'fixture-host')",[serial]);
 await state.pool.query("INSERT INTO device_locks(device_name,device_type) VALUES($1,'phone')",[serial]);
 const {taskId}=await ingestDelegatedPage(state.pool,'isolated-notion-fixture',input.en,{env:{QIUMI_DISPATCH_ENABLED:'true',NOTION_TENANT_MAP:JSON.stringify({'c69c40c2-ba63-8271-badf-01c5410d8929':'fixture-native'})}});
 expect(await dispatchQiumiTask(await read(taskId),{env:host.env})).toMatchObject({outcome:'proceed'});
 await triggerNativeAgent(await read(taskId),{pool:state.pool,env:host.env,resolveHost:async()=>host.host,transport:host.transport});
 const review=await poll(taskId),runId=review.payload.run_id;
 expect(review).toMatchObject({status:'blocked',blocked_reason:'owner_decision',result:{native_agent:{needs_review:true}}});
 const receipt=structuredClone(review.result.native_agent.receipt);
 expect(receipt.status).toBe('completed');
 const devices=(await state.pool.query('SELECT device_name,xmin::text AS acquisition_version FROM device_locks WHERE locked_by=$1',[taskId])).rows;
 expect(devices).toHaveLength(1);
 input.zh.properties.状态.status.name='淘汰';
 await applyOwnerStops(state.pool,'isolated-notion-fixture');
 expect(await applyProjectionCommands(state.pool)).toMatchObject({applied:1,rejected:0,failed:0});
 const waiting=await read(taskId);
 expect(waiting).toMatchObject({status:'blocked',blocked_reason:'owner_decision',result:{native_agent:{needs_review:true,cancel_requested:true}}});
 expect(waiting.result.native_agent.receipt).toEqual(receipt);
 expect((await state.pool.query('SELECT locked_by FROM device_locks WHERE device_name=$1',[serial])).rows[0].locked_by).toBe(taskId);
 expect((await state.pool.query('SELECT released_at FROM task_leases WHERE task_id=$1',[taskId])).rows[0].released_at).toBeNull();
 const pending=(await state.pool.query("SELECT id FROM pending_actions WHERE params->>'task_id'=$1 AND status='pending_approval'",[taskId])).rows[0];
 const outcome=await reconcileNativeAgentResources(state.pool,runId,{task_id:taskId,pending_action_id:pending.id,expected_devices:devices,cleanup_confirmed:true,effects_reviewed:true,evidence:[{kind:'independent_operator_readback',ref:'fixture:notion-cancel-cleanup',detail:'仅隔离进程与数据库设备fixture，没有真实手机或外部动作'}]},{principal:'authenticated-operator',transport:host.transport});
 expect(outcome).toMatchObject({status:'cancelled',resources_released:true});
 const final=await read(taskId),run=(await state.pool.query('SELECT * FROM task_runs WHERE task_id=$1',[taskId])).rows;
 expect(final.status).toBe('cancelled');expect(final.result.native_agent.receipt).toEqual(receipt);
 expect(run).toHaveLength(1);expect(run[0].status).toBe('success');expect(run[0].result.native_agent_resource_settlement.human_cancel_requested).toBe(true);
 expect((await state.pool.query('SELECT locked_by FROM device_locks WHERE device_name=$1',[serial])).rows[0].locked_by).toBeNull();
 expect((await state.pool.query('SELECT released_at FROM task_leases WHERE task_id=$1',[taskId])).rows[0].released_at).not.toBeNull();
 await pushQiumiStatus(state.pool,'isolated-notion-fixture');
 expect(input.zh.properties.状态.status.name).toBe('淘汰');expect(input.en.properties.Status.status.name).toBe('Cancelled');
 expect(host.launches().filter(entry=>entry.text.includes(serial))).toHaveLength(1);
});
test('普通取消读后Task被并发更新时拒绝旧写入，不覆盖新的Task控制拍',async()=>{
 const input=setup('NATIVE_DONE');
 const {taskId}=await ingestDelegatedPage(state.pool,'isolated-notion-fixture',input.en,{env:{QIUMI_DISPATCH_ENABLED:'true',NOTION_TENANT_MAP:JSON.stringify({'c69c40c2-ba63-8271-badf-01c5410d8929':'fixture-native'})}});
 input.zh.properties.状态.status.name='淘汰';await applyOwnerStops(state.pool,'isolated-notion-fixture');
 let edited=false;
 const racing={query:async(sql,args)=>{
  if(!edited&&String(sql).includes("UPDATE tasks SET status='cancelled'")){
   edited=true;await state.pool.query("UPDATE tasks SET description='concurrent-owner-edit',updated_at=NOW() WHERE id=$1",[taskId]);
  }
  return state.pool.query(sql,args);
 }};
 expect(await applyProjectionCommands(racing)).toMatchObject({applied:0,rejected:1,failed:0});
 expect(edited).toBe(true);expect(await read(taskId)).toMatchObject({status:'queued',description:'concurrent-owner-edit'});
});
