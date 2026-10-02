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
if(DB_DEFAULTS.database!=='cecelia_scratch'&&!(process.env.CI==='true'&&/_test$/.test(DB_DEFAULTS.database)))throw Error('phone_recurring_fixture_scratch_required');
const admin=new pg.Client(DB_DEFAULTS);
let pool,engine,store,defaultDb;
const auth={registryAuthority:PHONE_SCHEDULE_REGISTRY_AUTHORITY};
const now=new Date();now.setSeconds(10,0);const due=new Date(now);due.setSeconds(0,0);
beforeAll(async()=>{
 await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 pool=new pg.Pool({...DB_DEFAULTS,max:1,connectionTimeoutMillis:500,options:`-c search_path=${schema}`});holder.pool=pool;
 expect((await pool.query('SELECT current_database() db,current_schema() schema')).rows[0]).toEqual({db:DB_DEFAULTS.database,schema});
 await createPhoneScheduleSchema(pool);await applyPhoneScheduleMigration(pool,'513_phone_scheduled_slots');
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
 const slot=action==='baseline'?null:new Date(due.getTime()-3600000);const id=await template({slot});await register(id,'active',new Date(Date.now()+400));
 await pool.query(`CREATE FUNCTION fixture_expiry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${id}'::uuid THEN PERFORM pg_sleep(.7); END IF; RETURN NEW; END $$;CREATE TRIGGER fixture_expiry BEFORE UPDATE ON recurring_tasks FOR EACH ROW EXECUTE FUNCTION fixture_expiry()`);
 try{const s=await run();expect(s.errors).toBe(1);expect((await row(id)).next_run_at).toEqual(slot);expect(await tasks(id)).toHaveLength(0);}finally{await pool.query('DROP TRIGGER fixture_expiry ON recurring_tasks;DROP FUNCTION fixture_expiry()');}
});
