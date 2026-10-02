import {it,expect} from 'vitest';
import {fixture} from './helpers/kernel-capacity-fixture.js';
it('默认Codex并发竞争M1/M4后MMV兜底，每run只有一条预约且只启动一次',async()=>{
 const f=await fixture();try{
  const contexts=await Promise.all([1,2,3].map(()=>f.context({executor_account:'team2'})));
  const results=await Promise.all(contexts.map(ctx=>f.dispatch(ctx)));
  expect(results.map(r=>r.status)).toEqual(['LAUNCHED','LAUNCHED','LAUNCHED']);
  expect(f.starts.map(x=>x.target.machine).sort()).toEqual(['us-mac-m4','xian-mac-m1','xian-mac-m4']);
  const rows=(await f.pool.query('SELECT run_id,machine_id,task_bundle,account_id FROM harness_attempts')).rows;
  expect(rows).toHaveLength(3);expect(new Set(rows.map(r=>r.run_id)).size).toBe(3);
  const fallback=rows.find(r=>r.machine_id==='us-mac-m4');expect(fallback.task_bundle.inputs.capability_evidence.capacity_reselection.skipped_machines).toEqual(['xian-mac-m1','xian-mac-m4']);
  for(const row of rows){expect(row.account_id).toBe('team2');expect(row.task_bundle.inputs.capability_evidence.to_target.machine).toBe(row.machine_id);}
  expect(f.prepared.every(x=>x.spec.execution.accountHome==='/trusted/codex/team2')).toBe(true);
  expect(f.calls.every(x=>x.capacitySnapshot.machine===x.machineId&&x.capacitySnapshot.account===x.accountId)).toBe(true);
  const previous=f.starts.length;await f.dispatch(contexts.find(c=>c.runId===fallback.run_id));expect(f.starts).toHaveLength(previous);
 }finally{await f.close();}
},20000);
it('容量重选耗尽只wait:capacity，不留下该run占位、不产生模型失败',async()=>{
 const f=await fixture();try{
  for(let i=0;i<3;i++)expect((await f.dispatch(await f.context())).status).toBe('LAUNCHED');
  const ctx=await f.context(),result=await f.dispatch(ctx);
  expect(result).toMatchObject({action:'wait:capacity',should_create_attempt:false});
  expect((await f.pool.query('SELECT id FROM harness_attempts WHERE run_id=$1',[ctx.runId])).rows).toHaveLength(0);expect(f.starts).toHaveLength(3);
 }finally{await f.close();}
},20000);
it.each([{machine:'us-mac-m4'},{machine_id:'us-mac-m4'},{routing:{preferred_machine:'us-mac-m4',strict_affinity:true}},{role_assignments:{planner:{machine:'us-mac-m4',strict_affinity:true}}}])('显式pin保持原机器，不应用默认M1优先 %#',async payload=>{
 const f=await fixture();try{expect((await f.dispatch(await f.context(payload))).status).toBe('LAUNCHED');expect(f.starts.map(x=>x.target.machine)).toEqual(['us-mac-m4']);}finally{await f.close();}
});
it('预检后真实grant撤销，最终事务拒绝且零启动零预约',async()=>{
 const f=await fixture();try{
  f.deps.attemptStore.createAttempt=async input=>{await f.pool.query("UPDATE execution_grants SET state='revoked' WHERE surface='harness' AND provider='codex'");return f.store.createAttempt(input);};
  await expect(f.dispatch(await f.context())).rejects.toThrow('execution_grant_denied');
  expect(f.starts).toHaveLength(0);expect((await f.pool.query('SELECT id FROM harness_attempts')).rows).toHaveLength(0);
 }finally{await f.close();}
});
