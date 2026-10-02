import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DB_DEFAULTS } from '../../db-config.js';
import { createPhoneClaimFixture } from '../fixtures/phone-claim-schema.js';
const h = vi.hoisted(() => ({ pool:null, block:vi.fn(), terminal:vi.fn(), finalize:vi.fn() }));
vi.mock('../../db.js',()=>({default:{get options(){return h.pool.options;},query:(...a)=>h.pool.query(...a),connect:()=>h.pool.connect()}}));
vi.mock('../../task-updater.js',()=>({broadcastTaskState:vi.fn(),blockTask:(...a)=>h.block(...a)}));
vi.mock('../../lib/task-terminal.js',()=>({afterTerminalTransition:(...a)=>h.terminal(...a),isRelayTerminalStatus:s=>['completed','completed_no_pr'].includes(s),isTerminalStatus:s=>['completed','completed_no_pr','failed','archived'].includes(s)}));
vi.mock('../../lib/harness-finalize.js',()=>({finalizeHarnessTask:(...a)=>h.finalize(...a)}));
let f,server,base,blocked,reviewPhone,harnessPhone;
beforeEach(()=>{vi.clearAllMocks();h.terminal.mockResolvedValue({});h.finalize.mockResolvedValue({applies:false});});
afterEach(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}server=null;if(f)await f.close();f=null;});
async function setup(){
 blocked=randomUUID();reviewPhone=randomUUID();harnessPhone=randomUUID();
 f=await createPhoneClaimFixture(pool=>h.pool=pool,{beforeSchedule:async pool=>{
  await pool.query(`ALTER TABLE tasks ADD COLUMN review_status text,ADD COLUMN pr_url text,ADD COLUMN pr_merged_at timestamptz,ADD COLUMN success_metrics jsonb;
    CREATE TABLE harness_gaps(source_task_id uuid,status text);`);
  // Legitimate historical executor-only blocked row before the schedule guard; never forge a blocked lease.
  await pool.query("INSERT INTO tasks(id,title,status,task_type,executor_kind,blocked_reason,metadata) VALUES($1,'historical phone preflight','blocked','research','phone-ssh-controller','pre_flight_rejected',$2)",[blocked,{pre_flight_failed:true,keep:'human'}]);
  await pool.query("INSERT INTO tasks(id,title,status,task_type,executor_kind,payload) VALUES($1,'historical phone review','blocked','dev','phone-ssh-controller',$3),($2,'historical phone harness','blocked','harness_initiative','phone-ssh-controller',$4)",[reviewPhone,harnessPhone,{review_required:true},{orchestrator:'skill-relay'}]);
 }});
 expect(f.location).toEqual({db:DB_DEFAULTS.database,schema:f.schema});
 h.block.mockImplementation(async(id)=>{await f.pool.query("UPDATE tasks SET status='blocked' WHERE id=$1",[id]);});
 const tasks=(await import('../../routes/task-tasks.js')).default,legacy=(await import('../../routes/tasks.js')).default;
 const app=express();app.use(express.json());app.use('/api/brain/tasks/tasks',tasks);app.use('/api/brain',legacy);app.use('/api/brain/tasks',tasks);
 server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
}
async function patch(id,body,alias='nested',headers={}){
 const r=await fetch(`${base}/api/brain/tasks/${alias==='nested'?'tasks/':''}${id}`,{method:'PATCH',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 return {status:r.status,body:await r.json()};
}
it.each(['canonical','nested'])('%s refuses real producer/legacy lease/executor execution before effects',async alias=>{
 await setup();const before=await f.snapshot();
 for(const id of [f.owner,f.old,f.historical]){
  expect(await patch(id,{status:'in_progress'},alias)).toMatchObject({status:409,body:{error:'phone_task_owned'}});
  expect(await patch(id,{result:{handoff:{verdict:'forged'}}},alias)).toMatchObject({status:409,body:{error:'phone_task_owned'}});
 }
 expect(await f.snapshot()).toEqual(before);expect(h.block).not.toHaveBeenCalled();expect(h.finalize).not.toHaveBeenCalled();expect(h.terminal).not.toHaveBeenCalled();
});
it.each(['payload','claimed_by','claimed_at','executor_kind','pr_url','okr_initiative_id','success_metrics'])('nested raw %s mixed body cannot bypass phone execution protection',async field=>{
 await setup();const before=await f.snapshot();
 expect(await patch(f.owner,{title:'must not write',[field]:field==='payload'||field==='success_metrics'?{}:randomUUID()})).toMatchObject({status:409,body:{error:'phone_task_owned'}});
 expect(await f.snapshot()).toEqual(before);
});
it('nested same queued status is execution, pure metadata remains human editable',async()=>{
 await setup();expect((await patch(f.owner,{status:'queued'})).status).toBe(409);
 const response=await patch(f.owner,{title:'human title',priority:'P1',description:'human description'});
 expect(response).toMatchObject({status:200,body:{title:'human title',priority:'P1',description:'human description',status:'queued'}});
 expect((await f.pool.query('SELECT task_id FROM phone_task_owners WHERE task_id=$1',[f.owner])).rowCount).toBe(1);
});
it('phone description never silently requeues or clears historical preflight evidence; ordinary preserves recovery',async()=>{
 await setup();const before=(await f.pool.query('SELECT status,blocked_reason,metadata FROM tasks WHERE id=$1',[blocked])).rows[0];
 expect((await patch(blocked,{description:'human correction'})).status).toBe(200);
 expect((await f.pool.query('SELECT status,blocked_reason,metadata FROM tasks WHERE id=$1',[blocked])).rows[0]).toEqual(before);
 const id=await f.ordinary();await f.pool.query("UPDATE tasks SET status='blocked',blocked_reason='pre_flight_rejected',metadata=$2 WHERE id=$1",[id,{pre_flight_failed:true,pre_flight_fail_count:2,pre_flight_issues:['x'],pre_flight_suggestions:['y'],keep:'human'}]);
 expect(await patch(id,{description:'fixed'})).toMatchObject({status:200,body:{status:'queued',blocked_reason:null,metadata:{keep:'human'}}});
});
it('original pure input400 and absent404 retain actual canonical/nested registration contracts',async()=>{
 await setup();for(const id of [f.owner,await f.ordinary()]){
  expect(await patch(id,{title:'legacy metadata'},'canonical')).toMatchObject({status:400,body:{code:'MISSING_FIELD'}});
  expect(await patch(id,{status:'queued'},'canonical')).toMatchObject({status:400,body:{code:'INVALID_STATUS'}});
  expect(await patch(id,{result:[]},'canonical')).toMatchObject({status:400,body:{code:'INVALID_RESULT'}});
  expect(await patch(id,{})).toEqual({status:400,body:{error:'No fields to update'}});
 }
 const id=randomUUID();expect(await patch(id,{status:'in_progress'},'canonical')).toMatchObject({status:404,body:{code:'TASK_NOT_FOUND'}});
 expect(await patch(id,{title:'x'})).toEqual({status:404,body:{error:'Task not found',id}});
});
it.each(['canonical','nested'])('%s unknown actual owner table fails closed before mutation',async alias=>{
 await setup();const id=await f.ordinary();await f.pool.query('ALTER TABLE phone_task_owners RENAME TO fixture_unavailable_owner');
 try{expect((await patch(id,{status:'in_progress'},alias)).status).toBe(500);expect((await f.pool.query('SELECT status FROM tasks WHERE id=$1',[id])).rows[0].status).toBe('queued');}
 finally{await f.pool.query('ALTER TABLE fixture_unavailable_owner RENAME TO phone_task_owners');}
});
it.each(['canonical','nested'])('%s ordinary fakepayload and original status transitions remain compatible',async alias=>{
 await setup();const id=await f.ordinary({phone_authority:true,executor_kind:'phone-ssh-controller'});
 expect(await patch(id,{status:'in_progress'},alias)).toMatchObject({status:200,body:{status:'in_progress'}});
 expect(await patch(id,{status:'failed'},alias)).toMatchObject({status:200,body:{status:'failed'}});
});
it.each(['canonical','nested'])('%s real second-session DELETE yields404 before post-write effects',async alias=>{
 await setup();const id=await f.ordinary(),query=f.pool.query.bind(f.pool);let deleted=false;
 h.pool={options:f.pool.options,connect:()=>f.pool.connect(),query:async(sql,args)=>{
  if(/^UPDATE tasks SET/.test(sql)&&!deleted){const c=await f.pool.connect();try{expect((await c.query('DELETE FROM tasks WHERE id=$1',[id])).rowCount).toBe(1);deleted=true;}finally{c.release();}}
  return query(sql,args);
 }};
 expect((await patch(id,{status:'in_progress'},alias)).status).toBe(404);expect(deleted).toBe(true);expect(h.terminal).not.toHaveBeenCalled();
});
it.each(['canonical','nested'])('%s final exact SQL excludes protected IDs (native negative, not identity race)',async alias=>{
 await setup();const id=await f.ordinary(),query=f.pool.query.bind(f.pool);let mutation,args;
 h.pool={options:f.pool.options,connect:()=>f.pool.connect(),query:async(sql,values)=>{if(/^UPDATE tasks SET/.test(sql)){mutation=sql;args=values;}return query(sql,values);}};
 expect((await patch(id,{status:'in_progress'},alias)).status).toBe(200);const before=await f.snapshot();
 for(const phone of [f.owner,f.old,f.historical]){const values=[...args];values[values.length-1]=phone;expect((await query(mutation,values)).rowCount).toBe(0);}
 expect(await f.snapshot()).toEqual(before);
});
it.each(['canonical','nested'])('%s adapter unknown authority and inconsistent mutation count fail closed',async alias=>{
 await setup();const id=await f.ordinary(),query=f.pool.query.bind(f.pool);
 h.pool={options:f.pool.options,connect:()=>f.pool.connect(),query:async(sql,args)=>/ordinary_eligible/.test(sql)?{rows:[{id,ordinary_eligible:null}]}:query(sql,args)};
 expect((await patch(id,{status:'in_progress'},alias)).status).toBe(500);expect((await query('SELECT status FROM tasks WHERE id=$1',[id])).rows[0].status).toBe('queued');
 h.pool={options:f.pool.options,connect:()=>f.pool.connect(),query:async(sql,args)=>{const r=await query(sql,args);return /^UPDATE tasks SET/.test(sql)?{...r,rowCount:0}:r;}};
 expect((await patch(id,{status:'in_progress'},alias)).status).toBe(500);
});
it('ordinary legacy review blocking and finalizer seam with real pre-write preserve original response without extra status CAS',async()=>{
 await setup();const id=await f.ordinary({review_required:true},'P2','dev');await f.pool.query("UPDATE tasks SET status='in_progress' WHERE id=$1",[id]);
 expect(await patch(id,{status:'completed'},'canonical')).toMatchObject({status:422,body:{code:'REVIEW_NOT_APPROVED'}});expect(h.block).toHaveBeenCalledTimes(1);
 const harness=await f.ordinary({orchestrator:'skill-relay'},'P2','harness_initiative');await f.pool.query("UPDATE tasks SET status='in_progress' WHERE id=$1",[harness]);
 h.finalize.mockImplementation(async(task,{pool})=>{await pool.query("UPDATE tasks SET status='blocked' WHERE id=$1",[task]);return {applies:true,allow:false,reason:'fixture_not_merged'};});
 for(const alias of ['canonical','nested'])expect(await patch(harness,{status:'completed'},alias)).toMatchObject({status:200,body:{accepted:false,reason:'fixture_not_merged'}});
 expect((await f.pool.query('SELECT status FROM tasks WHERE id=$1',[harness])).rows[0].status).toBe('blocked');
});

it.each(['canonical','nested'])('%s phone completion rejects before review blocker or harness finalizer',async alias=>{
 await setup();const before=(await f.pool.query('SELECT * FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id',[[reviewPhone,harnessPhone]])).rows;
 for(const id of [reviewPhone,harnessPhone])expect(await patch(id,{status:'completed'},alias)).toMatchObject({status:409,body:{error:'phone_task_owned'}});
 expect((await f.pool.query('SELECT * FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id',[[reviewPhone,harnessPhone]])).rows).toEqual(before);
 expect(h.block).not.toHaveBeenCalled();expect(h.finalize).not.toHaveBeenCalled();expect(h.terminal).not.toHaveBeenCalled();
});
