import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,it,expect} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
import express from 'express';
if(DB_DEFAULTS.database !== 'cecelia_scratch')throw Error('headed takeover migration tests require cecelia_scratch');
const schema=`headed_takeover_${process.pid}_${randomUUID().replaceAll('-','')}`;
const admin=new pg.Client(DB_DEFAULTS);
const pool=new pg.Pool({...DB_DEFAULTS,max:5,options:`-c search_path=${schema},public -c statement_timeout=1000`});
let task;
beforeAll(async()=>{
 await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE tasks(id uuid PRIMARY KEY,status text DEFAULT 'queued',task_type text DEFAULT 'data',executor_kind text DEFAULT 'bridge',claimed_by text,claimed_at timestamptz,started_at timestamptz,updated_at timestamptz DEFAULT now(),row_version integer DEFAULT 0,payload jsonb DEFAULT '{}',status_history jsonb DEFAULT '[]');
 CREATE TABLE headed_task_takeovers(task_id uuid PRIMARY KEY REFERENCES tasks(id),generation uuid NOT NULL,request_id uuid NOT NULL,session_id text NOT NULL,previous_run_id text,previous_owner jsonb NOT NULL,created_at timestamptz DEFAULT now());
 CREATE TABLE task_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid REFERENCES tasks(id),run_id text,status text DEFAULT 'running',ended_at timestamptz);
 CREATE TABLE initiative_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),current_task_id uuid REFERENCES tasks(id),phase text DEFAULT 'planning');
 CREATE TABLE harness_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid REFERENCES initiative_runs(id),status text DEFAULT 'queued');
 CREATE TABLE harness_attempt_cleanup_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid REFERENCES initiative_runs(id),status text DEFAULT 'pending');
 CREATE TABLE capacity_reservations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid REFERENCES tasks(id),status text DEFAULT 'reserved');
 CREATE TABLE kernel_controller_sessions(id text PRIMARY KEY,task_id uuid REFERENCES tasks(id),status text DEFAULT 'active');
 CREATE TABLE callback_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid REFERENCES tasks(id),run_id text,processed_at timestamptz);
 CREATE TABLE device_locks(device_name text PRIMARY KEY,locked_by text);
 CREATE TABLE schema_version(version text PRIMARY KEY,description text,applied_at timestamptz);
 CREATE TABLE work_routing_receipts(id uuid PRIMARY KEY,task_id uuid,canonical_task_type text,work_kind text);
 CREATE TABLE task_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid,event_type text,payload jsonb);
 CREATE TABLE harness_gaps(source_task_id uuid,status text);
 CREATE TABLE harness_gap_dependencies(source_task_id uuid,status text);
 CREATE TABLE task_dependencies(from_task_id uuid,edge_type text,status text);`);
 const migration=new URL('../../../migrations/508_headed_task_takeover.sql',import.meta.url);
 if(existsSync(migration))await pool.query(readFileSync(migration,'utf8'));
});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{task=randomUUID();const receipt=randomUUID();await pool.query('INSERT INTO tasks(id,payload) VALUES($1,$2)',[task,{routing_receipt_id:receipt,work_kind:'coding_review',current_run_id:'legacy-run',review_required:true}]);await pool.query("INSERT INTO work_routing_receipts(id,task_id,canonical_task_type,work_kind) VALUES($1,$2,'data','coding_review')",[receipt,task]);});
it('真实双连接：takeover先持task行锁，资源创建必须NOWAIT失败而不能持资源等task',async()=>{
 const owner=await pool.connect(),writer=await pool.connect();
 try{
  await owner.query('BEGIN');await owner.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[task]);
  const start=Date.now();
  await expect(writer.query('INSERT INTO task_runs(task_id,run_id) VALUES($1,$2)',[task,'race-run'])).rejects.toMatchObject({code:'55P03'});
  expect(Date.now()-start).toBeLessThan(750);
 }finally{await owner.query('ROLLBACK');owner.release();writer.release();}
});
const request=()=>({taskId:task,requestId:randomUUID(),sessionId:'actual-session',expectedRowVersion:0,expectedExecutorKind:'bridge',expectedCurrentRunId:'legacy-run'});
it('窄接管保持coding_review路由、旧run只unknown留痕，同request幂等不迁移二次owner',async()=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');
 const input=request(),first=await takeOverHeadedTask(pool,input),same=await takeOverHeadedTask(pool,input);
 expect(first.generation).toBe(same.generation);
 const row=(await pool.query('SELECT * FROM tasks WHERE id=$1',[task])).rows[0];
 expect(row).toMatchObject({status:'in_progress',executor_kind:'headed-session',claimed_by:'session:actual-session',task_type:'data'});
 expect(row.payload.work_kind).toBe('coding_review');expect(row.payload.review_required).toBe(true);expect(row.payload.current_run_id).toBeUndefined();
 expect(first.previous_owner.run_status).toBe('unknown');
 expect((await pool.query('SELECT * FROM task_events WHERE task_id=$1',[task])).rowCount).toBe(1);
 await expect(takeOverHeadedTask(pool,{...input,requestId:randomUUID(),sessionId:'other'})).rejects.toThrow('headed_takeover_conflict');
});
it.each(['task_runs','capacity_reservations','callback_queue'])('存在%s未决记录接管409，不改任何旧记录',async relation=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');
 await pool.query(`INSERT INTO ${relation}(task_id) VALUES($1)`,[task]);
 await expect(takeOverHeadedTask(pool,request())).rejects.toThrow('headed_takeover_active_execution');
 expect((await pool.query('SELECT status,executor_kind FROM tasks WHERE id=$1',[task])).rows[0]).toEqual({status:'queued',executor_kind:'bridge'});
 expect((await pool.query(`SELECT * FROM ${relation} WHERE task_id=$1`,[task])).rowCount).toBe(1);
});
it('真实HTTP：生产无token/错token拒绝；授权接管后仅本session PATCH心跳可写',async()=>{
 const {registerHeadedTakeoverRoute,headedTaskMutation}=await import('../../routes/task-headed-takeover.js');
 const app=express();app.use(express.json());registerHeadedTakeoverRoute(app,{pool});
 app.patch('/tasks/:id',headedTaskMutation(pool,async(req,res,db)=>{
  await db.query('UPDATE tasks SET updated_at=now() WHERE id=$1',[req.params.id]);res.json({ok:true});
 }));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,savedToken=process.env.CECELIA_INTERNAL_TOKEN,savedMode=process.env.NODE_ENV;
 const body=request();const send=(path,method,headers={},data=body)=>fetch(origin+path,{method,headers:{'content-type':'application/json','x-session-id':body.sessionId,...headers},body:JSON.stringify(data)});
 try{
  process.env.NODE_ENV='production';delete process.env.CECELIA_INTERNAL_TOKEN;
  expect((await send(`/tasks/${task}/headed-takeover`,'POST')).status).toBe(503);
  process.env.CECELIA_INTERNAL_TOKEN='isolated-test-internal-token';
  expect((await send(`/tasks/${task}/headed-takeover`,'POST')).status).toBe(401);
  const headers={authorization:'Bearer isolated-test-internal-token'};
  const response=await send(`/tasks/${task}/headed-takeover`,'POST',headers);expect(response.status).toBe(200);
  expect((await send(`/tasks/${task}`,'PATCH',{...headers,'x-session-id':'other'},{})).status).toBe(409);
  expect((await send(`/tasks/${task}`,'PATCH',headers,{})).status).toBe(200);
 }finally{if(savedToken===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=savedToken;process.env.NODE_ENV=savedMode;await new Promise(resolve=>server.close(resolve));}
});
it('持久接管后，任何迟到自动run/回执/预约INSERT都失败关闭',async()=>{
 await pool.query('INSERT INTO headed_task_takeovers(task_id,generation,request_id,session_id,previous_owner) VALUES($1,$2,$3,$4,$5)',[task,randomUUID(),randomUUID(),'actual-session',{kind:'bridge',run_status:'unknown'}]);
 for(const sql of [
  "INSERT INTO task_runs(task_id,run_id) VALUES($1,'late')",
  "INSERT INTO callback_queue(task_id,run_id) VALUES($1,'late')",
  'INSERT INTO capacity_reservations(task_id) VALUES($1)',
  "INSERT INTO kernel_controller_sessions(id,task_id) VALUES('late-'||$1::text,$1::uuid)",
  'INSERT INTO initiative_runs(current_task_id) VALUES($1)',
  "INSERT INTO device_locks(device_name,locked_by) VALUES('phone-'||$1::text,$1::text)",
 ])await expect(pool.query(sql,[task])).rejects.toThrow('headed_task_owned');
});
it('真实双连接：旧run先创建持task KEY SHARE，接管等提交后必须看见活run',async()=>{
 const writer=await pool.connect(),owner=await pool.connect();
 try{
  await writer.query('BEGIN');await writer.query("INSERT INTO task_runs(task_id,run_id) VALUES($1,'first')",[task]);
  await owner.query('BEGIN');
  const locking=owner.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[task]);
  await writer.query('COMMIT');await locking;
  const active=await owner.query('SELECT id FROM task_runs WHERE task_id=$1 AND ended_at IS NULL',[task]);
  expect(active.rowCount).toBe(1);
 }finally{await owner.query('ROLLBACK');await writer.query('ROLLBACK');owner.release();writer.release();}
});
