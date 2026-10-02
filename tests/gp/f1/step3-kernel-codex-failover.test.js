import {it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {directory} from '../../../packages/brain/src/execution-directory/directory.js';
import {legacyRecords,LEGACY_BINDINGS} from '../../../packages/brain/src/execution-directory/legacy-policy.js';
import {defaultCodexTargets} from '../../../packages/brain/src/orchestrator/preflight/execution-targets.js';
import {createCapabilityGate} from '../../../packages/brain/src/orchestrator/preflight/capability-gate.js';
import {createAttemptStore,isConfirmedCapacityRollback} from '../../../packages/brain/src/orchestrator/attempt-store.js';
beforeAll(async()=>{
 const env=Object.fromEntries(LEGACY_BINDINGS.map(([machine])=>[`FLEET_WORKER_${machine.toUpperCase().replaceAll('-','_')}_URL`,'http://127.0.0.1:5231']));
 await directory.refresh({pool:{query:async()=>({rows:legacyRecords({env})})}});
});
it('F1 Codex默认顺序经真实preflight避开M1/M4容量满，最终账号和快照均绑定MMV',async()=>{
 const candidates=defaultCodexTargets({role:'planner',provider:'codex',account:'team2',repo:'perfectuser21/cecelia'}),probed=[],auth=[];
 expect(candidates.map(t=>t.machine)).toEqual(['xian-mac-m1','xian-mac-m4','us-mac-m4']);
 const gate=createCapabilityGate({getMachineHealth:async()=>({ok:true}),getMachineCapacity:async({machine})=>{probed.push(machine);return {ok:true,available:machine==='us-mac-m4'?1:0};},probeProviderAuth:async target=>{auth.push(target);return {ok:true};}});
 const result=await gate.evaluate({preferred_target:candidates[0],candidate_targets:candidates,requirements:{provider_auth:true},task_bundle:{logical_cycle:'gp-capacity'}});
 expect(probed).toEqual(['xian-mac-m1','xian-mac-m4','us-mac-m4']);expect(auth).toHaveLength(1);
 expect(result.to_target).toEqual({provider:'codex',account:'team2',machine:'us-mac-m4'});
 expect(result.evidence.capacity_blocked_machines).toEqual(['xian-mac-m1','xian-mac-m4']);
 expect(result.snapshot).toMatchObject({...result.to_target,verified:true});
 expect(await gate.validateSnapshotForDispatch(result.snapshot,{})).toMatchObject({status:'ok'});
});
it('F1 预约失败只接受store持有的回滚证明，字符串或跨身份复制均不能换机',async()=>{
 const commands=[],input={id:randomUUID(),runId:randomUUID(),hop:1,machineId:'xian-mac-m1',role:'planner',provider:'codex',bundle:{inputs:{}}};
 const query=async sql=>{commands.push(sql);return {rows:sql.includes('WITH occupied')?[{attempt:null,machine_capacity_contended:true}]:[]};};
 const store=createAttemptStore({query,connect:async()=>({query,release(){}})});
 let refused;try{await store.createAttempt(input);}catch(error){refused=error;}
 expect(refused?.message).toBe('machine_capacity_contended');expect(commands.at(-1)).toBe('ROLLBACK');
 expect(isConfirmedCapacityRollback(refused,input)).toBe(true);
 expect(isConfirmedCapacityRollback(Error(refused.message),input)).toBe(false);
 expect(isConfirmedCapacityRollback(refused,{...input,machineId:'us-mac-m4'})).toBe(false);
});
