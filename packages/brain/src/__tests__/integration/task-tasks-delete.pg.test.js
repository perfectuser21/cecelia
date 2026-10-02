import { afterEach, it, expect, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DB_DEFAULTS } from '../../db-config.js';
import { createPhoneClaimFixture } from '../fixtures/phone-claim-schema.js';
const h=vi.hoisted(()=>({pool:null}));
vi.mock('../../db.js',()=>({default:{get options(){return h.pool.options;},query:(...a)=>h.pool.query(...a),connect:()=>h.pool.connect()}}));
vi.mock('../../task-updater.js',()=>({broadcastTaskState:vi.fn(),blockTask:vi.fn()}));
let f,server,base;
afterEach(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}server=null;if(f)await f.close();f=null;});
async function setup(){
 f=await createPhoneClaimFixture(pool=>h.pool=pool);expect(f.location).toEqual({db:DB_DEFAULTS.database,schema:f.schema});
 const tasks=(await import('../../routes/task-tasks.js')).default,legacy=(await import('../../routes/tasks.js')).default;
 const app=express();app.use(express.json());app.use('/api/brain/tasks/tasks',tasks);app.use('/api/brain',legacy);app.use('/api/brain/tasks',tasks);
 server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
}
async function softDelete(id,alias='canonical'){
 const r=await fetch(`${base}/api/brain/tasks/${alias==='nested'?'tasks/':''}${id}`,{method:'DELETE'});return {status:r.status,body:await r.json()};
}
it.each(['canonical','nested'])('%s real scheduled owner / historical lease / raw executor refuses before soft cancellation',async alias=>{
 await setup();const before=await f.snapshot();
 for(const id of [f.owner,f.old,f.historical])expect(await softDelete(id,alias)).toEqual({status:409,body:{error:'phone_task_owned'}});
 expect(await f.snapshot()).toEqual(before);
});
it.each(['queued','pending','paused','blocked','in_progress','failed','archived',null])('ordinary original %s and shadow phone payload still soft cancel',async status=>{
 await setup();const id=await f.ordinary({executor_kind:'phone-ssh-controller',phone_authority:true,phone_schedule:{registered:true}});
 await f.pool.query('UPDATE tasks SET status=$2 WHERE id=$1',[id,status]);
 expect(await softDelete(id)).toMatchObject({status:200,body:{id,status:'cancelled',executor_kind:null}});
 expect((await f.pool.query('SELECT status,executor_kind,payload FROM tasks WHERE id=$1',[id])).rows[0]).toMatchObject({status:'cancelled',executor_kind:null,payload:{phone_authority:true}});
});
it.each(['canonical','nested'])('%s original missing404 and terminal completed/cancelled409 are exact',async alias=>{
 await setup();const absent=randomUUID();expect(await softDelete(absent,alias)).toEqual({status:404,body:{error:'Task not found',id:absent}});
 for(const status of ['completed','cancelled']){const id=await f.ordinary();await f.pool.query('UPDATE tasks SET status=$2 WHERE id=$1',[id,status]);
  expect(await softDelete(id,alias)).toEqual({status:409,body:{error:'State machine violation',details:`Cannot delete task in terminal status '${status}'`}});
  expect((await f.pool.query('SELECT status FROM tasks WHERE id=$1',[id])).rows[0].status).toBe(status);
 }
});
it.each(['canonical','nested'])('%s unknown native owner relation fails closed before UPDATE',async alias=>{
 await setup();const id=await f.ordinary();await f.pool.query('ALTER TABLE phone_task_owners RENAME TO fixture_unavailable_owner');
 try{expect((await softDelete(id,alias)).status).toBe(500);expect((await f.pool.query('SELECT status FROM tasks WHERE id=$1',[id])).rows[0].status).toBe('queued');}
 finally{await f.pool.query('ALTER TABLE fixture_unavailable_owner RENAME TO phone_task_owners');}
});
for(const alias of ['canonical','nested'])it.each(['delete','completed','cancelled'])(`${alias} real second-session %s never becomes a false soft-cancel success`,async change=>{
 await setup();const id=await f.ordinary(),query=f.pool.query.bind(f.pool);let changed=false;
 h.pool={options:f.pool.options,connect:()=>f.pool.connect(),query:async(sql,args)=>{
  if(/^UPDATE tasks SET status = 'cancelled'/.test(sql)&&!changed){const c=await f.pool.connect();try{
   const r=await c.query(change==='delete'?'DELETE FROM tasks WHERE id=$1':'UPDATE tasks SET status=$2 WHERE id=$1',change==='delete'?[id]:[id,change]);expect(r.rowCount).toBe(1);changed=true;
  }finally{c.release();}}
  return query(sql,args);
 }};
 const response=await softDelete(id,alias);expect(changed).toBe(true);
 if(change==='delete'){expect(response).toEqual({status:404,body:{error:'Task not found',id}});expect((await query('SELECT id FROM tasks WHERE id=$1',[id])).rows).toEqual([]);}
 else{expect(response).toEqual({status:409,body:{error:'State machine violation',details:`Cannot delete task in terminal status '${change}'`}});expect((await query('SELECT status FROM tasks WHERE id=$1',[id])).rows[0].status).toBe(change);}
});
it('exact final native SQL excludes protected IDs (SQL negative, no unlawful rebinding race)',async()=>{
 await setup();const id=await f.ordinary(),query=f.pool.query.bind(f.pool);let sql,args;
 h.pool={options:f.pool.options,connect:()=>f.pool.connect(),query:async(s,a)=>{if(/^UPDATE tasks SET status = 'cancelled'/.test(s)){sql=s;args=a;}return query(s,a);}};
 expect((await softDelete(id)).status).toBe(200);const before=await f.snapshot();
 for(const phone of [f.owner,f.old,f.historical]){const values=[...args];values[0]=phone;expect((await query(sql,values)).rowCount).toBe(0);}
 expect(await f.snapshot()).toEqual(before);
});
it.each(['canonical','nested'])('%s adapter unknown authority boolean fails closed before any write',async alias=>{
 await setup();const id=await f.ordinary(),query=f.pool.query.bind(f.pool);
 h.pool={options:f.pool.options,connect:()=>f.pool.connect(),query:async(sql,args)=>/ordinary_eligible/.test(sql)?{rows:[{status:'queued',ordinary_eligible:null}]}:query(sql,args)};
 expect((await softDelete(id,alias)).status).toBe(500);expect((await query('SELECT status FROM tasks WHERE id=$1',[id])).rows[0].status).toBe('queued');
});
for(const alias of ['canonical','nested'])it.each(['rowcount-zero','rows-empty','too-many'])(`${alias} adapter native mutation %s cannot report success`,async fault=>{
 await setup();const id=await f.ordinary(),query=f.pool.query.bind(f.pool);
 h.pool={options:f.pool.options,connect:()=>f.pool.connect(),query:async(sql,args)=>{
  const r=await query(sql,args);
  if(!/^UPDATE tasks SET status = 'cancelled'/.test(sql))return r;
  if(fault==='rowcount-zero')return {...r,rowCount:0};
  if(fault==='rows-empty')return {...r,rows:[]};
  return {...r,rowCount:2,rows:[r.rows[0],r.rows[0]]};
 }};
 expect((await softDelete(id,alias)).status).toBe(500);
 expect((await query('SELECT status FROM tasks WHERE id=$1',[id])).rows[0].status).toBe('cancelled');
});
it('adapter final0 while ordinary still exists reports conflict without false success',async()=>{
 await setup();const id=await f.ordinary(),query=f.pool.query.bind(f.pool);
 h.pool={options:f.pool.options,connect:()=>f.pool.connect(),query:(sql,args)=>/^UPDATE tasks SET status = 'cancelled'/.test(sql)?Promise.resolve({rowCount:0,rows:[]}):query(sql,args)};
 expect(await softDelete(id)).toEqual({status:409,body:{error:'task_delete_conflict'}});
 expect((await query('SELECT status FROM tasks WHERE id=$1',[id])).rows[0].status).toBe('queued');
});
