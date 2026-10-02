import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {node,token,wire,signed} from '../__tests__/fixtures/phone-http.js';
import {resolvePhoneHubBinding} from './http-binding.js';
import {verifyPhoneHubReceipt} from './http-receipt.js';
async function binding(){const n=node();return resolvePhoneHubBinding({query:async()=>({rows:[n]})},{executionVersionId:n.id,machineId:n.canonical_id});}
it('现有Hub wire按原JSON回签；只返回原始资源，不制造available或authenticated位',async()=>{
 const b=await binding(),nonce=randomUUID(),r=wire('capabilities',nonce);
 const out=verifyPhoneHubReceipt(signed(r),{binding:b,token,nonce,operation:'capabilities'});
 expect(out.resources).toEqual(r.resources);expect(out.physical_boot_id).toBe(b.physical.physical_boot_id);expect(out).not.toHaveProperty('available');expect(out).not.toHaveProperty('authenticated');expect(Object.isFrozen(out.resources)).toBe(true);
});
it('签名、nonce、完整Hub/physical身份、schema和时间逐项拒绝',async()=>{
 const b=await binding(),nonce=randomUUID(),r=wire('capabilities',nonce),opts={binding:b,token,nonce,operation:'capabilities'};
 expect(()=>verifyPhoneHubReceipt({...signed(r),signature:'0'.repeat(64)},opts)).toThrow();
 for(const [key,value]of Object.entries({request_nonce:randomUUID(),hub_id:'foreign',boot_id:'foreign',http_endpoint:'http://evil:3459/',build_digest:'b'.repeat(64),config_digest:'b'.repeat(64),machine_id:'foreign',worker_id:'foreign',physical_boot_id:'foreign',action_digest:'b'.repeat(64),schema:'phone-ssh/v1',scope:'all-mmv',execution:true,observed_at:new Date(Date.now()-60000).toISOString(),authenticated:true,available:1}))expect(()=>verifyPhoneHubReceipt(signed({...r,[key]:value}),opts)).toThrow();
 expect(()=>verifyPhoneHubReceipt(signed(r),{...opts,binding:{...b}})).toThrow();
 for(const patch of [{physical_config_digest:'f'.repeat(64)},{physical_build_digest:'f'.repeat(64)},{physical_observed_at:new Date(Date.now()-60000).toISOString()},{physical_observed_at:undefined}])expect(()=>verifyPhoneHubReceipt(signed({...r,...patch}),opts)).toThrow();
 for(const key of ['physical_config_digest','physical_build_digest','physical_observed_at'])expect(()=>verifyPhoneHubReceipt({...signed(r),receipt:{...r,[key]:'tampered'}},opts)).toThrow();
});
it('资源未知、counter/marker矛盾不验过；本地scope不能证明全部MMV静止',async()=>{
 const b=await binding(),nonce=randomUUID(),r=wire('capabilities',nonce),opts={binding:b,token,nonce,operation:'capabilities'};
 for(const patch of [{resources:{}},{external_locks:{occupied:1}},{maintenance:{...r.maintenance,quiescent:true}},{resources:{...r.resources,cpu_count:0}}])expect(()=>verifyPhoneHubReceipt(signed({...r,...patch}),opts)).toThrow();
 const m=wire('maintenance',nonce);expect(verifyPhoneHubReceipt(signed(m),{...opts,operation:'maintenance'})).toMatchObject({proof_scope:'hub-control',assurance:'hub_control_only'});
 const unknown={...m,pending:null,stable:false,quiescent:false,targets:[{machine_id:b.physical.machine_id,status:'unknown'}]};
 expect(verifyPhoneHubReceipt(signed(unknown),{...opts,operation:'maintenance'}).pending).toBe(null);
 for(const patch of [{pending:0},{stable:true},{quiescent:true},{proof_scope:'all-mmv'},{targets:[]}])expect(()=>verifyPhoneHubReceipt(signed({...unknown,...patch}),{...opts,operation:'maintenance'})).toThrow();
});
