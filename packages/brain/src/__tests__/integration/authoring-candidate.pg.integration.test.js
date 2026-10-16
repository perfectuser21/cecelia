import {it,expect,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {authoringExecutionDatabase} from '../fixtures/authoring-execution-db.js';
import {prepareDefinitionFreeze} from '../../workflow-authoring/freeze.js';
import {definitionDigest} from '../../workflow-authoring/contracts.js';
const orchestration=await import('../../workflow-authoring/assembly-orchestration.js').catch(()=>({}));
let f;afterEach(async()=>{await f?.close();f=null;});
async function ownerTask(){
 const id=randomUUID(),d=f.definition,state={request:{operation:'create',actor:'fixture',assembly_mode:true,registration_protocol:'definition-freeze-v1',execution_protocol:'workflow-authoring-execution-v1'},outputs:{compose:{definition:d,definition_sha256:definitionDigest(d)}}};
 await f.pool.query("INSERT INTO tasks(id,title,status,task_type,claimed_by,payload,result) VALUES($1,'候选装配验收','in_progress','research','fixture',$2,$3)",[id,{workflow_authoring:true,tenant_id:'default'},{workflow_authoring:state}]);
 return {id,state,proof:await prepareDefinitionFreeze(d,{readFile:f.reader})};
}
it('无冲突create冻结真实候选planned，重放回读同owner；其它authoring同key和update零写',async()=>{
 expect(typeof orchestration.prepareAuthoringCandidate).toBe('function');
 f=await authoringExecutionDatabase();const a=await ownerTask();
 const run=async task=>{const c=await f.pool.connect();try{await c.query('BEGIN');const v=await orchestration.prepareAuthoringCandidate(c,task.id,task.state,{freezeProof:task.proof,tenantId:'default'});await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const owner=await run(a);expect(owner.authoring_task_id).toBe(a.id);expect(owner.slots).toHaveLength(1);
 expect((await f.pool.query('SELECT status FROM workflows WHERE id=$1',[owner.workflow_id])).rows[0].status).toBe('planned');
 expect((await f.pool.query('SELECT count(*)::int n FROM activity_release_state')).rows[0].n).toBe(0);
 const tables=['workflows','activities','steps','workflow_activity_refs','workflow_definition_versions','activity_definition_versions','workflow_production_recipes'];
 const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await f.pool.query(`SELECT to_jsonb(t) r FROM ${t} t ORDER BY to_jsonb(t)::text`)).rows])));
 const before=await snapshot();expect(await run(a)).toEqual(owner);expect(await snapshot()).toEqual(before);
 const b=await ownerTask();await expect(run(b)).rejects.toMatchObject({code:'candidate_isolation_required'});expect(await snapshot()).toEqual(before);
 a.state.request.operation='update';await expect(run(a)).rejects.toMatchObject({code:'candidate_isolation_required'});expect(await snapshot()).toEqual(before);
});
