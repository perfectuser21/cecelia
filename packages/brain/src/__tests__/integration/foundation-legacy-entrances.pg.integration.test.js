import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
const state=vi.hoisted(()=>({db:null,trigger:vi.fn()}));
vi.mock('../../db.js',()=>({default:{query:(...args)=>state.db.query(...args)}}));
vi.mock('../../executor.js',()=>({checkCeceliaRunAvailable:async()=>({available:true}),triggerCeceliaRun:state.trigger}));
vi.mock('../../anchor-check.js',()=>({checkAnchor:()=>({blocked:false})}));
vi.mock('../../lib/review-skill-plan.js',()=>({prepareReviewSkillDispatch:async task=>({task})}));
vi.mock('../../lib/manual-dispatch-device-gate.js',()=>({checkDeviceLockForManualDispatch:async()=>({pass:true}),releaseDeviceLockNonFatal:async()=>{}}));
import {workflowFoundationDatabase} from '../fixtures/workflow-foundation-db.js';
import {migrationTable} from '../fixtures/minimum-definition-schema.js';
import {registerTaskManualDispatchRoutes} from '../../routes/tasks-manual-dispatch.js';
import {applyProposal,rollbackProposal} from '../../proposal.js';
import {applyProjectionCommands,recordProjectionCommand} from '../../projection/commands.js';
import {observeChat} from '../../thalamus.js';
let fixture,dispatch;
beforeAll(async()=>{
 fixture=await workflowFoundationDatabase();state.db=fixture.pool;
 await state.db.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metadata jsonb;
  CREATE TABLE working_memory(key text PRIMARY KEY,value_json jsonb,updated_at timestamptz);
  CREATE TABLE proposals(id uuid PRIMARY KEY,status text,source text,changes jsonb,snapshot jsonb,applied_at timestamptz,rolled_back_at timestamptz,updated_at timestamptz)`);
 await state.db.query(migrationTable('395_workbench_projection.sql','projection_commands'));
 registerTaskManualDispatchRoutes({post:(route,...handlers)=>{if(route==='/tasks/:id/dispatch')dispatch=handlers.at(-1);}});
},30000);
afterAll(async()=>{await fixture?.close();});
beforeEach(()=>{state.trigger.mockReset().mockResolvedValue({success:true});});
const read=async id=>(await state.db.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];
async function task(marker,status='queued'){
 const id=randomUUID(),payload=marker==='protocol'?{commander_protocol:'commander-foundation-v1'}:{},result=marker==='result'?{foundation_runner:{run_id:randomUUID()}}:{};
 await state.db.query('INSERT INTO tasks(id,title,status,task_type,payload,result,claimed_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,`guard-${id}`,status,'workflow_dispatch',payload,result,status==='in_progress'?'foundation:test':null]);
 return read(id);
}
it.each(['protocol','result'])('旧手动派发不能接管foundation %s',async marker=>{
 const original=await task(marker);const response={code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
 await dispatch({params:{id:original.id}},response);
 expect(response.code).toBe(409);expect(response.body.code).toBe('FOUNDATION_CONTROL_OWNED');
 expect(state.trigger).not.toHaveBeenCalled();expect((await read(original.id)).status).toBe('queued');
});
it.each(['protocol','result'])('提案不能改foundation %s 的状态或task_type',async marker=>{
 const original=await task(marker,'in_progress'),id=randomUUID();
 await state.db.query('INSERT INTO proposals(id,status,source,changes) VALUES($1,$2,$3,$4)',[id,'approved','user_ui',JSON.stringify([{type:'update_task',task_id:original.id,fields:{status:'completed',task_type:'research'}}])]);
 const result=await applyProposal(id);
 expect(result.results[0].result.success).toBe(false);
 expect(await read(original.id)).toMatchObject({status:'in_progress',task_type:'workflow_dispatch',payload:original.payload,result:original.result});
});
it.each(['protocol','result'])('提案回滚不能抹foundation %s 的状态和固定身份',async marker=>{
 const original=await task(marker,'in_progress'),id=randomUUID();
 await state.db.query('INSERT INTO proposals(id,status,source,changes,snapshot) VALUES($1,$2,$3,$4,$5)',[id,'applied','user_ui','[]',{tasks:{[original.id]:{priority:'P2',status:'queued',payload:{}}}}]);
 const result=await rollbackProposal(id);
 expect(result.results[0].restored).toBe(false);expect(result.partial).toBe(true);
 expect(await read(original.id)).toMatchObject({status:'in_progress',payload:original.payload,result:original.result,claimed_by:original.claimed_by});
});
it.each(['protocol','result'])('Notion取消指令不能覆盖blocked foundation %s',async marker=>{
 const original=await task(marker,'blocked');
 await recordProjectionCommand(state.db,{target:'test',externalId:randomUUID(),entityId:original.id,commandType:'cancel_requested'});
 expect(await applyProjectionCommands(state.db)).toMatchObject({rejected:1,applied:0});
 expect((await read(original.id)).status).toBe('blocked');
});
it.each(['protocol','result'])('聊天单个和标题批量取消都保留foundation %s',async marker=>{
 const original=await task(marker);
 await observeChat({type:'cancel_task',task_id:original.id});
 expect((await read(original.id)).status).toBe('queued');
 await observeChat({type:'cancel_task',task_title:original.title});
 expect((await read(original.id)).status).toBe('queued');
});
it('普通任务仍可聊天取消与提案修改、回滚',async()=>{
 const original=await task('ordinary');
 await observeChat({type:'cancel_task',task_id:original.id});expect((await read(original.id)).status).toBe('cancelled');
 const id=randomUUID();await state.db.query('INSERT INTO proposals(id,status,source,changes) VALUES($1,$2,$3,$4)',[id,'approved','user_ui',JSON.stringify([{type:'update_task',task_id:original.id,fields:{priority:'P1'}}])]);
 expect((await applyProposal(id)).results[0].result.success).toBe(true);
 expect((await read(original.id)).priority).toBe('P1');
 expect((await rollbackProposal(id)).results[0].restored).toBe(true);
 expect((await read(original.id)).priority).toBe(original.priority);
});
it('提案读取后归属改变时零行写入不得报告成功',async()=>{
 const original=await task('ordinary'),id=randomUUID(),db=state.db;
 await db.query('INSERT INTO proposals(id,status,source,changes) VALUES($1,$2,$3,$4)',[id,'approved','user_ui',JSON.stringify([{type:'update_task',task_id:original.id,fields:{status:'completed'}}])]);
 state.db={query:async(sql,args)=>{
  const result=await db.query(sql,args);
  if(sql==='SELECT * FROM tasks WHERE id = $1'&&args[0]===original.id)await db.query("UPDATE tasks SET payload=payload||'{\"commander_protocol\":\"commander-foundation-v1\"}'::jsonb WHERE id=$1",[original.id]);
  return result;
 }};
 try{expect((await applyProposal(id)).results[0].result.success).toBe(false);}
 finally{state.db=db;}
 expect((await read(original.id)).status).toBe('queued');
});
