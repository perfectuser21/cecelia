import {assertPhoneFixtureDatabase} from '../__tests__/fixtures/phone-main-schema.js';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {DB_DEFAULTS} from '../db-config.js';
import {createPhoneScheduleSchema,applyPhoneScheduleMigration} from '../__tests__/fixtures/phone-schedule-schema.js';
import {importLegacyPolicy} from '../execution-directory/store.js';
import {LEGACY_BINDINGS} from '../execution-directory/legacy-policy.js';
import {PHONE_SCHEDULE_REGISTRY_AUTHORITY} from './task-authority.js';
const holder=vi.hoisted(()=>({pool:null,queries:[],broadcasts:[]}));
vi.mock('../db.js',()=>({default:{get options(){return holder.pool.options;},query:(...a)=>{holder.queries.push(String(a[0]));return holder.pool.query(...a);},connect:()=>holder.pool.connect()}}));
vi.mock('../event-bus.js',()=>({emit:vi.fn((...args)=>holder.broadcasts.push(args))}));
const schema=`phone_recurring_${process.pid}_${randomUUID().replaceAll('-','')}`;
assertPhoneFixtureDatabase(DB_DEFAULTS.database,process.env.CI,'phone_recurring_fixture_scratch_required');
const admin=new pg.Client(DB_DEFAULTS);
let pool,engine,store,defaultDb;
const auth={registryAuthority:PHONE_SCHEDULE_REGISTRY_AUTHORITY};
const now=new Date();now.setSeconds(10,0);const due=new Date(now);due.setSeconds(0,0);
beforeAll(async()=>{
 await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 pool=new pg.Pool({...DB_DEFAULTS,max:1,connectionTimeoutMillis:500,options:`-c search_path=${schema}`});holder.pool=pool;
 expect((await pool.query('SELECT current_database() db,current_schema() schema')).rows[0]).toEqual({db:DB_DEFAULTS.database,schema});
 await createPhoneScheduleSchema(pool);await applyPhoneScheduleMigration(pool,'517_phone_scheduled_slots');
 await pool.query(`ALTER TABLE tasks ADD COLUMN assigned_to TEXT,ADD COLUMN queued_at TIMESTAMPTZ DEFAULT now(),ADD COLUMN started_at TIMESTAMPTZ,ADD COLUMN error_message TEXT,ADD COLUMN status_history JSONB;
 ALTER TABLE recurring_tasks ADD COLUMN created_at TIMESTAMPTZ DEFAULT now(),ADD COLUMN executor TEXT;
 CREATE TABLE working_memory(key TEXT PRIMARY KEY,value_json JSONB,updated_at TIMESTAMPTZ DEFAULT now());`);
 for(const [,id,name]of LEGACY_BINDINGS)await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active') ON CONFLICT(id) DO NOTHING",[id,name]);
 await importLegacyPolicy({pool,env:{FLEET_WORKER_XIAN_MAC_M1_URL:'http://fixture:5231'}});
 store=await import('./schedule-store.js');engine=await import('../recurring.js');defaultDb=(await import('../db.js')).default;
},30000);
afterEach(async()=>{await pool.query('UPDATE recurring_tasks SET is_active=false');holder.queries=[];holder.broadcasts=[];});
afterAll(async()=>{if(pool)await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
async function template({phone=true,slot=due,extra={}}={}){const id=randomUUID();await pool.query("INSERT INTO recurring_tasks(id,title,task_type,cron_expression,recurrence_type,is_active,next_run_at,template) VALUES($1,$2,$3,'* * * * *','cron',true,$4,$5)",[id,`B1 ${id}`,phone?'device_job':'research',slot,{timezone:'UTC',catchup_minutes:30,...extra}]);return id;}
async function register(id,state='active',expiresAt=new Date(Date.now()+120000)){
 const phone={machine_id:'xian-mac-m1',serial:`fixture-${id}`,host:'xian-m1',profile:'fixture',account_id:'fixture',action:'adb_get_state'};
 await pool.query("INSERT INTO phone_registry(serial,nickname,host,profile,douyin_accounts,enabled) VALUES($1,'B1','xian-m1','fixture',$2,true)",[phone.serial,JSON.stringify([{id:'fixture',current:true}])]);
 const r=await store.registerPhoneSchedule(pool,{templateId:id,phone,expiresAt},auth);
 if(state!=='inactive')await store.setPhoneScheduleState(pool,{registrationId:r.id,revision:Number(r.revision),state},auth);return r;
}
async function row(id){return (await pool.query('SELECT * FROM recurring_tasks WHERE id=$1',[id])).rows[0];}
async function tasks(id){return (await pool.query("SELECT * FROM tasks WHERE payload->>'recurring_task_id'=$1",[id])).rows;}
async function run(){return engine.runRecurringTasksJob(defaultDb,{now});}
it('B1 registered模板经真实engine创建固定phone task/receipt/slot/owner',async()=>{const id=await template();await register(id);const s=await run();expect(s.errors).toBe(0);const t=await tasks(id);expect(t).toHaveLength(1);expect(t[0]).toMatchObject({executor_kind:'phone-ssh-controller',created_by:'phone-schedule-service',status:'queued'});expect((await pool.query('SELECT * FROM phone_task_owners WHERE task_id=$1',[t[0].id])).rows).toHaveLength(1);});
it.each(['inactive','revoked','expired','changed'])('B1 registry %s绝不回退ordinary及推进slot',async state=>{const id=await template();await register(id,state==='revoked'?'revoked':state==='inactive'?'inactive':'active',state==='expired'?new Date(Date.now()-1000):undefined);if(state==='changed')await pool.query("UPDATE recurring_tasks SET template=template||'{\"timezone\":\"Asia/Shanghai\"}' WHERE id=$1",[id]);const s=await run();expect(s.errors).toBe(1);expect(await tasks(id)).toHaveLength(0);expect((await row(id)).next_run_at).toEqual(due);});
it.each(['baseline','missed'])('B1 phone %s UPDATE触发器跨expiry后必须回滚',async action=>{
 const slot=action==='baseline'?null:new Date(due.getTime()-3600000);const id=await template({slot,extra:action==='missed'?{catchup_minutes:0}:{}});await register(id,'active',new Date(Date.now()+400));
 await pool.query(`CREATE FUNCTION fixture_expiry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${id}'::uuid THEN PERFORM pg_sleep(.7); END IF; RETURN NEW; END $$;CREATE TRIGGER fixture_expiry BEFORE UPDATE ON recurring_tasks FOR EACH ROW EXECUTE FUNCTION fixture_expiry()`);
 try{const s=await run();expect(s.errors).toBe(1);expect((await row(id)).next_run_at).toEqual(slot);expect(await tasks(id)).toHaveLength(0);}finally{await pool.query('DROP TRIGGER fixture_expiry ON recurring_tasks;DROP FUNCTION fixture_expiry()');}
});
async function registrationBarrier(id){
 const query=pg.Client.prototype.query;let pending,pid,classified=false;const trace=[];
 const spy=vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(sql,...args){
  const text=String(sql);trace.push({pid:this.processID,text});
  if(text.includes('pg_advisory_xact_lock')&&args[0]?.[0]===`phone-schedule:${id}`)pid=this.processID;
  const answer=query.call(this,sql,...args);
  if(text.includes('AS registered')&&args[0]?.[0]===id&&!classified){classified=true;return Promise.resolve(answer).then(async result=>{
   pending=register(id);pending.catch(()=>{});
   for(let i=0;i<100;i++){
    if(pid){const r=await admin.query("SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1",[pid]);if(r.rows[0]?.wait_event==='advisory')return result;}
    await new Promise(resolve=>setTimeout(resolve,5));
   }
   throw Error('fixture_registration_did_not_wait');
  });}
  return answer;
 });
 return {trace,async close(){try{await pending;}finally{spy.mockRestore();}}};
}
it.each(['missed','overlap','create_error'])('B1 默认真实P2 %s与pool max1注册等待不闭环',async branch=>{
 const id=await template({slot:branch==='missed'?new Date(due.getTime()-3600000):due,extra:branch==='missed'?{catchup_minutes:0}:{}});
 if(branch==='overlap'){await pool.query('UPDATE recurring_tasks SET skip_streak=2 WHERE id=$1',[id]);await pool.query("INSERT INTO tasks(title,status,task_type,trigger_source,payload) VALUES($1,'queued','research','recurring',$2)",[`open ${id}`,{recurring_task_id:id}]);}
 if(branch==='create_error')await pool.query(`CREATE FUNCTION fixture_receipt_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_id LIKE 'recurring:${id}:%' THEN RAISE EXCEPTION 'fixture_receipt_error';END IF;RETURN NEW;END $$;CREATE TRIGGER fixture_receipt_fail BEFORE INSERT ON work_routing_receipts FOR EACH ROW EXECUTE FUNCTION fixture_receipt_fail()`);
 const barrier=await registrationBarrier(id);
 try{
  const summary=await run();await barrier.close();
  expect(summary[branch==='missed'?'missed':branch==='overlap'?'skipped_overlap':'errors']).toBe(1);
  const saved=(await pool.query("SELECT value_json FROM working_memory WHERE key='alerting_buffers'")).rows[0].value_json;
  expect(saved.p2.some(x=>x.eventType===`recurring_${branch==='missed'?'missed':branch==='overlap'?'skip_streak':'create_failed'}_${id}`)).toBe(true);
  const unlock=barrier.trace.findIndex(x=>x.text.includes('pg_advisory_unlock'));
  const persist=barrier.trace.findIndex(x=>x.text.includes('working_memory'));expect(unlock).toBeGreaterThan(-1);expect(persist).toBeGreaterThan(unlock);
 }finally{await barrier.close();if(branch==='create_error')await pool.query('DROP TRIGGER fixture_receipt_fail ON work_routing_receipts;DROP FUNCTION fixture_receipt_fail()');}
},10000);
it('B1 createTask提交后metadata失败仍广播，再await告警；CAS及task/receipt原状保留',async()=>{
 const id=await template({phone:false,extra:{payload:{progress:7}}});
 await pool.query(`CREATE FUNCTION fixture_metadata_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->>'recurring_task_id'='${id}' AND NEW.due_at IS NOT NULL THEN RAISE EXCEPTION 'fixture_metadata_error';END IF;RETURN NEW;END $$;CREATE TRIGGER fixture_metadata_fail BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION fixture_metadata_fail()`);
 const trace=[];const query=pg.Client.prototype.query;const spy=vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(sql,...args){trace.push(String(sql));return query.call(this,sql,...args);});
 try{const summary=await run();expect(summary.errors).toBe(1);expect(summary.created).toHaveLength(0);const t=await tasks(id);expect(t).toHaveLength(1);expect(t[0].payload.routing_receipt_id).toBeTruthy();expect((await row(id)).last_run_status).toBe('error');expect((await row(id)).next_run_at.getTime()).toBeGreaterThan(due.getTime());expect(trace.filter(x=>x==='BEGIN')).toHaveLength(1);expect(trace.filter(x=>x==='COMMIT')).toHaveLength(1);expect(trace.findIndex(x=>x.includes('last_run_at = $2'))).toBeLessThan(trace.indexOf('BEGIN'));expect(trace.indexOf('COMMIT')).toBeLessThan(trace.findIndex(x=>x.includes('SET assigned_to')));const unlock=trace.findIndex(x=>x.includes('pg_advisory_unlock'));expect(unlock).toBeGreaterThan(-1);const broadcast=trace.findIndex(x=>x==='SELECT * FROM tasks WHERE id = $1');const persist=trace.findIndex(x=>x.includes('INSERT INTO working_memory'));expect(broadcast).toBeGreaterThan(unlock);expect(persist).toBeGreaterThan(broadcast);}finally{spy.mockRestore();await pool.query('DROP TRIGGER fixture_metadata_fail ON tasks;DROP FUNCTION fixture_metadata_fail()');}
});
it('B1 真PGquerytimeout销毁唯一session，未知在途不早unlock，注册最终可取同gate',async()=>{
 const {withRecurringTemplateGate}=await import('./recurring-dispatch.js');const id=randomUUID();let captured;
 const query=pg.Client.prototype.query;const trace=[];const spy=vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(sql,...args){trace.push(String(sql));return query.call(this,sql,...args);});
 try{await expect(withRecurringTemplateGate(defaultDb,id,c=>c.query('SELECT pg_sleep(.5)'),{clientFactory:config=>{captured=new pg.Client({...config,query_timeout:50});return captured;}})).rejects.toMatchObject({message:'phone_schedule_gate_release_unknown',gateSessionClosed:false,cause:expect.objectContaining({message:expect.stringContaining('timeout')})});expect(trace.some(x=>x.includes('pg_advisory_unlock'))).toBe(false);let lock=false;for(let i=0;i<100&&!lock;i++){lock=(await pool.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[`phone-schedule:${id}`])).rows[0].locked;if(!lock)await new Promise(r=>setTimeout(r,10));}expect(lock).toBe(true);await pool.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`phone-schedule:${id}`]);}finally{spy.mockRestore();}
});
it('B1 并发真实job同registered slot仅一个owner，busy不ordinary fallback',async()=>{const id=await template();await register(id);const sums=await Promise.all([run(),run()]);expect(sums.reduce((n,s)=>n+s.created.length,0)).toBe(1);expect(await tasks(id)).toHaveLength(1);});
it('B1 registered查询SQL失败拒绝，没有ordinary task或推进',async()=>{const id=await template();await pool.query('ALTER TABLE phone_schedule_registrations RENAME TO fixture_registration_unavailable');try{const s=await run();expect(s.errors).toBe(1);expect(await tasks(id)).toHaveLength(0);expect((await row(id)).next_run_at).toEqual(due);}finally{await pool.query('ALTER TABLE fixture_registration_unavailable RENAME TO phone_schedule_registrations');}});
it('B1 普通模板payload伪phone authority不升权，原receipt/metadata事务保留',async()=>{const id=await template({phone:false,extra:{executor_kind:'phone-ssh-controller',phone_authority:true,payload:{policy:'phone-schedule-v1',verified:true}}});const s=await run();expect(s.created).toHaveLength(1);const t=(await tasks(id))[0];expect(t.executor_kind).toBeNull();expect(t.created_by).not.toBe('phone-schedule-service');expect(t.payload.routing_receipt_id).toBeTruthy();expect(t.due_at).toBeInstanceOf(Date);expect((await pool.query('SELECT * FROM phone_task_owners WHERE task_id=$1',[t.id])).rows).toEqual([]);});
it.each(['baseline','missed'])('B1 active phone %s正确推进且无task/owner',async action=>{const id=await template({slot:action==='baseline'?null:new Date(due.getTime()-3600000),extra:action==='missed'?{catchup_minutes:0}:{}});await register(id);const s=await run();expect(s[action]).toBe(1);expect((await row(id)).next_run_at.getTime()).toBeGreaterThan(now.getTime());expect(await tasks(id)).toHaveLength(0);});
it('B1 真实idle session EOF永久fatal，不再写业务且关闭自己的session',async()=>{const {withRecurringTemplateGate}=await import('./recurring-dispatch.js');let next=false;await expect(withRecurringTemplateGate(defaultDb,randomUUID(),async c=>{await admin.query('SELECT pg_terminate_backend($1)',[c.processID]);await new Promise(r=>setTimeout(r,30));await c.query('SELECT 1');next=true;})).rejects.toThrow();expect(next).toBe(false);});
it('B1 真实子进程SIGKILL只释放自己的session gate，注册随后取得同key',async()=>{
 const {spawn}=await import('node:child_process');const id=randomUUID();
 const source=`import {withRecurringTemplateGate} from './src/phone-dispatch/recurring-dispatch.js';import {DB_DEFAULTS} from './src/db-config.js';await withRecurringTemplateGate({options:{...DB_DEFAULTS,options:process.env.B1_FIXTURE_OPTIONS}},process.env.B1_FIXTURE_ID,async()=>{process.stdout.write('FIXTURE_GATE_HELD\\n');await new Promise(()=>{});});`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{cwd:process.cwd(),env:{...process.env,DB_NAME:DB_DEFAULTS.database,B1_FIXTURE_OPTIONS:`-c search_path=${schema}`,B1_FIXTURE_ID:id},stdio:['ignore','pipe','pipe']});
 const closed=new Promise(resolve=>child.once('close',resolve));
 try{await new Promise((resolve,reject)=>{let raw='';const timer=setTimeout(()=>reject(Error('fixture_child_not_ready')),3000);child.stdout.on('data',chunk=>{raw+=chunk;if(raw.includes('FIXTURE_GATE_HELD')){clearTimeout(timer);resolve();}});child.once('error',reject);});
  expect((await pool.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[`phone-schedule:${id}`])).rows[0].locked).toBe(false);
  child.kill('SIGKILL');await closed;await pool.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[`phone-schedule:${id}`]);await pool.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`phone-schedule:${id}`]);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;}
},10000);

it('B1 custom DB普通建单不新增默认广播',async()=>{const id=await template({phone:false});const query=pg.Client.prototype.query;const trace=[];const spy=vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(sql,...args){trace.push(String(sql));return query.call(this,sql,...args);});try{const summary=await engine.runRecurringTasksJob(pool,{now});expect(summary.created).toHaveLength(1);expect(trace).not.toContain('SELECT * FROM tasks WHERE id = $1');expect((await tasks(id))[0].payload.routing_receipt_id).toBeTruthy();}finally{spy.mockRestore();}});
it.each(['baseline','missed'])('B1 %s UPDATE触发器改变真实template指纹必须回滚',async action=>{
 const slot=action==='baseline'?null:new Date(due.getTime()-3600000);const id=await template({slot,extra:action==='missed'?{catchup_minutes:0}:{}});await register(id);const before=await row(id);
 await pool.query(`CREATE FUNCTION fixture_fingerprint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${id}'::uuid THEN NEW.template:=NEW.template||'{"profile":"changed-in-trigger"}'::jsonb; END IF;RETURN NEW;END $$;CREATE TRIGGER fixture_fingerprint BEFORE UPDATE ON recurring_tasks FOR EACH ROW EXECUTE FUNCTION fixture_fingerprint()`);
 try{const summary=await run();expect(summary.errors).toBe(1);expect((await row(id)).template).toEqual(before.template);expect((await row(id)).next_run_at).toEqual(slot);expect(await tasks(id)).toHaveLength(0);expect((await pool.query('SELECT * FROM phone_task_owners WHERE template_id=$1',[id])).rows).toHaveLength(0);}finally{await pool.query('DROP TRIGGER fixture_fingerprint ON recurring_tasks;DROP FUNCTION fixture_fingerprint()');}
});
it('B1 真PG慢取锁只等内部1秒，600秒业务配置不能放大且不调用业务',async()=>{
 const {withRecurringTemplateGate}=await import('./recurring-dispatch.js');let invoked=false,acquire;
 await expect(withRecurringTemplateGate({options:{...pool.options,query_timeout:600000}},randomUUID(),()=>{invoked=true;},{clientFactory:config=>{
  expect(config.connectionTimeoutMillis).toBe(1000);const c=new pg.Client(config);const query=c.query.bind(c);
  c.query=(request,...args)=>{if(request?.text?.includes('pg_try_advisory_lock')){acquire=request;expect(request.query_timeout).toBe(1000);return query({...request,text:'SELECT pg_sleep(2) AS locked,$1::text AS fixture_key'},...args);}return query(request,...args);};return c;
 }})).rejects.toMatchObject({message:'phone_schedule_gate_release_unknown',gateSessionClosed:false,cause:expect.objectContaining({message:expect.stringContaining('timeout')})});expect(invoked).toBe(false);expect(acquire.text).toBe('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked');
});
it.each(['querytimeout','idleEOF'])('B1 已提交task及capture广播后%s不把本地close当释放证明或flush',async fault=>{
 const id=await template({phone:false});let hit=false;
 if(fault==='querytimeout')await pool.query(`CREATE FUNCTION fixture_effect_timeout() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->>'recurring_task_id'='${id}' AND NEW.due_at IS NOT NULL THEN PERFORM pg_sleep(.3);END IF;RETURN NEW;END $$;CREATE TRIGGER fixture_effect_timeout BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION fixture_effect_timeout()`);
 const query=pg.Client.prototype.query;const trace=[];const spy=vi.spyOn(pg.Client.prototype,'query').mockImplementation(function(sql,...args){trace.push(typeof sql==='string'?sql:sql.text);if(typeof sql==='string'&&sql.includes('SET assigned_to')&&!hit){hit=true;if(fault==='querytimeout')return query.call(this,{text:sql,values:args[0],query_timeout:30});return admin.query('SELECT pg_terminate_backend($1)',[this.processID]).then(()=>query.call(this,sql,...args));}return query.call(this,sql,...args);});
 try{await run();expect(hit).toBe(true);expect(trace).not.toContain('SELECT * FROM tasks WHERE id = $1');expect(trace.some(s=>s.includes('INSERT INTO working_memory'))).toBe(false);expect(await tasks(id)).toHaveLength(1);}finally{spy.mockRestore();if(fault==='querytimeout')await pool.query('DROP TRIGGER fixture_effect_timeout ON tasks;DROP FUNCTION fixture_effect_timeout()');}
});
