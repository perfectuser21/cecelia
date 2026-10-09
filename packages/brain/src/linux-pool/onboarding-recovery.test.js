import {it,expect,vi} from 'vitest';
import {createOnboardingRecovery} from './onboarding-recovery.js';
it('原验收不存在或已被明确撤销时，不读凭据、不退役授权、不重新验收',async()=>{
 for(const row of [undefined,{id:'runtime',state:'revoked',evidence_task_id:'evidence'}]){
  const readRuntime=vi.fn(),retire=vi.fn();let count=0;
  const query=vi.fn(async()=>({rows:++count===1?(row?[row]:[]):[{payload:{linux_runtime_revoked:true}}]}));
  const recover=createOnboardingRecovery({pool:{query},readRuntime,runtimeAuthorization:{retire}});
  await expect(recover('script','machine',{runtime_json:JSON.stringify({id:'runtime'})},{}))
   .rejects.toThrow(row?'linux_pool_explicitly_revoked':'linux_pool_stage_unconfirmed');
  expect(readRuntime).not.toHaveBeenCalled();expect(retire).not.toHaveBeenCalled();
 }
});

it('真实签名cleanup退役后保留精确runtime marker，未知签名不生成接续依据',async()=>{
 const {fixture}=await import('./__tests__/runtime-receipt-fixture.js');
 const {createHmac,randomUUID}=await import('node:crypto');
 const f=fixture(),id=randomUUID(),machine=f.deployment.expected.machine_registry_id,evidence=randomUUID();
 const receipt={...f.receipt,schema_version:'linux-script-canary-cleanup/v1'};delete receipt.script_adapter_verified;
 receipt.cases=receipt.cases.map(({proof:_p,terminal:_t,...c})=>({...c,not_started:false}));
 const envelope={receipt,signature:createHmac('sha256',f.deployment.key).update(JSON.stringify(receipt)).digest('hex')};
 const row={...f.challenge,id,evidence_task_id:evidence,machine_registry_id:machine,state:'prepared',db_now:new Date(f.now),policy_digest:f.deployment.policyDigest};
 const calls=[],pool={query:async(sql,args)=>{
  calls.push([sql,args]);if(sql.includes('FROM linux_script_authorizations'))return {rows:[row]};
  if(sql.startsWith('SELECT payload'))return {rows:[{payload:{}}]};
  if(sql.startsWith('UPDATE tasks'))return {rowCount:1,rows:[{id:evidence,status:'archived'}]};throw Error('unexpected');
 }};
 const retired=[],recover=createOnboardingRecovery({pool,readRuntime:async()=>f.deployment,runtimeAuthorization:{retire:async(...a)=>retired.push(a)},afterTerminal:async()=>{}});
 const state={runtime_json:JSON.stringify({id}),expected_version_id:randomUUID()};
 expect(await recover('script',machine,state,envelope)).toEqual({phase:'renew_wait',expected_version_id:state.expected_version_id,last_cleanup_runtime_id:id});
 expect(retired).toHaveLength(1);
 const archived=calls.find(([sql])=>sql.startsWith('UPDATE tasks'));
 const persisted=archived[1].map(v=>{try{return JSON.parse(v);}catch{return null;}}).find(v=>v?.evidence);
 expect(persisted.evidence.envelope_json).toBe(JSON.stringify(envelope));
 await expect(recover('script',machine,state,{...envelope,signature:'0'.repeat(64)})).rejects.toThrow('linux_pool_cleanup_receipt_invalid');
 expect(retired).toHaveLength(1);
});
