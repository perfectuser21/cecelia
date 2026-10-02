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
  expect(f.prepared.every(x=>x.spec.execution.codexHome==='/trusted/codex/team2')).toBe(true);
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
it('已有candidateMachine亲和保持M4，容量拒绝时不能默认换机',async()=>{
 const f=await fixture();try{
  const first=await f.context();first.observed.candidate={machine_id:'xian-mac-m4'};
  expect((await f.dispatch(first)).status).toBe('LAUNCHED');expect(f.starts[0].target.machine).toBe('xian-mac-m4');
  const next=await f.context();next.observed.candidate={machine_id:'xian-mac-m4'};
  expect((await f.dispatch(next)).action).toBe('wait:capacity');expect(f.starts).toHaveLength(1);
 }finally{await f.close();}
});
it.each(['commit-ack-lost','rollback-ack-lost','external-transaction'])('真实PG未知事务不可跨机重选：%s',async mode=>{
 const {createAttemptStore}=await import('../../orchestrator/attempt-store.js');
 const f=await fixture();let outer;try{
  if(mode!=='commit-ack-lost')await f.dispatch(await f.context());
  const calls=[],wrap=client=>({query:async(sql,values)=>{
   const result=await client.query(sql,values);
   if(sql==='COMMIT'&&mode==='commit-ack-lost'||sql==='ROLLBACK'&&mode==='rollback-ack-lost')throw Error('machine_capacity_contended');
   return result;
  },release:()=>client.release()});
  let store;
  if(mode==='external-transaction'){outer=await f.pool.connect();await outer.query('BEGIN');store=createAttemptStore(outer,{transactionClient:true,executionDirectory:true});}
  else store=createAttemptStore({query:(...args)=>f.pool.query(...args),connect:async()=>wrap(await f.pool.connect())},{executionDirectory:true});
  f.deps.attemptStore={...f.store,createAttempt:async input=>{calls.push(input.machineId);return store.createAttempt(input);}};
  const ctx=await f.context(),started=f.starts.length;expect((await f.dispatch(ctx)).action).toBe('wait:capacity');
  expect(calls).toEqual(['xian-mac-m1']);expect(f.starts).toHaveLength(started);
  if(outer){await outer.query('ROLLBACK');outer.release();outer=null;}
  const rows=(await f.pool.query('SELECT machine_id FROM harness_attempts WHERE run_id=$1',[ctx.runId])).rows;
  expect(rows).toEqual(mode==='commit-ack-lost'?[{machine_id:'xian-mac-m1'}]:[]);
 }finally{if(outer){await outer.query('ROLLBACK');outer.release();}await f.close();}
});
it('预检选择不属于剩余候选或快照绑定漂移时，零预约零启动',async()=>{
 const f=await fixture();try{
  const original=f.deps.preflightGate;
  f.deps.preflightGate={...original,evaluate:async args=>{const result=await original.evaluate(args);result.snapshot.machine='us-mac-m4';return result;}};
  await expect(f.dispatch(await f.context())).rejects.toThrow('preflight_target_identity_mismatch');
  expect(f.calls).toHaveLength(0);expect(f.starts).toHaveLength(0);
 }finally{await f.close();}
});
it('预检即确认全部机器资源满时wait:capacity且不消耗账号重试',async()=>{
 const {createCapabilityGate}=await import('../../orchestrator/preflight/capability-gate.js');
 const f=await fixture();let authProbes=0;try{
  f.deps.preflightGate=createCapabilityGate({getMachineHealth:async()=>({ok:true}),getMachineCapacity:async()=>({ok:true,available:0}),probeProviderAuth:async()=>{authProbes++;return {ok:true};}});
  const result=await f.dispatch(await f.context());
  expect(result).toMatchObject({action:'wait:capacity',fallback_reason:'machine_capacity_unavailable',should_create_attempt:false});
  expect(f.calls).toHaveLength(0);expect(f.starts).toHaveLength(0);expect(authProbes).toBe(0);
 }finally{await f.close();}
});
it('routing strict_affinity不能被角色fallback覆盖，预检资源满时零跨机启动',async()=>{
 const {createCapabilityGate}=await import('../../orchestrator/preflight/capability-gate.js');
 const f=await fixture();try{
  f.deps.preflightGate=createCapabilityGate({getMachineHealth:async()=>({ok:true}),getMachineCapacity:async({machine})=>({ok:true,available:machine==='xian-mac-m1'?0:1,physical_base_slots:1,effective_base_slots:1}),probeProviderAuth:async()=>({ok:true}),probeGitHub:async()=>({ok:true}),probeModelCapability:async()=>({ok:true})});
  const ctx=await f.context({routing:{preferred_machine:'xian-mac-m1',strict_affinity:true},role_assignments:{planner:{provider:'codex',account:'team1',fallback_targets:[{provider:'codex',account:'team1',machine:'us-mac-m4'}]}}});
  expect((await f.dispatch(ctx)).action).toBe('wait:capacity');expect(f.calls).toHaveLength(0);expect(f.starts).toHaveLength(0);
 }finally{await f.close();}
});
