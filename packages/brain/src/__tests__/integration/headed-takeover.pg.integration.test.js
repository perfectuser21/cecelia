import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeAll,afterAll,beforeEach,it,expect} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
import express from 'express';
if(DB_DEFAULTS.database!=='cecelia_scratch'&&!(process.env.CI==='true'&&DB_DEFAULTS.database==='cecelia_test'))throw Error('本地迁移仅cecelia_scratch；CI仅cecelia_test');
const schema=`headed_takeover_${process.pid}_${randomUUID().replaceAll('-','')}`;
const admin=new pg.Client(DB_DEFAULTS);
const pool=new pg.Pool({...DB_DEFAULTS,max:5,options:`-c search_path=${schema},public -c statement_timeout=1000`});
let task,legacyRun;
const handoffDocs=mkdtempSync(join(tmpdir(),'headed-takeover-handoff-'));
beforeAll(async()=>{
 await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE tasks(id uuid PRIMARY KEY,status text DEFAULT 'queued',task_type text DEFAULT 'data',executor_kind text DEFAULT 'bridge',claimed_by text,claimed_at timestamptz,started_at timestamptz,updated_at timestamptz DEFAULT now(),row_version integer DEFAULT 0,payload jsonb DEFAULT '{}',status_history jsonb DEFAULT '[]',result jsonb,completed_at timestamptz,quota_exhausted_at timestamptz,pr_url text,pr_status text,error_message text,blocked_detail jsonb);
 CREATE TABLE task_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid REFERENCES tasks(id),run_id text,status text DEFAULT 'running',ended_at timestamptz);
 CREATE TABLE initiative_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),current_task_id uuid REFERENCES tasks(id),phase text DEFAULT 'planning');
 CREATE TABLE harness_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid REFERENCES initiative_runs(id),status text DEFAULT 'queued');
 CREATE TABLE harness_attempt_cleanup_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid REFERENCES initiative_runs(id),status text DEFAULT 'pending');
 CREATE TABLE capacity_reservations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid REFERENCES tasks(id),status text DEFAULT 'reserved');
 CREATE TABLE kernel_controller_sessions(id text PRIMARY KEY,task_id uuid REFERENCES tasks(id),run_id uuid,status text DEFAULT 'active');
 CREATE TABLE callback_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid REFERENCES tasks(id),run_id text,processed_at timestamptz);
 CREATE TABLE device_locks(device_name text PRIMARY KEY,locked_by text);
 CREATE TABLE schema_version(version text PRIMARY KEY,description text,applied_at timestamptz);
 CREATE TABLE work_routing_receipts(id uuid PRIMARY KEY,task_id uuid,canonical_task_type text,work_kind text);
 CREATE TABLE task_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid,event_type text,payload jsonb);
 ALTER TABLE tasks ADD COLUMN success_metrics jsonb;
 ALTER TABLE tasks ADD COLUMN title text,ADD COLUMN description text,ADD COLUMN priority text,ADD COLUMN due_at timestamptz,ADD COLUMN notion_id text,ADD COLUMN notion_synced_at timestamptz,ADD COLUMN notion_props jsonb,ADD COLUMN parent_task_id uuid,ADD COLUMN project_id uuid,ADD COLUMN summary text;
 CREATE TABLE harness_gaps(source_task_id uuid,status text);
 CREATE TABLE harness_gap_dependencies(source_task_id uuid,status text);
 CREATE TABLE task_dependencies(from_task_id uuid,edge_type text,status text);`);
 const migration=new URL('../../../migrations/508_headed_task_takeover.sql',import.meta.url);
 if(existsSync(migration))await pool.query(readFileSync(migration,'utf8'));
});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();rmSync(handoffDocs,{recursive:true,force:true});});
beforeEach(async()=>{task=randomUUID();legacyRun='legacy-'+task;const receipt=randomUUID();await pool.query('INSERT INTO tasks(id,payload) VALUES($1,$2)',[task,{routing_receipt_id:receipt,work_kind:'coding_review',current_run_id:legacyRun,review_required:true}]);await pool.query("INSERT INTO work_routing_receipts(id,task_id,canonical_task_type,work_kind) VALUES($1,$2,'data','coding_review')",[receipt,task]);});
it('真实双连接：takeover先持专用exclusive闸，资源创建try shared失败，不等task',async()=>{
 const owner=await pool.connect(),writer=await pool.connect();
 try{
  await owner.query('BEGIN');await owner.query("SELECT pg_advisory_xact_lock(hashtextextended('headed_task_owner:'||$1::text,0))",[task]);
  const start=Date.now();
  await expect(writer.query('INSERT INTO task_runs(task_id,run_id) VALUES($1,$2)',[task,'race-run'])).rejects.toMatchObject({code:'55P03'});
  expect(Date.now()-start).toBeLessThan(750);
 }finally{await owner.query('ROLLBACK');owner.release();writer.release();}
});
const request=()=>({taskId:task,requestId:randomUUID(),sessionId:'actual-session',expectedRowVersion:0,expectedExecutorKind:'bridge',expectedCurrentRunId:legacyRun});
it.each([false,true])('真实Notion生产SQL existing/newpage=%s可记投影指纹，payload/status/result仍保护',async newPage=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');await takeOverHeadedTask(pool,request());
 const before=(await pool.query('SELECT payload,status,result FROM tasks WHERE id=$1',[task])).rows[0];
 // notion-push-sync.js pushTaskRows的两条真实SQL，blockedBy开启的完整指纹。
 if(newPage)await pool.query("UPDATE tasks SET notion_id=$2, notion_props = COALESCE(notion_props,'{}'::jsonb) || jsonb_build_object('pushed_status', $3::text, 'pushed_project', $4::text, 'pushed_blockers', $5::text), notion_synced_at=NOW() WHERE id=$1",[task,'newpage-fixture','in_progress','project-fixture','blocker-fixture']);
 else await pool.query("UPDATE tasks SET notion_props = COALESCE(notion_props,'{}'::jsonb) || jsonb_build_object('pushed_status', $2::text, 'pushed_project', $3::text, 'pushed_blockers', $4::text), notion_synced_at=NOW() WHERE id=$1",[task,'in_progress','project-fixture','blocker-fixture']);
 const after=(await pool.query('SELECT payload,status,result,notion_props,notion_id,notion_synced_at FROM tasks WHERE id=$1',[task])).rows[0];
 expect(after).toMatchObject(before);expect(after.notion_props).toEqual({pushed_status:'in_progress',pushed_project:'project-fixture',pushed_blockers:'blocker-fixture'});expect(after.notion_synced_at).toBeInstanceOf(Date);if(newPage)expect(after.notion_id).toBe('newpage-fixture');
 for(const mutation of ["result='{}'::jsonb","payload='{}'::jsonb","status='queued'"]){await expect(pool.query(`UPDATE tasks SET notion_props='{}'::jsonb,${mutation} WHERE id=$1`,[task])).rejects.toThrow('headed_task_owned');}
});
it('owner在执行中和完成后均不阻止人赢title/due_at及Notion同步元数据，结果证据仍保护',async()=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');
 const owner=await takeOverHeadedTask(pool,request());
 for(const terminal of [false,true]){
  if(terminal){const db=await pool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('cecelia.headed_owner_generation',$1,true)",[owner.generation]);await db.query("UPDATE tasks SET status='completed',claimed_by=NULL,claimed_at=NULL WHERE id=$1",[task]);await db.query('COMMIT');}finally{db.release();}}
  await pool.query("UPDATE tasks SET title=$2,due_at='2026-10-03T00:00:00Z',notion_id='human-note',notion_synced_at=now(),updated_at=now() WHERE id=$1",[task,terminal?'人赢完成标题':'人赢执行中标题']);
  const row=(await pool.query('SELECT title,due_at,notion_synced_at,result FROM tasks WHERE id=$1',[task])).rows[0];
  expect(row.title).toBe(terminal?'人赢完成标题':'人赢执行中标题');expect(row.due_at.toISOString()).toBe('2026-10-03T00:00:00.000Z');expect(row.notion_synced_at).toBeInstanceOf(Date);expect(row.result).toBeNull();
  await expect(pool.query("UPDATE tasks SET result='{}' WHERE id=$1",[task])).rejects.toThrow('headed_task_owned');
 }
});
it('真实终态helper在外层COMMIT后保存handoff，跨session元数据可编辑但证据不可覆写',async()=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');await takeOverHeadedTask(pool,request());
 const {registerTaskPatchRoute}=await import('../../routes/task-task-patch.js');
 const router=express.Router();registerTaskPatchRoute(router,{pool,terminalStatuses:['completed','failed','cancelled']});
 const app=express();app.use(express.json());app.use('/tasks',router);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,savedToken=process.env.CECELIA_INTERNAL_TOKEN,savedDocs=process.env.HANDOFF_DOCS_DIR;
 process.env.CECELIA_INTERNAL_TOKEN='terminal-owner-fixture';process.env.HANDOFF_DOCS_DIR=handoffDocs;
 const send=(body,owned=true)=>fetch(`${origin}/tasks/${task}`,{method:'PATCH',headers:{'content-type':'application/json',...(owned?{authorization:'Bearer terminal-owner-fixture','x-session-id':'actual-session'}:{'x-session-id':'human-editor'})},body:JSON.stringify(body)});
 try{
  const completed=await send({status:'completed'});const receipt=await completed.json();expect(completed.status,JSON.stringify(receipt)).toBe(200);expect(receipt.relay).toMatchObject({synthesized:true});
  const handoff=(await pool.query("SELECT result->'handoff' AS handoff FROM tasks WHERE id=$1",[task])).rows[0].handoff;
  expect(handoff).toMatchObject({task_id:task,session_id:'actual-session',synthesized:true});
  expect((await send({title:'完成后人类校正标题'},false)).status).toBe(200);
  expect((await send({result:{handoff:{verdict:'forged'}}},false)).status).toBe(401);
  expect((await pool.query("SELECT result->'handoff' AS handoff FROM tasks WHERE id=$1",[task])).rows[0].handoff).toEqual(handoff);
 }finally{if(savedToken===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=savedToken;if(savedDocs===undefined)delete process.env.HANDOFF_DOCS_DIR;else process.env.HANDOFF_DOCS_DIR=savedDocs;await new Promise(resolve=>server.close(resolve));}
});
it('普通任务FOR UPDATE仍保持既有FK等待，guard不新增55P03',async()=>{
 const owner=await pool.connect(),writer=await pool.connect();
 try{
  await pool.query("UPDATE tasks SET executor_kind='brain-local' WHERE id=$1",[task]);
  await owner.query('BEGIN');await owner.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[task]);
  const outcome=writer.query('INSERT INTO task_runs(task_id,run_id) VALUES($1,$2)',[task,'ordinary-lock-run']).then(()=>({ok:true}),error=>({error}));
  await owner.query('SELECT pg_sleep(0.05)');await owner.query('ROLLBACK');
  expect(await outcome).toEqual({ok:true});
 }finally{await owner.query('ROLLBACK');owner.release();writer.release();}
});
it('writer先持shared闸，API立即409；writer提交后API仍按active资源409',async()=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');
 const writer=await pool.connect();
 try{
  await writer.query('BEGIN');await writer.query('INSERT INTO task_runs(task_id,run_id) VALUES($1,$2)',[task,'uncommitted-real-run']);
  await expect(takeOverHeadedTask(pool,request())).rejects.toMatchObject({statusCode:409});
  await writer.query('COMMIT');await expect(takeOverHeadedTask(pool,request())).rejects.toMatchObject({statusCode:409});
 }finally{await writer.query('ROLLBACK');writer.release();}
});
it('API不持exclusive闸等待既有task行锁，立即409并释放闸',async()=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');
 const writer=await pool.connect();
 try{
  await writer.query('BEGIN');await writer.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[task]);
  await expect(takeOverHeadedTask(pool,request())).rejects.toMatchObject({statusCode:409});
  expect((await pool.query("SELECT pg_try_advisory_xact_lock(hashtextextended('headed_task_owner:'||$1::text,0)) AS available",[task])).rows[0].available).toBe(true);
 }finally{await writer.query('ROLLBACK');writer.release();}
});
it('旧REPEATABLE READ快照writer失败关闭，不能获得闸后遗漏已提交owner',async()=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');
 const other=randomUUID();await pool.query("INSERT INTO tasks(id,executor_kind) VALUES($1,'brain-local')",[other]);
 const writer=await pool.connect();
 try{
  await writer.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await writer.query('SELECT * FROM tasks WHERE id=$1',[task]);
  await takeOverHeadedTask(pool,request());
  await expect(writer.query('INSERT INTO callback_queue(task_id,run_id) VALUES($1,$2)',[other,legacyRun])).rejects.toThrow('headed_guard_isolation_unsupported');
 }finally{await writer.query('ROLLBACK');writer.release();}
});
it('真实MVCC：INSERT语句先取快照，在接管提交后才进入guard，仍读到持久旧run映射',async()=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');
 const other=randomUUID();await pool.query("INSERT INTO tasks(id,executor_kind) VALUES($1,'brain-local')",[other]);
 const barrier=randomUUID();
 await pool.query(`CREATE FUNCTION pause_owner_fixture() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('${barrier}',0));RETURN NEW;END;$$;
  CREATE TRIGGER a0_snapshot_barrier BEFORE INSERT ON callback_queue FOR EACH ROW EXECUTE FUNCTION pause_owner_fixture();`);
 const holder=await pool.connect(),writer=await pool.connect();
 let outcome;
 try{
  await holder.query('BEGIN');await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[barrier]);
  const pid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  outcome=writer.query('INSERT INTO callback_queue(task_id,run_id) VALUES($1,$2)',[other,legacyRun]).then(()=>({ok:true}),error=>({error}));
  let blocked=false;
  for(let i=0;i<20;i++){blocked=(await pool.query('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS blocked',[pid])).rows[0].blocked;if(blocked)break;await pool.query('SELECT pg_sleep(0.005)');}
  expect(blocked).toBe(true);await takeOverHeadedTask(pool,request());await holder.query('ROLLBACK');
  expect((await outcome).error?.message).toContain('headed_task_owned');
 }finally{
  await holder.query('ROLLBACK');if(outcome)await outcome;holder.release();writer.release();
  await pool.query('DROP TRIGGER a0_snapshot_barrier ON callback_queue;DROP FUNCTION pause_owner_fixture();');
  await pool.query('DELETE FROM callback_queue WHERE task_id=$1',[other]);
 }
});
it('旧run关联不同task_id也不能越过原task的持久owner屏障',async()=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');
 await takeOverHeadedTask(pool,request());
 const other=randomUUID();await pool.query("INSERT INTO tasks(id,executor_kind) VALUES($1,'brain-local')",[other]);
 try{await expect(pool.query('INSERT INTO callback_queue(task_id,run_id) VALUES($1,$2)',[other,legacyRun])).rejects.toThrow('headed_task_owned');}
 finally{await pool.query('DELETE FROM callback_queue WHERE task_id=$1',[other]);}
});
it('持久owner本人也不能删除callback屏障marker或再迁移executor',async()=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');
 const owner=await takeOverHeadedTask(pool,request());
 const db=await pool.connect();
 try{
  for(const sql of ["UPDATE tasks SET payload=payload-'headed_takeover' WHERE id=$1","UPDATE tasks SET executor_kind='bridge' WHERE id=$1"]){
   await db.query('BEGIN');await db.query("SELECT set_config('cecelia.headed_owner_generation',$1,true)",[owner.generation]);
   await expect(db.query(sql,[task])).rejects.toThrow('headed_task_identity_immutable');await db.query('ROLLBACK');
  }
 }finally{await db.query('ROLLBACK');db.release();}
});
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
 await expect(takeOverHeadedTask(pool,{...input,expectedRowVersion:99})).rejects.toThrow('headed_takeover_conflict');
});
it('task_run有ended_at但状态仍running不足以证明终态，接管409',async()=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');
 await pool.query("INSERT INTO task_runs(task_id,run_id,status,ended_at) VALUES($1,$2,'running',now())",[task,legacyRun]);
 await expect(takeOverHeadedTask(pool,request())).rejects.toThrow('headed_takeover_active_execution');
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
 const {registerTaskPatchRoute}=await import('../../routes/task-task-patch.js');
 const fieldRouter=express.Router();registerTaskPatchRoute(fieldRouter,{pool,terminalStatuses:['completed','failed','cancelled']});app.use('/fields',fieldRouter);
 app.patch('/tasks/:id',headedTaskMutation(pool,async(req,res,db)=>{
  await db.query('SELECT status FROM tasks WHERE id=$1',[req.params.id]);
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
  const fields=await send(`/fields/${task}`,'PATCH',headers,{result:{substage:'facts'}});expect(fields.status,JSON.stringify(await fields.json())).toBe(200);
  expect((await send(`/tasks/${task}`,'PATCH',{...headers,'x-session-id':'other'},{})).status).toBe(409);
  expect((await send(`/tasks/${task}`,'PATCH',headers,{})).status).toBe(200);
 }finally{if(savedToken===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=savedToken;process.env.NODE_ENV=savedMode;await new Promise(resolve=>server.close(resolve));}
});
it('队列处理器拒绝有run_id和缺run_id的旧回调，保持新owner',async()=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');
 await takeOverHeadedTask(pool,request());
 const {processExecutionCallback}=await import('../../callback-processor.js');
 const seen=[];const guarded={query:(...args)=>{seen.push(args[0]);return pool.query(...args);},connect:()=>pool.connect()};
 for(const run_id of [legacyRun,undefined])await expect(processExecutionCallback({task_id:task,run_id,status:'AI Done'},guarded)).rejects.toThrow('headed_task_owned');
 expect(seen.every(sql=>sql.includes('headed_takeover'))).toBe(true);
 expect((await pool.query('SELECT status,claimed_by FROM tasks WHERE id=$1',[task])).rows[0]).toEqual({status:'in_progress',claimed_by:'session:actual-session'});
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
it('普通任务已有更新锁不受影响；同事务常规run创建仍可用',async()=>{
 const updater=await pool.connect(),writer=await pool.connect();
 try{
  await updater.query('BEGIN');await updater.query("UPDATE tasks SET payload=payload||'{\"ordinary\":true}'::jsonb WHERE id=$1",[task]);
  await writer.query("INSERT INTO task_runs(task_id,run_id) VALUES($1,'normal-peer')",[task]);
  await updater.query("INSERT INTO task_runs(task_id,run_id) VALUES($1,'normal-own')",[task]);
  await updater.query('COMMIT');
  expect((await pool.query('SELECT id FROM task_runs WHERE task_id=$1',[task])).rowCount).toBe(2);
 }finally{await updater.query('ROLLBACK');updater.release();writer.release();}
});
it('已接管历史run的attempt和cleanup间接映射也被保护；缺失parent失败关闭',async()=>{
 const run=randomUUID();await pool.query("INSERT INTO initiative_runs(id,current_task_id,phase) VALUES($1,$2,'done')",[run,task]);
 await pool.query('INSERT INTO headed_task_takeovers(task_id,generation,request_id,session_id,previous_owner) VALUES($1,$2,$3,$4,$5)',[task,randomUUID(),randomUUID(),'actual-session',{run_status:'unknown'}]);
 for(const relation of ['harness_attempts','harness_attempt_cleanup_outbox']){
  await expect(pool.query(`INSERT INTO ${relation}(run_id) VALUES($1)`,[run])).rejects.toThrow('headed_task_owned');
  await expect(pool.query(`INSERT INTO ${relation}(run_id) VALUES($1)`,[randomUUID()])).rejects.toThrow('headed_execution_parent_missing');
 }
});
it('两个真实session并发接管，同task只有一个owner，败者409',async()=>{
 const {takeOverHeadedTask}=await import('../../lib/headed-task-owner.js');
 const results=await Promise.allSettled([takeOverHeadedTask(pool,request()),takeOverHeadedTask(pool,{...request(),sessionId:'other-session'})]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(results.find(r=>r.status==='rejected').reason.statusCode).toBe(409);
 expect((await pool.query('SELECT task_id FROM headed_task_takeovers WHERE task_id=$1',[task])).rowCount).toBe(1);
});

it('有头接管使用独立未部署509版本记录，不占手机508',async()=>{
 const rows=(await pool.query("SELECT version,description FROM schema_version WHERE description LIKE '有头会话%'")).rows;
 expect(rows).toEqual([{version:'509',description:'有头会话一次性接管legacy bridge及持久执行屏障'}]);
});
