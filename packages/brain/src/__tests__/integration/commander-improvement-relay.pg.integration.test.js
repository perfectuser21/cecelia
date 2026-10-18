import {beforeEach,afterEach,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {privateFixtureDatabase} from '../fixtures/private-fixture-db.js';
import {recordCommanderFailure} from '../../lib/commander-v2-failures.js';
import {buildLastRunResult} from '../../lib/callback-utils.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterTerminalTransition} from '../../lib/task-terminal.js';
import {materializeNextSteps} from '../../lib/relay-baton.js';
let fixture,pool,releaseId,mirror,oldMirror;
const repo='perfectuser21/cecelia';
const revision=execFileSync('git',['rev-parse','origin/main'],{encoding:'utf8'}).trim();
beforeEach(async()=>{
 oldMirror=process.env.HANDOFF_DOCS_DIR;mirror=mkdtempSync(join(tmpdir(),'diagnosis-handoff-'));process.env.HANDOFF_DOCS_DIR=mirror;
 fixture=await privateFixtureDatabase('improvement',async db=>{
  for(const table of ['tasks','task_events','work_routing_receipts','cecelia_events','initiative_runs','map_scope_repositories'])await db.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`);
  await db.query(`CREATE TABLE release_versions(id uuid PRIMARY KEY,payload jsonb NOT NULL);
   CREATE TABLE map_projection_runs(id uuid PRIMARY KEY,scope_key text,status text);
   CREATE TABLE map_projection_nodes(run_id uuid,node_key text,node_type text);`);
  const run=randomUUID();
  await db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('cecelia','cecelia','legacy-ledger-v1',$1)",[JSON.stringify({aliases:[repo]})]);
  await db.query("INSERT INTO map_projection_runs VALUES($1,'cecelia','active')",[run]);
  await db.query("INSERT INTO map_projection_nodes VALUES($1,'F1','capability')",[run]);
  releaseId=randomUUID();
  await db.query('INSERT INTO release_versions VALUES($1,$2)',[releaseId,JSON.stringify({components:[{kind:'repo',repo,revision}],activities:[]})]);
 });pool=fixture.createPool(6);
});
afterEach(async()=>{await fixture?.close();rmSync(mirror,{recursive:true,force:true});if(oldMirror===undefined)delete process.env.HANDOFF_DOCS_DIR;else process.env.HANDOFF_DOCS_DIR=oldMirror;});
async function origin(){return (await pool.query("INSERT INTO tasks(title,task_type,status,payload,result) VALUES($1,'workflow_dispatch','in_progress','{}','{}') RETURNING *",['原业务 '+randomUUID()])).rows[0];}
function control(task,runtime='a'.repeat(64),threshold=1){return {envelope:{run_id:'wfd-'+randomUUID(),workflow_key:'fixture.publish',definition:{release_id:releaseId,snapshot_sha256:'b'.repeat(64),runtime_snapshot_sha256:runtime},recovery:{improvement_after_failures:threshold}},delivery:{effects:[{key:'publish',status:'none'}]},verification:{assertions:[{name:'readback',pass:false}],evidence:['independent:none-published']}};}
async function record(task,c){const db=await pool.connect();try{await db.query('BEGIN');const result=await recordCommanderFailure(db,task,c,'verification_failed');await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
it('真实并发失败与重入只创建一份readonly诊断，不同runtime分离',async()=>{
 const tasks=await Promise.all([origin(),origin()]);const states=tasks.map(t=>control(t));
 const results=await Promise.all(tasks.map((t,i)=>record(t,states[i])));
 expect(results.map(r=>r.improvement)).toEqual([expect.objectContaining({status:'queued',task_id:expect.any(String)}),expect.objectContaining({status:'queued',task_id:expect.any(String)})]);
 expect(results[1].improvement.task_id).toBe(results[0].improvement.task_id);
 await record(tasks[0],states[0]);
 let rows=(await pool.query("SELECT * FROM tasks WHERE task_type='research'")).rows;
 expect(rows).toHaveLength(1);expect(rows[0].payload).toMatchObject({work_kind:'research',commander_improvement:{max_repairs:1,phase:'diagnosis'}});
 const fresh=await origin();await record(fresh,control(fresh,'c'.repeat(64)));
 expect((await pool.query("SELECT count(*)::int n FROM tasks WHERE task_type='research'")).rows[0].n).toBe(2);
});
it('无阈值或未达阈值不派单，SQL派单失败回滚保存点不损坏原事务且失败次数有上限',async()=>{
 const task=await origin();await record(task,control(task,undefined,2));
 const noThreshold=control(task);delete noThreshold.envelope.recovery.improvement_after_failures;await record(task,noThreshold);
 expect((await pool.query("SELECT count(*)::int n FROM tasks WHERE task_type='research'")).rows[0].n).toBe(0);
 await pool.query(`CREATE FUNCTION reject_diagnosis() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.created_by='commander-improvement' THEN RAISE EXCEPTION 'fixture dispatch failure' USING ERRCODE='22012';END IF;RETURN NEW;END$$;
 CREATE TRIGGER reject_diagnosis BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION reject_diagnosis()`);
 for(let i=0;i<4;i++){
  const current=await origin(),db=await pool.connect();
  try{await db.query('BEGIN');const result=await recordCommanderFailure(db,current,control(current),'verification_failed');
   expect(result.improvement.status).toBe(i<3?'dispatch_failed':'dispatch_budget_exhausted');
   await db.query("UPDATE tasks SET result=jsonb_build_object('business_receipt',true) WHERE id=$1",[current.id]);await db.query('COMMIT');
   expect((await pool.query('SELECT result FROM tasks WHERE id=$1',[current.id])).rows[0].result.business_receipt).toBe(true);
  }finally{db.release();}
 }
 expect((await pool.query("SELECT count(*)::int n FROM task_events WHERE event_type='commander_improvement_dispatch_failed'")).rows[0].n).toBe(3);
 expect((await pool.query("SELECT count(*)::int n FROM tasks WHERE task_type='research'")).rows[0].n).toBe(0);
});
it('readonly研究通过完整源码诊断真实接到一份coding_workflow，反复/多步不无限建单',async()=>{
 const task=await origin(),c=control(task),failure=await record(task,c);
 const diagnosis=(await pool.query('SELECT * FROM tasks WHERE id=$1',[failure.improvement.task_id])).rows[0];
 const step={kind:'dispatch_headless',title:'修复固定来源错误',detail:'只修改开发分支，走独立QA和CI',change_kind:'bugfix',repo_hint:repo,map_scope_hint:['F1'],base_sha:revision,
  diagnosis:{category:'source_defect',fixed_source:{repo,revision,path:'packages/brain/src/helper.js'},evidence:['immutable-source:fixture'],reproduction:'固定输入复现错误',acceptance:['原问题修好、关键回归通过'],effects_status:'none'}};
 const chain=diagnosis.payload.commander_improvement;
 const receipt=buildLastRunResult({status:'completed',result:'COMMANDER_DIAGNOSIS '+JSON.stringify({chain_key:chain.chain_key,origin_task_id:chain.origin_task_id,next_steps:[step]})});
 await pool.query("UPDATE tasks SET status='completed',payload=payload||jsonb_build_object('last_run_result',$2::jsonb) WHERE id=$1",[diagnosis.id,JSON.stringify(receipt)]);
 for(let i=0;i<2;i++){const {relay:result}=await afterTerminalTransition(pool,diagnosis.id,'completed');expect(result.skipped).toEqual([]);expect(result.tasks).toHaveLength(1);}
 const rows=(await pool.query("SELECT * FROM tasks WHERE task_type='coding_workflow'")).rows;
 expect(rows).toHaveLength(1);expect(rows[0].payload).toMatchObject({repo:'cecelia',map_scope:['F1'],base_sha:revision,commander_improvement:{phase:'repair',max_repairs:1}});
 const stopped=await materializeNextSteps(pool,rows[0],{next_steps:[step]});expect(stopped.tasks).toEqual([]);expect(stopped.skipped).toHaveLength(1);
});

it('冻结business声明与中央resolved_source双身份真实接到Skills runner，不信诊断自行追加的仓库',async()=>{
 const skills='perfectuser21/zenithjoy-skills',skillRevision='73f87b9bbbe73402b72afab886d303063c9edcf3';
 const run=(await pool.query("SELECT id FROM map_projection_runs WHERE scope_key='cecelia'")).rows[0].id;
 await pool.query("INSERT INTO map_projection_nodes VALUES($1,'skill_distribution','crosscut')",[run]);
 await pool.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('cecelia','zenithjoy-skills','legacy-ledger-v1',$1)",[JSON.stringify({aliases:[skills],path:'/Users/administrator/perfect21/zenithjoy-skills-cw-runner'})]);
 await pool.query('UPDATE release_versions SET payload=$2 WHERE id=$1',[releaseId,JSON.stringify({components:[{kind:'repo',repo:'perfectuser21/zenithjoy-workspace',revision}],activities:[{payload:{implementation_bindings:[{kind:'skill',repo:'perfectuser21/zenithjoy-workspace',revision,path:'.agents/skills/publish/SKILL.md',resolved_source:{repo:skills,revision:skillRevision,path:'business-skills/publish/SKILL.md'}}]}}]})]);
 const task=await origin(),failure=await record(task,control(task));
 const diagnosis=(await pool.query('SELECT * FROM tasks WHERE id=$1',[failure.improvement.task_id])).rows[0];
 expect(diagnosis.payload.commander_improvement.frozen_sources).toContainEqual({repo:skills,revision:skillRevision});
 const step={kind:'dispatch_headless',title:'修复中央Skill候选',change_kind:'bugfix',repo_hint:skills,map_scope_hint:['skill_distribution'],base_sha:skillRevision,
  diagnosis:{category:'source_defect',fixed_source:{repo:skills,revision:skillRevision,path:'business-skills/publish/SKILL.md'},evidence:['fixed-source:sha'],reproduction:'弹窗场景未处理',acceptance:['弹窗与无弹窗均通过'],effects_status:'none'}};
 const chain=diagnosis.payload.commander_improvement;
 await pool.query("UPDATE tasks SET status='completed',payload=payload||jsonb_build_object('last_run_result',$2::jsonb) WHERE id=$1",[diagnosis.id,JSON.stringify(buildLastRunResult({status:'completed',result:'COMMANDER_DIAGNOSIS '+JSON.stringify({chain_key:chain.chain_key,origin_task_id:chain.origin_task_id,next_steps:[step]})}))]);
 const {relay:outcome}=await afterTerminalTransition(pool,diagnosis.id,'completed');expect(outcome.skipped).toEqual([]);expect(outcome.tasks).toHaveLength(1);
 const repair=(await pool.query('SELECT * FROM tasks WHERE id=$1',[outcome.tasks[0].id])).rows[0];
 expect(repair.task_type).toBe('coding_workflow');expect(repair.payload).toMatchObject({repo:'zenithjoy-skills',map_scope:['skill_distribution'],base_sha:skillRevision});
 const forged={...step,repo_hint:'other/repo',diagnosis:{...step.diagnosis,fixed_source:{...step.diagnosis.fixed_source,repo:'other/repo'}}};
 const refused=await materializeNextSteps(pool,{...diagnosis,status:'completed'},{next_steps:[forged]});expect(refused.tasks).toEqual([]);expect(refused.skipped).toHaveLength(1);
});
