import {it,expect,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {authoringExecutionDatabase} from '../fixtures/authoring-execution-db.test.js';
import {prepareDefinitionFreeze} from '../../workflow-authoring/freeze.js';
import {definitionDigest} from '../../workflow-authoring/contracts.js';
import {resolveInvocation} from '../../invocations/resolve.js';
import {invoke} from '../../invocations/store.js';
import {prepareInvocationDispatch,guardInvocationCallback} from '../../invocations/runtime.js';
import {finishRun} from '../../lib/task-run.js';
import {finalizeTask} from '../../lib/task-terminal.js';
import {readInvocationLedger} from '../../workflow-authoring/execution-proof.js';
import {verifyInvocationLedger} from '../../workflow-authoring/execution-ledger.js';
const orchestration=await import('../../workflow-authoring/assembly-orchestration.js').catch(()=>({}));
let f;afterEach(async()=>{await f?.close();f=null;});
async function ownerTask(){
 const id=randomUUID(),d=f.definition,state={request:{operation:'create',actor:'fixture',assembly_mode:true,registration_protocol:'definition-freeze-v1',execution_protocol:'workflow-authoring-execution-v1'},outputs:{compose:{definition:d,definition_sha256:definitionDigest(d)}}};
 await f.pool.query("INSERT INTO tasks(id,title,status,task_type,claimed_by,payload,result) VALUES($1,$2,'in_progress','research','fixture',$3,$4)",[id,`候选装配验收${id}`,{workflow_authoring:true,tenant_id:'default'},{workflow_authoring:state}]);
 return {id,state,proof:await prepareDefinitionFreeze(d,{readFile:f.reader})};
}
it('无冲突create冻结真实候选paused，重放回读同owner；其它authoring同key和update零写',async()=>{
 expect(typeof orchestration.prepareAuthoringCandidate).toBe('function');
 f=await authoringExecutionDatabase();const a=await ownerTask();
 const run=async task=>{const c=await f.pool.connect();try{await c.query('BEGIN');const v=await orchestration.prepareAuthoringCandidate(c,task.id,task.state,{freezeProof:task.proof,tenantId:'default'});await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const owner=await run(a);expect(owner.authoring_task_id).toBe(a.id);expect(owner.slots).toHaveLength(1);
 const resolved=await resolveInvocation(f.pool,{target:{kind:'workflow',id:a.id},mode:'candidate',authoring_task_id:a.id,
  compose_sha256:definitionDigest(f.definition),input:{text:'abc'}},'default',{readFile:f.reader,probeRuntime:async()=>({ready:true})});
 expect(resolved.envelope.candidate_trace).toEqual(owner);
 expect((await f.pool.query('SELECT status FROM workflows WHERE id=$1',[owner.workflow_id])).rows[0].status).toBe('paused');
 expect((await f.pool.query('SELECT count(*)::int n FROM activity_release_state')).rows[0].n).toBe(0);
 const tables=['workflows','activities','steps','workflow_activity_refs','workflow_definition_versions','activity_definition_versions','workflow_production_recipes'];
 const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await f.pool.query(`SELECT to_jsonb(t) r FROM ${t} t ORDER BY to_jsonb(t)::text`)).rows])));
 const before=await snapshot();expect(await run(a)).toEqual(owner);expect(await snapshot()).toEqual(before);
 const b=await ownerTask();await expect(run(b)).rejects.toMatchObject({code:'candidate_isolation_required'});expect(await snapshot()).toEqual(before);
 a.state.request.operation='update';await expect(run(a)).rejects.toMatchObject({code:'candidate_isolation_required'});expect(await snapshot()).toEqual(before);
});
it('实际回执通道按已观察Activity产物写真实FK span，重放不重复，不能合成Step成功',async()=>{
 f=await authoringExecutionDatabase();const a=await ownerTask(),c=await f.pool.connect();let owner;
 try{await c.query('BEGIN');owner=await orchestration.prepareAuthoringCandidate(c,a.id,a.state,{freezeProof:a.proof});await c.query('COMMIT');}finally{c.release();}
 const options={readFile:f.reader,probeRuntime:async()=>({ready:true})};
 const accepted=await invoke(f.pool,{target:{kind:'workflow',id:a.id},mode:'candidate',authoring_task_id:a.id,compose_sha256:definitionDigest(f.definition),input:{text:'abc'},request_key:'span-receipt'},'default',options);
 const task=(await f.pool.query('SELECT * FROM tasks WHERE id=$1',[accepted.task_id])).rows[0],runId=`observed-${randomUUID()}`;
 const {envelope:e}=await prepareInvocationDispatch(f.pool,task,runId,options);
 const receipt={protocol:'skill-invocation-result-v1',task_id:task.id,run_id:runId,tenant_id:'default',target:e.target,input_sha256:e.input_sha256,
  activities:e.activities.map(slot=>({key:slot.key,skill_sha256:slot.skill_sha256,outputs:{text:'ABC'}})),outputs:{text:'ABC'}};
 const callback={task_id:task.id,run_id:runId,status:'AI Done',result:receipt};
 await guardInvocationCallback(f.pool,callback);await guardInvocationCallback(f.pool,callback);
 const spans=(await f.pool.query('SELECT * FROM spans WHERE run_id=$1',[runId])).rows;
 expect(spans).toHaveLength(1);expect(spans[0]).toMatchObject({workflow_id:owner.workflow_id,activity_id:owner.slots[0].activity_id,step_id:null,outcome:'pass'});
 expect(spans[0].evidence.outputs).toEqual({text:'ABC'});
 await finishRun({runId,status:'success',exitCode:0,result:{source:'callback-ledger-regression'}},{pool:f.pool});
 await finalizeTask(f.pool,task.id,'completed',{mergeResult:{handoff:{summary:'回执真实账本回归',next_steps:[]}}});
 expect(verifyInvocationLedger(await readInvocationLedger(f.pool,task.id),{requireSpans:true}).outputs).toEqual({text:'ABC'});
});
it('owner协议/租户/服务器compose、冻结引用或非授权active篡改不能重放认领',async()=>{
 f=await authoringExecutionDatabase();const a=await ownerTask();
 const c=await f.pool.connect();let owner;
 try{await c.query('BEGIN');owner=await orchestration.prepareAuthoringCandidate(c,a.id,a.state,{freezeProof:a.proof});await c.query('COMMIT');}
 finally{c.release();}
 const saved=(await f.pool.query('SELECT result FROM tasks WHERE id=$1',[a.id])).rows[0].result;
 for(const mutate of [r=>{r.workflow_authoring_candidate.protocol='legacy';},r=>{r.workflow_authoring_candidate.tenant_id='other';},
  r=>{r.workflow_authoring.outputs.compose.definition.name='另一版';}]){
  const changed=structuredClone(saved);mutate(changed);await f.pool.query('UPDATE tasks SET result=$2 WHERE id=$1',[a.id,changed]);
  await expect(orchestration.readCandidateOwner(f.pool,a.id,f.definition,'default')).rejects.toThrow();
  await f.pool.query('UPDATE tasks SET result=$2 WHERE id=$1',[a.id,saved]);
 }
 await f.pool.query("UPDATE workflows SET status='active' WHERE id=$1",[owner.workflow_id]);
 await expect(orchestration.readCandidateOwner(f.pool,a.id,f.definition,'default')).rejects.toThrow();
 await f.pool.query("UPDATE workflows SET status='paused' WHERE id=$1",[owner.workflow_id]);
 const version=(await f.pool.query('SELECT payload FROM workflow_definition_versions WHERE id=$1',[owner.workflow_definition_version_id])).rows[0].payload;
 version.activities[0].activity_id=randomUUID();
 await f.pool.query('UPDATE workflow_definition_versions SET payload=$2 WHERE id=$1',[owner.workflow_definition_version_id,version]);
 await expect(orchestration.readCandidateOwner(f.pool,a.id,f.definition,'default')).rejects.toThrow();
});
it('同key并发最多一个owner；失败事务回滚不留下实体或active窗口，正式对象零改动',async()=>{
 f=await authoringExecutionDatabase();const a=await ownerTask(),b=await ownerTask();
 const run=async(task,abort=false)=>{const c=await f.pool.connect();try{
  await c.query('BEGIN');const owner=await orchestration.prepareAuthoringCandidate(c,task.id,task.state,{freezeProof:task.proof});
  if(abort){expect((await f.pool.query('SELECT count(*)::int n FROM workflows')).rows[0].n).toBe(0);throw Error('forced_rollback');}
  await c.query('COMMIT');return owner;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}};
 await expect(run(a,true)).rejects.toThrow('forced_rollback');
 for(const table of ['workflows','activities','workflow_activity_refs','workflow_definition_versions','activity_definition_versions'])
  expect((await f.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n).toBe(0);
 const concurrent=await Promise.allSettled([run(a),run(b)]);expect(concurrent.filter(v=>v.status==='fulfilled')).toHaveLength(1);
 const owner=concurrent.find(v=>v.status==='fulfilled').value;
 await f.pool.query("UPDATE workflows SET status='active' WHERE id=$1",[owner.workflow_id]);
 const tables=['workflows','activities','steps','workflow_activity_refs','workflow_definition_versions','activity_definition_versions','workflow_production_recipes','activity_release_state'];
 const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await f.pool.query(`SELECT to_jsonb(t) r FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows])));
 const before=await snapshot(),other=await ownerTask();await expect(run(other)).rejects.toMatchObject({code:'candidate_isolation_required'});
 expect(await snapshot()).toEqual(before);
});
it('候选一旦被其它路径写入正式发布指针，严格owner不再授测试资格',async()=>{
 f=await authoringExecutionDatabase();const a=await ownerTask(),c=await f.pool.connect();let owner;
 try{await c.query('BEGIN');owner=await orchestration.prepareAuthoringCandidate(c,a.id,a.state,{freezeProof:a.proof});await c.query('COMMIT');}finally{c.release();}
 const slot=owner.slots[0],version=(await f.pool.query('SELECT activity_version_id FROM activity_version_builds WHERE build_id=$1',[slot.activity_definition_version_id])).rows[0];
 await f.pool.query('INSERT INTO activity_release_state(activity_id,production_version_id) VALUES($1,$2)',[slot.activity_id,version.activity_version_id]);
 await expect(orchestration.readCandidateOwner(f.pool,a.id,f.definition,'default')).rejects.toMatchObject({code:'candidate_formal_release_conflict'});
});
