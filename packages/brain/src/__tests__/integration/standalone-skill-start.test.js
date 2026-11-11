import {randomUUID} from 'node:crypto';
import {beforeEach,afterEach,it,expect} from 'vitest';
import express from 'express';
import request from 'supertest';
import {releaseEvidenceDatabase} from '../fixtures/release-evidence-db.js';
import {createRelease,recordReleaseObservation} from '../../lib/release-index.js';
import {createRunDefinitionsRouter} from '../../routes/run-definitions.js';
let f,app,body,task;
beforeEach(async()=>{
 f=await releaseEvidenceDatabase();
 await f.db.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb, ADD COLUMN IF NOT EXISTS claimed_by text, ADD COLUMN IF NOT EXISTS claimed_at timestamptz");
 const release=(await createRelease(f.db,f.releaseInput)).release,observation=(await recordReleaseObservation(f.db,release.id,f.observationInput,{trustedCollector:'fixture-collector'})).observation;
 const definition=f.runInput(release,observation);delete definition.source_kind;delete definition.external_origin;
 const workflow=release.payload.workflows.find(w=>w.id===definition.workflow_definition_version_id);task=randomUUID();
 const skill={name:'douyin-leadgen-direct',version:'0.1.0',source_commit:'a'.repeat(40),path:'skill/SKILL.md',sha256:'b'.repeat(64)};
 await f.db.query("INSERT INTO tasks(id,title,status,payload,claimed_by,claimed_at) VALUES($1,'独立Skill起跑','in_progress',$2,'codex-direct','2026-11-11T08:00:00.000Z')",[task,{execution_mode:'standalone-skill',scope:{workflow_key:workflow.payload.key,source_commit:workflow.source_commit},skill}]);
 body={task_id:task,claimer:'codex-direct',claimed_at:'2026-11-11T08:00:00.000Z',definition:{...definition,actor:'codex-direct'}};
 app=express();app.use(express.json());app.use('/runs',createRunDefinitionsRouter({pool:f.db}));
});
afterEach(async()=>{await f?.close();f=null;});
const post=(id,b=body)=>request(app).post('/runs/'+id+'/start-skill').send(b);
async function counts(){return {runs:(await f.db.query('SELECT count(*)::int n FROM task_runs')).rows[0].n,bindings:(await f.db.query('SELECT count(*)::int n FROM run_definition_bindings')).rows[0].n};}
it('真实HTTP原子创建内部运行与固定版本，重复请求只回读原始身份',async()=>{
 const first=await post('standalone-real');expect(first.status,first.text).toBe(201);
 expect(first.body).toMatchObject({run_id:'standalone-real',binding:{run_id:'standalone-real',source_kind:'internal'}});expect(first.body.task_run_id).toBe(first.body.binding.task_run_id);
 const run=(await f.db.query("SELECT * FROM task_runs WHERE run_id='standalone-real'")).rows[0];expect(run.task_id).toBe(task);expect(run.status).toBe('running');expect(run.context.source).toBe('standalone-skill');
 const second=await post('standalone-real');expect(second.status).toBe(200);expect(second.body.task_run_id).toBe(first.body.task_run_id);expect(second.body.binding.id).toBe(first.body.binding.id);expect(await counts()).toEqual({runs:1,bindings:1});
});
it('错误owner、claim时间、执行模式、Skill摘要和Workflow范围均零写入',async()=>{
 for(const patch of [{claimer:'common-runner'},{claimer:'other'},{claimed_at:'2026-11-11T08:01:00.000Z'},{definition:{...body.definition,actor:'other'}}]){const r=await post('wrong-'+randomUUID(),{...body,...patch});expect(r.status).toBe(409);expect(await counts()).toEqual({runs:0,bindings:0});}
 for(const mutate of [p=>p.execution_mode='old-runner',p=>p.skill.sha256='bad',p=>p.scope.workflow_key='unrelated']){const p=(await f.db.query('SELECT payload FROM tasks WHERE id=$1',[task])).rows[0].payload,saved=structuredClone(p);mutate(p);await f.db.query('UPDATE tasks SET payload=$2 WHERE id=$1',[task,p]);const r=await post('scope-'+randomUUID());expect(r.status).toBe(409);expect(await counts()).toEqual({runs:0,bindings:0});await f.db.query('UPDATE tasks SET payload=$2 WHERE id=$1',[task,saved]);}
});
it('固定定义错误整笔回滚，不留下running假账',async()=>{
 const r=await post('bad-definition',{...body,definition:{...body.definition,snapshot_sha256:'0'.repeat(64)}});expect(r.status).toBe(422);expect(await counts()).toEqual({runs:0,bindings:0});
});
it('同Task并发不同run只准一轮，同run不同定义不能改写',async()=>{
 const responses=await Promise.all([post('parallel-one'),post('parallel-two')]);expect(responses.map(r=>r.status).sort()).toEqual([201,409]);expect(await counts()).toEqual({runs:1,bindings:1});
 const first=responses.find(r=>r.status===201);const other=await post(first.body.run_id,{...body,definition:{...body.definition,runtime_snapshot_sha256:'0'.repeat(64)}});expect(other.status).toBe(409);expect(await counts()).toEqual({runs:1,bindings:1});
});
it('拒绝额外字段和已完成Task，历史运行不能事后补挂定义',async()=>{
 expect((await post('extra',{...body,state:'completed'})).status).toBe(422);expect(await counts()).toEqual({runs:0,bindings:0});
 await f.db.query("UPDATE tasks SET status='completed' WHERE id=$1",[task]);expect((await post('terminal')).status).toBe(409);expect(await counts()).toEqual({runs:0,bindings:0});
 await f.db.query("UPDATE tasks SET status='in_progress' WHERE id=$1",[task]);await f.db.query("INSERT INTO task_runs(task_id,run_id,status,workflow_id) VALUES($1,'historical','running',$2)",[task,body.definition.workflow_id]);
 expect((await post('historical')).status).toBe(409);expect(await counts()).toEqual({runs:1,bindings:0});
});
it('同run不能借新claim或变更后的Skill/数量范围重新起跑',async()=>{
 expect((await post('fixed-scope')).status).toBe(201);
 const saved=(await f.db.query('SELECT payload,claimed_at FROM tasks WHERE id=$1',[task])).rows[0];
 for(const mutate of [p=>p.scope.limit=2,p=>p.skill.sha256='c'.repeat(64)]){const payload=structuredClone(saved.payload);mutate(payload);await f.db.query('UPDATE tasks SET payload=$2 WHERE id=$1',[task,payload]);expect((await post('fixed-scope')).status).toBe(409);}
 await f.db.query("UPDATE tasks SET payload=$2,claimed_at='2026-11-11T09:00:00.000Z' WHERE id=$1",[task,saved.payload]);expect((await post('fixed-scope',{...body,claimed_at:'2026-11-11T09:00:00.000Z'})).status).toBe(409);expect(await counts()).toEqual({runs:1,bindings:1});
});
it('独立起跑必须声明工具快照hash，空claim时间不能冒作1970时间',async()=>{
 const definition={...body.definition};delete definition.runtime_snapshot_sha256;expect((await post('missing-runtime',{...body,definition})).status).toBe(422);expect(await counts()).toEqual({runs:0,bindings:0});
 await f.db.query('UPDATE tasks SET claimed_at=NULL WHERE id=$1',[task]);expect((await post('missing-claim',{...body,claimed_at:'1970-01-01T00:00:00.000Z'})).status).toBe(409);expect(await counts()).toEqual({runs:0,bindings:0});
});
it('同一run不能由另一个真实Task冒领，原关联保持',async()=>{
 expect((await post('owned-task')).status).toBe(201);const other=randomUUID();
 await f.db.query("INSERT INTO tasks(id,title,status,payload,claimed_by,claimed_at) SELECT $2,'另一个任务',status,payload,claimed_by,claimed_at FROM tasks WHERE id=$1",[task,other]);
 const result=await post('owned-task',{...body,task_id:other});expect(result.status).toBe(409);
 expect((await f.db.query("SELECT task_id FROM task_runs WHERE run_id='owned-task'")).rows[0].task_id).toBe(task);expect(await counts()).toEqual({runs:1,bindings:1});
});
it.each([['name',123],['source_commit',['a'.repeat(40)]],['sha256',['b'.repeat(64)]]])('Skill字段%s不能通过正则隐式转换伪装字符串',async(field,value)=>{
 const payload=(await f.db.query('SELECT payload FROM tasks WHERE id=$1',[task])).rows[0].payload;payload.skill[field]=value;await f.db.query('UPDATE tasks SET payload=$2 WHERE id=$1',[task,payload]);
 const result=await post('non-string-'+field);expect(result.status).toBe(409);expect(await counts()).toEqual({runs:0,bindings:0});
});
