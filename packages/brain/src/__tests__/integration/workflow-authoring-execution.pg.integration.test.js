import {it,expect,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {authoringExecutionDatabase} from '../fixtures/authoring-execution-db.js';
import {createWorkflowAuthoringRouter} from '../../routes/workflow-authoring.js';
let f;afterEach(async()=>{await f?.close();f=null;});
export async function startPureAuthoring(f,invocationOptions={}){
 const id=randomUUID();
 await f.pool.query("INSERT INTO tasks(id,title,status,task_type,claimed_by,payload) VALUES($1,$2,'in_progress','research','fixture',$3)",[id,`自动装配${id}`,{workflow_authoring:true,tenant_id:'default'}]);
 const app=express();app.use(express.json());app.use('/api/brain/workflow-authoring',createWorkflowAuthoringRouter({db:f.pool,freezeOptions:{readFile:f.reader},invocationOptions:{readFile:f.reader,probeRuntime:async()=>({ready:true}),...invocationOptions}}));
 const post=(path,body)=>request(app).post(`/api/brain/workflow-authoring/runs/${id}${path}`).send(body);
 let initialized=await post('/init',{operation:'create',goal:'无副作用纯Skill自动装配',actor:'fixture',assembly_mode:true,registration_protocol:'definition-freeze-v1',execution_protocol:'workflow-authoring-execution-v1',validation_input:{text:'abc'}});
 expect(initialized.status).toBe(200);
 const submit=async(stage,output,revision)=>{const r=await post('/submit',{stage,output,revision,submission_id:`${stage}-one`});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;};
 await submit('intake',{goal:'纯Skill产物验真',inputs:['text'],outputs:['text'],acceptance:['ABC'],capability_id:f.definition.capability_id},0);
 await submit('reuse',{search_terms:['pure'],candidates:[{kind:'skill',id:f.skill,decision:'reuse',reason:'已有固定纯Skill'}]},1);
 const compose=await submit('compose',{definition:f.definition},2);
 return {id,app,post,compose};
}
it('实际HTTP compose入口自动冻结候选并幂等排队，无需人工提交build或抄验证任务ID',async()=>{
 f=await authoringExecutionDatabase();const run=await startPureAuthoring(f);
 expect(run.compose.automatic?.status).toBe('awaiting_execution');
 const owner=(await f.pool.query('SELECT result FROM tasks WHERE id=$1',[run.id])).rows[0].result.workflow_authoring_candidate;
 expect(owner.authoring_task_id).toBe(run.id);
 expect((await f.pool.query("SELECT count(*)::int n FROM tasks WHERE payload?'invocation'")).rows[0].n).toBe(1);
 const resumed=await run.post('/advance',{});expect(resumed.status).toBe(200);
 expect(resumed.body.status).toBe('awaiting_execution');
 expect((await f.pool.query("SELECT count(*)::int n FROM tasks WHERE payload?'invocation'")).rows[0].n).toBe(1);
 expect((await f.pool.query('SELECT status FROM workflows WHERE id=$1',[owner.workflow_id])).rows[0].status).toBe('paused');
});
