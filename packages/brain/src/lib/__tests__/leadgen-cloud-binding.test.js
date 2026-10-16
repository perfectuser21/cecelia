import {describe,it,expect,vi} from 'vitest';
import {resolveLeadgenInput,prepareLeadgenPlan} from '../leadgen-dispatch-contract.js';
import {buildLeadgenLaunch} from '../leadgen-controller.js';
import {dispatchLeadgenTask,validateLeadgenTerminal,reapLeadgenTask} from '../leadgen-dispatch.js';
import {verifyBatchRows,buildLeadgenBatchProbe} from '../leadgen-batch-proof.js';
import {setLeadgenRuntimeStatus} from '../leadgen-runtime-status.js';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const taskId='11111111-1111-4111-8111-111111111111',company='22222222-2222-4222-8222-222222222222';
const releaseId='33333333-3333-4333-8333-333333333333',observation='44444444-4444-4444-8444-444444444444',version='55555555-5555-4555-8555-555555555555';
const serial='47.100.213.173:10001',instance='acp-f6utus34dgnghc1oc',profile='cloud-phone-test';
const flow102='douyin_video_processing',flow101='douyin_video_discovery';
function task(key=flow102,extra={}){return {id:taskId,payload:{workflow_key:key,leadgen:{company_id:company,line:'yuesheng',profile,serial,device_host:'mmv',device_instance_id:instance,adb_port:5041,registry:'cloud-phone-test-profiles.tsv',...(key===flow102?{source_run:'source101',source_binding_run_id:flow101+'-source101__a1'}:{}),...extra},workflow_definition:{release_id:releaseId,observation_id:observation,workflow_definition_version_id:version,snapshot_sha256:'a'.repeat(64)}}};}
function plan(key=flow102){const business_tag='brain'+taskId.replaceAll('-','');return {task_id:taskId,controller_run_id:'wfd-'+taskId,business_tag,business_run_id:key+'-'+business_tag+'__a1',workflow_key:key,workflow_id:'b1000000-0000-4000-8000-00000000010'+(key===flow101?'1':'2'),machine:'mmv',profile,serial,line:'yuesheng',company_id:company,device_instance_id:instance,registry:'cloud-phone-test-profiles.tsv',timeout_sec:2400,release_id:releaseId,observation_id:observation,workflow_definition_version_id:version,snapshot_sha256:'a'.repeat(64),source_commit:'b'.repeat(40),env:{LEADGEN_LIMIT:'5',WF_MMV_SSH_ROUTE:'public',LEADGEN_MMV_DEVICE_RUNTIME:'1',DOUYIN_ADB_PORT:'5041',ADB_SERVER_SOCKET:'tcp:127.0.0.1:5041',...(key===flow102?{LEADGEN_SOURCE_RUN:'source101'}:{})}};}
describe('显式MMV手机仍进入原冻结入口',()=>{
 it.each([flow101,flow102])('%s 真实resolve到controller可用且没有发送能力',key=>{const p=resolveLeadgenInput(task(key));expect(p.machine).toBe('mmv');expect(p.env.LEADGEN_MMV_DEVICE_RUNTIME).toBe('1');expect(p.env.ADB_SERVER_SOCKET).toBe('tcp:127.0.0.1:5041');expect(p.registry).toBe('cloud-phone-test-profiles.tsv');expect(p.send_authorized).toBeUndefined();expect(()=>buildLeadgenLaunch({...p,...Object.fromEntries(['release_id','observation_id','workflow_definition_version_id','snapshot_sha256','source_commit'].map(k=>[k,plan(key)[k]]))})).not.toThrow();});
 it.each([{device_host:undefined},{device_host:'evil'},{adb_port:0},{adb_port:65536},{adb_port:'5041'},{registry:'../other.tsv'},{registry:'/tmp/private.tsv'},{device_instance_id:undefined},{serial:'999.1.2.3:1'},{serial:'1.2.3.4:0'},{serial:'1.2.3.4:65536'},{serial:'evil.example:5555'}])('不完整或任意路由拒绝 %j',extra=>expect(()=>resolveLeadgenInput(task(flow102,extra))).toThrow());
 it('104即使显式授权也不支持MMV手机',()=>expect(()=>resolveLeadgenInput(task('douyin_lead_outreach',{send_authorized:true,limit:1}))).toThrow());
 it('controller不接受伪socket、任意ADB路径或registry目录',()=>{for(const p of [{...plan(),env:{...plan().env,ADB_SERVER_SOCKET:'tcp:localhost:5041'}},{...plan(),env:{...plan().env,DOUYIN_ADB_BIN:'/tmp/evil'}},{...plan(),registry:'../private.tsv'}])expect(()=>buildLeadgenLaunch(p)).toThrow();});
 it('正式MMV release与唯一台账实体/技术别名必须相等',async()=>{const t=task(),fixed={id:version,workflow_id:plan().workflow_id,payload_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)};const phone={serial,host:'mmv',profile,enabled:true,aliases:[instance]};
  const query=vi.fn(async sql=>({rows:sql.includes('phone_registry')?[phone]:[{key:flow102,status:'active',current_definition_version_id:version}]}));const deps={getRelease:async()=>({id:releaseId,environment:'production',target:'mmv',payload:{workflows:[fixed]}}),getReleaseGate:async()=>({deployed:true,actual_matches:true,gaps:[],current_observation_id:observation}),getBinding:async()=>({binding:{source_kind:'external'},workflow:{workflow_id:plan(flow101).workflow_id,source_commit:fixed.source_commit}})};
  expect((await prepareLeadgenPlan({query},t,deps)).machine).toBe('mmv');expect(query.mock.calls.some(c=>c[0].includes('phone_registry'))).toBe(true);phone.aliases=[];await expect(prepareLeadgenPlan({query},t,deps)).rejects.toThrow();
 });
});
describe('MMV手机不能因host跳过中央锁和清场',()=>{
 function deps(){return {prepareLeadgenPlan:async()=>plan(),batchProof:async()=>({company_id:company,eligible:1}),lockGate:vi.fn(async()=>({pass:true})),releaseLock:vi.fn(),setLease:vi.fn(),startRun:async()=>({id:'persisted',run_id:plan().controller_run_id}),launch:vi.fn(async()=>JSON.stringify({state:'running'})),recordEvent:vi.fn(),finalizeTask:vi.fn(),finishRun:vi.fn()};}
 const pool={query:async()=>({rows:[{id:taskId}]})};
 it('serial与instance原锁都确认才launch',async()=>{const d=deps();expect(await dispatchLeadgenTask(pool,task(),d)).toBe('dispatched');expect(d.lockGate.mock.calls.map(c=>c[0].payload.device_serial).sort()).toEqual([serial,instance].sort());expect(d.launch).toHaveBeenCalledTimes(1);});
 it('任一别名忙不launch，回收的只可能是本task已领锁',async()=>{const d=deps();d.lockGate.mockResolvedValueOnce({pass:true}).mockResolvedValueOnce({pass:false});expect(await dispatchLeadgenTask(pool,task(),d)).toBe('waiting');expect(d.launch).not.toHaveBeenCalled();expect(d.releaseLock).toHaveBeenCalledWith(taskId,pool);});
 it('手机非零终态缺清场不得finish或释放',async()=>{await expect(validateLeadgenTerminal(pool,plan(),{state:'terminal',exit_code:2,execution_started:true})).rejects.toThrow('清场');});
 it('明确非零终态+真实cleanup后释放本人两别名',async()=>{const d=deps();d.probe=async()=>({state:'terminal',exit_code:2,execution_started:true,receipt:{split_result:{results:[{activity:'cleanup',status:'completed',verification:{verified:true}}]}}});expect(await reapLeadgenTask(pool,{...task(),run_id:plan().controller_run_id,payload:{leadgen_run:plan()}},d)).toBe('failed');expect(d.releaseLock).toHaveBeenCalledWith(taskId,pool);});
 it('未知launch永不重放或提前放锁',async()=>{const d=deps();d.launch.mockRejectedValue(Error('lost'));expect(await dispatchLeadgenTask(pool,task(),d)).toBe('dispatched');expect(d.launch).toHaveBeenCalledTimes(1);expect(d.releaseLock).not.toHaveBeenCalled();});
});
describe('103在MMV既有PG只读通道消费已提交的原102',()=>{
 const p={...plan(),workflow_key:'douyin_comment_scoring',profile:'mmv-scoring',serial:'none',env:{LEADGEN_SOURCE_RUN:'source102',LEADGEN_LIMIT:'5'}};
 const snapshot={company_id:company,tenant_id:'tenant',config_status:'enabled',runtime_config:{routing:{line_key:'yuesheng'}}};
 const b={company_id:company,tenant_id:'tenant',run_id:'source102',line_key:'yuesheng'};
 const row={line_key:'yuesheng',harvest_batch:'source102',douyin_id:'nativeid',nickname:'n',profile_url:'https://www.douyin.com/user/nativeid',comment_body:'c',source_video_url:'v',recipient_evidence:{company_binding:b}};
 it('原件带context不能自证，缺可信context在评分前拒绝',()=>expect(()=>verifyBatchRows(p,[row],snapshot,()=>{},()=>'',{key:'yuesheng'})).toThrow());
 it('明确可信原102context传给原native validator第三参数',()=>{const validate=vi.fn();expect(verifyBatchRows(p,[row],snapshot,validate,()=>'',{key:'yuesheng'},b).eligible).toBe(1);expect(validate.mock.calls[0][2]).toEqual({companyBinding:b});expect(()=>verifyBatchRows(p,[row],snapshot,validate,()=>'',{key:'yuesheng'},{...b,tenant_id:'foreign'})).toThrow();});
 it('实际生成node在MMV HOME/bin-harvest加载既有reader，同一READ ONLY连接、不等待102全批终态',()=>{
  const home=mkdtempSync(join(tmpdir(),'brain-cloud-probe-')),root=join(home,'bin-harvest');mkdirSync(root);const logs=join(home,'queries.json');
  writeFileSync(join(root,'leadgen-db-connect.js'),`const fs=require('fs');let queries=[];const c={release(){},async query(sql,args){queries.push(sql);fs.writeFileSync(${JSON.stringify(logs)},JSON.stringify(queries));return {rows:sql.includes('SELECT snapshot')?[{snapshot:${JSON.stringify(snapshot)}}]:sql.includes('leadgen_comments')?[${JSON.stringify(row)}]:[]};}};exports.getPool=()=>({connect:async()=>c,end:async()=>{}});`);
  writeFileSync(join(root,'line-routes.js'),`exports.routeOf=()=>({key:'yuesheng'});`);
  writeFileSync(join(root,'queued-recipient-evidence.js'),`exports.hash=()=>'';exports.validateEvidence=(_e,_s,options)=>{if(options?.companyBinding?.run_id!=='source102')throw Error('missing PG context');};`);
  writeFileSync(join(root,'company-config-lib.js'),`exports.readCollectionAccountBinding=async(c,{lineKey,run})=>{if(lineKey!=='yuesheng'||run!=='source102')throw Error('wrong source');await c.query('SELECT original102 frozen binding');return ${JSON.stringify(b)};};`);
  try{const result=JSON.parse(execFileSync(process.execPath,['-'],{input:buildLeadgenBatchProbe(p).input,env:{...process.env,HOME:home},encoding:'utf8',timeout:3000}));expect(result.eligible).toBe(1);const q=JSON.parse(readFileSync(logs));expect(q[0]).toBe('BEGIN READ ONLY');expect(q).toContain('SELECT original102 frozen binding');expect(q.join('\n')).not.toMatch(/INSERT|UPDATE|process_status='.*completed/);}
  finally{rmSync(home,{recursive:true,force:true});}
 });
});
describe('101/102可按已批准的真实MMV release正规启用',()=>{
 it('不改变104目标和paused治理边界',async()=>{const id=plan().workflow_id,body={status:'active',actor:'actor',task_id:taskId,reason:'explicit',release_id:releaseId,observation_id:observation,workflow_definition_version_id:version,snapshot_sha256:'a'.repeat(64)};let status='paused';const query=vi.fn(async(sql,args)=>{if(sql.includes('FROM tasks'))return {rows:[{status:'in_progress',claimed_by:'owner',payload:{actor:'actor',workflow_runtime_scope:[id]}}]};if(sql.includes('UPDATE workflows'))status=args[1];if(sql.includes('FROM workflows')||sql.includes('UPDATE workflows'))return {rows:[{key:flow102,status,current_definition_version_id:version,source_repo:'repo'}]};return {rows:[]};});const deps={getRelease:async()=>({id:releaseId,environment:'production',target:'mmv',payload:{workflows:[{workflow_id:id,id:version,payload_sha256:'a'.repeat(64),source_repo:'repo',source_commit:'b'.repeat(40)}],components:[{kind:'repo',repo:'repo',revision:'b'.repeat(40)}]}}),getReleaseGate:async()=>({deployed:true,actual_matches:true,gaps:[],current_observation_id:observation}),lockReleaseTarget:vi.fn()};expect((await setLeadgenRuntimeStatus({connect:async()=>({query,release(){}})},id,body,deps)).workflow.status).toBe('active');});
});

describe('MMV手机仍须完整公司账号授权',()=>{
 const a={profile,device_serial:serial,douyin_id:'perfect21xx',platform:'douyin',company_id:company,tenant_id:'tenant',enabled:true,verification_status:'verified',device_id:instance,source:{device_host:'mmv',device_instance_id:instance}};
 const snapshot={company_id:company,tenant_id:'tenant',config_status:'enabled',runtime_config:{routing:{line_key:'yuesheng',profiles:[profile]},platform_accounts:[a]}};
 it('真实API账号shape可预检，尚未核验或disabled不得启动',()=>{expect(verifyBatchRows(plan(),[],snapshot,()=>{},()=>'',{key:'yuesheng'}).eligible).toBe(1);for(const bad of [{enabled:false},{enabled:'true'},{verification_status:'unverified'},{company_id:'foreign'},{tenant_id:'foreign'},{platform:'wechat'},{device_id:'foreign'},{douyin_id:''},{source:{device_host:'xian-m4',device_instance_id:instance}}])expect(()=>verifyBatchRows(plan(),[],{...snapshot,runtime_config:{...snapshot.runtime_config,platform_accounts:[{...a,...bad}]}},()=>{},()=>'',{key:'yuesheng'})).toThrow('COMPANY_ACCOUNT');});
 it('同profile多账号及routing未唯一指定均拒绝',()=>{for(const runtime_config of [{...snapshot.runtime_config,platform_accounts:[a,a]},{...snapshot.runtime_config,routing:{line_key:'yuesheng',profiles:[]}}])expect(()=>verifyBatchRows(plan(),[],{...snapshot,runtime_config},()=>{},()=>'',{key:'yuesheng'})).toThrow('COMPANY_ACCOUNT');});
});
