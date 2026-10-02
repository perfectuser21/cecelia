import {directory} from '../../execution-directory/directory.js';
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
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
  expect(f.calls.every(x=>x.capacitySnapshot.machine===x.machineId&&x.capacitySnapshot.account===x.accountId&&x.bundle.inputs.capability_snapshot_id===x.capacitySnapshot.capability_snapshot_id)).toBe(true);
  expect(new Set(f.calls.map(x=>x.capacitySnapshot.capability_snapshot_id)).size).toBe(f.calls.length);
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

it.each(['running','cleanup_pending','blocked'])('两个聊天HOME整机占位%s时Kernel只可回MMV，终态task不释放聊天预约',async status=>{
 const f=await fixture();try{
  for(const machine of ['xian-mac-m1','xian-mac-m4']){
   const taskId=randomUUID(),id=randomUUID();
   await f.pool.query("INSERT INTO tasks(id,status,task_type,executor_kind) VALUES($1,'completed','app_server_run','app-server-controller')",[taskId]);
   const grant=(await f.pool.query("INSERT INTO execution_grants(node_version_id,surface,provider,account_id,repo_scope,profile_id,provenance,state) SELECT current_version_id,'app_server','codex','team1',ARRAY['perfectuser21/cecelia'],'chat','test_explicit_policy','active' FROM execution_nodes WHERE canonical_id=$1 RETURNING id,node_version_id",[machine])).rows[0];
   // 真实预约表中的两份独立聊天占位；本测试不生成聊天许可，也不执行聊天进程。
   await f.pool.query(`INSERT INTO capacity_reservations(id,machine_id,owner_kind,owner_key,task_id,config_digest,allocation_mode,policy_version,snapshot_time,snapshot_digest,status,worker_id,worker_boot_id,container_id,execution_version_id,execution_grant_id)
    VALUES($1::uuid,$2,'app_server',($1::uuid)::text,$3,$4,'exclusive_unclassified','app-server-exclusive-v1',now(),$4,$5,$2,$6,$4,$7,$8)`,[id,machine,taskId,'b'.repeat(64),status,randomUUID(),grant.node_version_id,grant.id]);
  }
  await (await import('../../execution-directory/directory.js')).directory.refresh({pool:f.pool});
  const ctx=await f.context(),result=await f.dispatch(ctx);expect(result.status).toBe('LAUNCHED');
  expect(f.starts.map(x=>x.target.machine)).toEqual(['us-mac-m4']);
  expect((await f.pool.query('SELECT machine_id FROM harness_attempts WHERE run_id=$1',[ctx.runId])).rows).toEqual([{machine_id:'us-mac-m4'}]);
  const chat=(await f.pool.query("SELECT machine_id,status,allocation_mode FROM capacity_reservations WHERE owner_kind='app_server' ORDER BY machine_id")).rows;
  expect(chat).toEqual(['xian-mac-m1','xian-mac-m4'].map(machine_id=>({machine_id,status,allocation_mode:'exclusive_unclassified'})));
 }finally{await f.close();}
});

it('持续回归同run/hop八路并发只有一个启动及一行预约',async()=>{
 const f=await fixture();try{
 const ctx=await f.context({executor_account:'team2'});
 const results=await Promise.all(Array.from({length:8},()=>f.dispatch(ctx)));
 expect(results.filter(r=>r.status==='LAUNCHED')).toHaveLength(1);
 expect(f.starts).toHaveLength(1);expect(f.prepared).toHaveLength(1);
 expect((await f.pool.query('SELECT id FROM harness_attempts WHERE run_id=$1',[ctx.runId])).rows).toHaveLength(1);
 }finally{await f.close();}
},20000);
it('持续回归容量回滚后第二候选fresh拒绝，零新预约零启动',async()=>{
 const f=await fixture();try{
 await f.dispatch(await f.context());const gate=f.deps.preflightGate;const seen=[];
 f.deps.preflightGate={...gate,validateSnapshotForDispatch:async(s,b)=>{seen.push(s.machine);return s.machine==='xian-mac-m4'?{status:'blocked',action:'wait:human_review',fallback_reason:'review_stale_snapshot'}:gate.validateSnapshotForDispatch(s,b);}};
 const ctx=await f.context(),result=await f.dispatch(ctx);
 expect(result.fallback_reason).toBe('review_stale_snapshot');expect(seen).toEqual(['xian-mac-m1','xian-mac-m4']);
 expect(f.starts).toHaveLength(1);expect((await f.pool.query('SELECT id FROM harness_attempts WHERE run_id=$1',[ctx.runId])).rows).toHaveLength(0);
 }finally{await f.close();}
});
it('持续回归换机账号变化时accountHome与预约快照同步变化',async()=>{
 const f=await fixture();try{
 await f.dispatch(await f.context());const initial=f.starts[0].target.account;
 await f.pool.query("UPDATE execution_grants SET state='revoked' WHERE node_version_id=(SELECT current_version_id FROM execution_nodes WHERE canonical_id='xian-mac-m4') AND surface='harness' AND account_id=$1",[initial]);
 await directory.refresh({pool:f.pool});
 const homes=[];f.deps.resolveAccountHome=(provider,account)=>{homes.push(account);return `/trusted/${provider}/${account}`;};
 expect((await f.dispatch(await f.context())).status).toBe('LAUNCHED');
 const second=f.starts.at(-1),last=f.calls.at(-1);
 expect(second.target.machine).toBe('xian-mac-m4');expect(second.target.account).not.toBe(initial);
 expect(homes).toEqual([initial,second.target.account]);
 expect(f.prepared.at(-1).spec.execution.codexHome).toBe(`/trusted/codex/${second.target.account}`);
 expect(last.accountId).toBe(second.target.account);expect(last.capacitySnapshot.account).toBe(second.target.account);
 }finally{await f.close();}
});
