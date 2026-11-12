import {describe,it,expect,vi} from 'vitest';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {createCommonRunnerDispatcher} from '../common-runner-dispatch.js';
import {commonRunnerExecutionContext} from '../common-runner-identity.js';
const taskId='10000000-0000-4000-8000-000000000001',runId='20000000-0000-4000-8000-000000000001',nodeId='30000000-0000-4000-8000-000000000001',grantId='40000000-0000-4000-8000-000000000001',rowId='50000000-0000-4000-8000-000000000001';
const token='isolated-cancel-before-start-test-token',hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function setup({launch='not_started',spans=[],devices=[],receiptPatch={},beforeSettlement,badSignature=false,wrongNonce=false}={}){
 const binding={run_id:runId,task_id:taskId,machine_id:'node-a',profile:'demo',profile_sha256:'a'.repeat(64),mode:'formal',input:{},input_digest:hash({input:{},mode:'formal',profile:'demo'}),execution_version_id:nodeId,execution_grant_id:grantId,launch_nonce:randomUUID(),launch_state:launch};
 const task={id:taskId,status:'in_progress',kind:'agent',payload:{},claimed_by:'common-runner',result:{common_runner:binding}};
 const context=commonRunnerExecutionContext(binding,binding.launch_nonce);context.common_runner_launch.state=launch;
 const run={id:rowId,task_id:taskId,status:'running',ended_at:null,context,result:{}};const statements=[];const requests=[];
 const query=vi.fn(async(sql,params)=>{statements.push(sql);
  if(/FROM tasks/.test(sql))return {rows:[structuredClone(task)],rowCount:1};
  if(/FROM task_runs/.test(sql))return {rows:[structuredClone(run)],rowCount:1};
  if(/FROM spans/.test(sql))return {rows:spans,rowCount:spans.length};
  if(/FROM device_locks/.test(sql))return {rows:devices,rowCount:devices.length};
  if(/UPDATE tasks/.test(sql)){Object.assign(task.result,JSON.parse(params[1]));return {rows:[{id:taskId}],rowCount:1};}
  return {rows:[],rowCount:1};
 });
 const client={query,release:vi.fn()},pool={query,connect:vi.fn(async()=>client)};
 const finish=vi.fn(async(args,deps)=>{expect(deps.pool).toBe(client);run.status=args.status;run.ended_at=new Date().toISOString();run.result=args.result;return {updated:true};});
 const transport=vi.fn(async({body,action})=>{requests.push({body,action});const receipt={run_id:runId,task_id:taskId,machine_id:'node-a',request_nonce:wrongNonce?'stale':body.request_nonce,mode:'formal',profile_sha256:'a'.repeat(64),status:'cancelled',cancel_before_start:true,cancel_requested:true,execution_state:'not_started',execution_unknown:false,cleanup_required:false,progress:null,validation:null,writeback:{pending:0,blocked:0,total:0,acked:0,manifest_sha256:hash([])},...receiptPatch};beforeSettlement?.({task,run});return {receipt,signature:badSignature?'0'.repeat(64):createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')};});
 const dispatcher=createCommonRunnerDispatcher({pool,token,transport,allowLoopbackForTests:true,finishRun:finish,resolveBoundNode:async()=>({id:nodeId,canonical_id:'node-a',endpoints:{worker:'http://127.0.0.1:5231'}})});
 return {dispatcher,task,run,pool,client,finish,requests,statements};
}
describe('公共Runner未开始取消独立终结',()=>{
 it('cancel只传持久binding的真实profile身份，零业务记录可独立确认取消',async()=>{
  const f=setup(),result=await f.dispatcher.dispatch('cancel',runId,{task_id:taskId});
  expect(f.requests[0].body).toMatchObject({profile:'demo',mode:'formal',profile_sha256:'a'.repeat(64)});
  expect(result).toMatchObject({authenticated:true,central_run:{status:'cancelled',recording_status:'confirmed'}});expect(f.finish).toHaveBeenCalledTimes(1);
  expect(f.run.status).toBe('cancelled');expect(f.run.result.common_runner.resource_settlement).toMatchObject({basis:'not-started-resource-free',devices:[],execution_unknown:false});expect(f.run.result.common_runner).not.toHaveProperty('validation');
  const write=f.statements.findIndex(sql=>sql.includes('FOR UPDATE')&&sql.includes('task_runs'));expect(write).toBeGreaterThan(-1);expect(f.statements.filter(sql=>sql==='BEGIN')).toHaveLength(2);expect(f.statements.filter(sql=>sql==='COMMIT')).toHaveLength(2);
 });
 it.each(['reserved','spans','devices','unknown','cleanup','journal','cancel_revoked','reservation_changed'])('拒绝%s缺口，不把取消伪装成已核业务清场',async fault=>{
  const options={};if(fault==='reserved')options.launch='reserved';if(fault==='spans')options.spans=[{occurrence_key:'already-started'}];if(fault==='devices')options.devices=[{device_name:'physical-phone'}];
  if(fault==='unknown')options.receiptPatch={execution_unknown:true};if(fault==='cleanup')options.receiptPatch={cleanup_required:true};if(fault==='journal')options.receiptPatch={writeback:{pending:0,blocked:0,total:0,acked:0,manifest_sha256:'f'.repeat(64)}};
  if(fault==='cancel_revoked')options.beforeSettlement=({task})=>{task.result.common_runner.cancel_requested=false;};if(fault==='reservation_changed')options.beforeSettlement=({run})=>{run.context.common_runner_launch.state='reserved';};
  const f=setup(options),result=await f.dispatcher.dispatch('cancel',runId,{task_id:taskId});expect(result.central_run?.recording_status).not.toBe('confirmed');expect(f.finish).not.toHaveBeenCalled();
 });
 it.each([{badSignature:true},{wrongNonce:true},{receiptPatch:{profile_sha256:'f'.repeat(64)}},{receiptPatch:{mode:'exploration'}}])('保留完整验签身份拒绝：%j',async options=>{
  const f=setup(options),result=await f.dispatcher.dispatch('cancel',runId,{task_id:taskId});expect(result).toMatchObject({status:'unknown',reason:'common_runner_receipt_unverified'});expect(f.finish).not.toHaveBeenCalled();
 });
});
