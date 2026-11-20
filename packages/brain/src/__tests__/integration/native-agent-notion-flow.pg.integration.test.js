import {afterAll,beforeAll,expect,test,vi} from 'vitest';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createIntakeTestDatabase} from '../fixtures/task-intake-db.js';
import {createNativeAgentHostFixture} from '../helpers/native-agent-host-fixture.js';
const state=vi.hoisted(()=>({pool:null}));
vi.mock('../../db.js',()=>({default:{query:(...args)=>state.pool.query(...args),connect:(...args)=>state.pool.connect(...args)}}));
import {ingestDelegatedPage,pullNotionTasksForTest} from '../../notion-push-sync.js';
import {applyOwnerStops,pushQiumiStatus} from '../../notion-gtd-sync.js';
import {applyProjectionCommands} from '../../projection/commands.js';
import {dispatchQiumiTask} from '../../dispatcher.js';
import {triggerNativeAgent} from '../../native-agent-executor.js';
import {reconcileNativeAgentResources} from '../../lib/native-agent-resource-reconciliation.js';
let fixture,host,server,base;
const pages=new Map(),bodies=new Map(),writes=[],children=new Map(),sourceIds=new Map();
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
    const matches=(page,filter)=>{
     if(filter.and)return filter.and.every(item=>matches(page,item));
     const property=page.properties[filter.property];
     if(filter.status)return property?.status?.name===filter.status.equals;
     if(filter.rich_text?.contains)return string(property?.rich_text).includes(filter.rich_text.contains);
     if(filter.rich_text?.starts_with)return string(property?.rich_text).startsWith(filter.rich_text.starts_with);
     throw Error('fixture_query_filter_unknown');
    };
    result={results:[...pages.values()].filter(page=>matches(page,body.filter)),has_more:false};
   }else if(url.pathname.startsWith('/blocks/')){
    const id=url.pathname.split('/')[2];
    if(req.method==='PATCH'){
     const materialize=spec=>{
      const block=structuredClone(spec),nested=block[block.type]?.children??[];
      block.id=randomUUID();block.has_children=nested.length>0;delete block[block.type].children;
      children.set(block.id,nested.map(materialize));return block;
     };
     children.set(id,[...(children.get(id)??[]),...body.children.map(materialize)]);result={results:children.get(id),has_more:false};
    }else if(req.method==='DELETE'){
     for(const [pageId,sourceId] of sourceIds)if(sourceId===id)bodies.set(pageId,'');
     for(const [parent,blocks] of children)children.set(parent,blocks.filter(block=>block.id!==id));
     children.delete(id);result={id,archived:true};
    }else{
     const bodyText=bodies.get(id);
     if(bodyText===undefined&&!children.has(id))throw Error('fixture_body_unknown');
     if(bodyText&&!sourceIds.has(id))sourceIds.set(id,randomUUID());
     result={results:[...(bodyText?[{...paragraph(bodyText),id:sourceIds.get(id),has_children:false}]:[]),...(children.get(id)??[])],has_more:false};
    }
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

function englishPage(body){
 const id=randomUUID(),page={id,properties:{Name:{title:[{plain_text:'普通交办：整理本次摘要'}]},Description:{rich_text:[{plain_text:'请按页面正文执行，保留我的人工备注。'}]},Status:{status:{name:'Delegated'}}}};
 pages.set(id,page);bodies.set(id,body);return page;
}
async function linkedEnglishTask(page){return (await state.pool.query("SELECT * FROM tasks WHERE payload->>'notion_page_id'=$1",[page.id])).rows;}
function blockTextTree(id){
 return (children.get(id)??[]).map(block=>({...block,[block.type]:{...block[block.type],children:blockTextTree(block.id)}}));
}
const englishEnv={QIUMI_DISPATCH_ENABLED:'true',NOTION_TENANT_MAP:JSON.stringify({'c69c40c2-ba63-8271-badf-01c5410d8929':'fixture-native'})};
async function seedEnglishNative(page){
 const id=randomUUID();await state.pool.query("INSERT INTO tasks(id,title,task_type,status,tenant_id,executor_kind,payload) VALUES($1,$2,'qiumi_task','queued','fixture-native','external-worker',$3)",[id,'原生英文交办 '+id,{source:'notion_gtd',notion_page_id:page.id,native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:[page.id]},qiumi_source:{title:'原生英文交办',body:bodies.get(page.id)}}]);return id;
}
test('无内部标记的普通英文Delegated经现pull入口原生执行，原页显示真实结果且重复拉取不重复接单',async()=>{
 const body='请整理本次摘要。'.repeat(300)+'\n人工备注：这段不得被机器结果覆盖。';
 const page=englishPage(body);await pullNotionTasksForTest(state.pool,'isolated-notion-fixture',{env:englishEnv});
 const tasks=await linkedEnglishTask(page);expect(tasks).toHaveLength(1);
 const queued=tasks[0];expect(queued).toMatchObject({task_type:'qiumi_task',status:'queued',executor_kind:'external-worker'});expect(queued.payload.native_agent_content.complete).toBe(true);
 expect(queued.payload.qiumi_source.body).toBe(body);
 await pullNotionTasksForTest(state.pool,'isolated-notion-fixture',{env:englishEnv});expect(await linkedEnglishTask(page)).toHaveLength(1);
 expect(await dispatchQiumiTask(await read(queued.id),{env:host.env})).toMatchObject({outcome:'proceed'});
 await triggerNativeAgent(await read(queued.id),{pool:state.pool,env:host.env,resolveHost:async()=>host.host,transport:host.transport});expect((await poll(queued.id)).status).toBe('completed_no_pr');
 await pushQiumiStatus(state.pool,'isolated-notion-fixture');
 expect(page.properties.Status.status.name).toBe('Done');expect(JSON.stringify(blockTextTree(page.id))).toContain('实际fixture执行结果：完整输入已处理');
 expect(bodies.get(page.id)).toBe(body);expect(host.launches().filter(entry=>entry.text.includes(body))).toHaveLength(1);
});
test('英文单页回写机器区只保真实回执与证据，保原正文且不泄config/frozen/stdout',async()=>{
 const original='人工原始正文：请保留这条记录。',page=englishPage(original),id=await seedEnglishNative(page);
 await state.pool.query("UPDATE tasks SET status='completed_no_pr',result=$2 WHERE id=$1",[id,{receipt:{text:'独立结果：摘要已完成',evidence:['fixture:verified-summary']},config:{summary:'PRIVATE_CONFIG_SENTINEL'},frozen:{summary:'PRIVATE_FROZEN_SENTINEL'},stdout:'PRIVATE_STDOUT_SENTINEL'}]);
 await pushQiumiStatus(state.pool,'isolated-notion-fixture');
 expect(page.properties.Status.status.name).toBe('Done');const text=JSON.stringify(blockTextTree(page.id));
 expect(text).toContain('独立结果：摘要已完成');expect(text).toContain('fixture:verified-summary');expect(text).not.toContain('PRIVATE_');expect(bodies.get(page.id)).toBe(original);
 const initial=JSON.stringify(children.get(page.id));await pushQiumiStatus(state.pool,'isolated-notion-fixture');expect(JSON.stringify(children.get(page.id))).toBe(initial);
});
test('英文原页Blocked不伪暂停，Cancelled交现命令正式停止原run后才显示取消',async()=>{
 const body='请等待我的取消指令。 NATIVE_HANG '+randomUUID(),page=englishPage(body),id=await seedEnglishNative(page);
 expect(await dispatchQiumiTask(await read(id),{env:host.env})).toMatchObject({outcome:'proceed'});
 await triggerNativeAgent(await read(id),{pool:state.pool,env:host.env,resolveHost:async()=>host.host,transport:host.transport});
 for(let i=0;i<50&&!host.launches().some(entry=>entry.text.includes(body));i++)await new Promise(resolve=>setTimeout(resolve,30));
 const runId=(await read(id)).payload.run_id;page.properties.Status.status.name='Blocked';
 const held=await applyOwnerStops(state.pool,'isolated-notion-fixture');
 expect(held.ignored).toEqual(expect.arrayContaining([expect.objectContaining({id,action:'hold'})]));
 expect((await read(id)).status).toBe('in_progress');expect(page.properties.Status.status.name).toBe('In Progress');
 await pushQiumiStatus(state.pool,'isolated-notion-fixture');expect(JSON.stringify(blockTextTree(page.id))).toContain('暂停未执行');
 page.properties.Status.status.name='Cancelled';await applyOwnerStops(state.pool,'isolated-notion-fixture');
 expect(page.properties.Status.status.name).toBe('In Progress');
 expect(await applyProjectionCommands(state.pool)).toMatchObject({applied:1,rejected:0,failed:0});
 expect((await read(id)).status).toBe('in_progress');expect((await read(id)).result.native_agent.cancel_requested).toBe(true);
 expect((await poll(id)).status).toBe('cancelled');expect((await read(id)).payload.run_id).toBe(runId);
 await pushQiumiStatus(state.pool,'isolated-notion-fixture');expect(page.properties.Status.status.name).toBe('Cancelled');
 expect(host.launches().filter(entry=>entry.text.includes(body))).toHaveLength(1);
});
