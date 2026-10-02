import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DB_DEFAULTS} from '../../db-config.js';
/** 仅私有真实PG fixture；不运行全量migrate，不写public，不创建数据库。 */
export async function deviceLockFixture({seedBeforeGuard}={}){
 if(DB_DEFAULTS.database!=='cecelia_scratch'&&!(process.env.CI==='true'&&DB_DEFAULTS.database==='cecelia_test'))throw Error('local scratch / exact CI test only');
 const schema='device_locks_'+randomUUID().replaceAll('-',''),admin=new pg.Client(DB_DEFAULTS);
 const pool=new pg.Pool({...DB_DEFAULTS,max:8,options:`-c search_path=${schema} -c statement_timeout=1500`});
 await admin.connect();
 if((await admin.query('SELECT current_database() AS db')).rows[0].db!==DB_DEFAULTS.database)throw Error('database identity mismatch');
 await admin.query(`CREATE SCHEMA ${schema}`);
 const close=async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();};
 try{
  await pool.query(`CREATE TABLE tasks(id UUID PRIMARY KEY,title TEXT,status TEXT DEFAULT 'queued',task_type TEXT DEFAULT 'data',executor_kind TEXT DEFAULT 'bridge',claimed_by TEXT,claimed_at TIMESTAMPTZ,started_at TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT now(),row_version INT DEFAULT 0,status_history JSONB DEFAULT '[]',payload JSONB DEFAULT '{}',result JSONB);
   CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ DEFAULT now());
   CREATE TABLE task_runs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),task_id UUID REFERENCES tasks(id),run_id TEXT,status TEXT DEFAULT 'running',ended_at TIMESTAMPTZ);
   CREATE TABLE initiative_runs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),current_task_id UUID REFERENCES tasks(id),phase TEXT DEFAULT 'planning');
   CREATE TABLE harness_attempts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),run_id UUID REFERENCES initiative_runs(id),status TEXT DEFAULT 'queued');
   CREATE TABLE harness_attempt_cleanup_outbox(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),run_id UUID REFERENCES initiative_runs(id),status TEXT DEFAULT 'pending');
   CREATE TABLE kernel_controller_sessions(id TEXT PRIMARY KEY,task_id UUID,run_id UUID REFERENCES initiative_runs(id),status TEXT DEFAULT 'active');
   CREATE TABLE capacity_reservations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),task_id UUID REFERENCES tasks(id),status TEXT DEFAULT 'reserved');
   CREATE TABLE callback_queue(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),task_id UUID REFERENCES tasks(id),run_id TEXT,processed_at TIMESTAMPTZ);
   CREATE TABLE work_routing_receipts(id UUID PRIMARY KEY,task_id UUID,canonical_task_type TEXT,work_kind TEXT);
   CREATE TABLE task_events(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),task_id UUID,event_type TEXT,payload JSONB);
   CREATE TABLE harness_gaps(source_task_id UUID REFERENCES tasks(id),status TEXT);CREATE TABLE harness_gap_dependencies(source_task_id UUID REFERENCES tasks(id),status TEXT);
   CREATE TABLE task_dependencies(from_task_id UUID,edge_type TEXT,status TEXT);`);
  for(const name of ['065_device_locks.sql','448_device_locks_phones.sql'])await pool.query(readFileSync(new URL('../../../migrations/'+name,import.meta.url),'utf8'));
  if(seedBeforeGuard)await seedBeforeGuard(pool);
  await pool.query(readFileSync(new URL('../../../migrations/509_headed_task_takeover.sql',import.meta.url),'utf8'));
  return {pool,schema,close};
 }catch(error){await close();throw error;}
}
