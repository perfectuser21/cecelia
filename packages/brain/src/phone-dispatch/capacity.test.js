import {it,expect} from 'vitest';
import {node,token,wire,signed} from '../__tests__/fixtures/phone-http.js';
import {observation} from '../__tests__/fixtures/phone-capacity.js';
import {resolvePhoneHubBinding} from './http-binding.js';
import {verifyPhoneHubReceipt} from './http-receipt.js';
async function binding(){const n=node();return resolvePhoneHubBinding({query:async()=>({rows:[n]})},{executionVersionId:n.id,machineId:n.canonical_id});}
async function capacity(){return import('./capacity.js');}
it('native HTTP品牌不可由clone、public verifier或caller verified位铸造',async()=>{
 const b=await binding(),real=await observation(b),{derivePhoneCapacity}=await capacity();
 const offline=wire('capabilities',real.request_nonce);offline.resources.data_free_bytes=5*1024**3;
 const verified=verifyPhoneHubReceipt(signed(offline),{binding:b,token,nonce:real.request_nonce,operation:'capabilities'});
 for(const fake of [{...real},structuredClone(real),verified,{verified:true,available:1},b])expect(()=>derivePhoneCapacity(fake,b,{capacity:8})).toThrow('phone_capacity_observation_required');
 expect(derivePhoneCapacity(real,b,{capacity:8}).capacity.available).toBeGreaterThan(1);
});
it('磁盘5GiB边界与DB结构预算；CPU负载和free memory不发明门槛',async()=>{
 const b=await binding(),{derivePhoneCapacity}=await capacity(),real=await observation(b);
 expect(derivePhoneCapacity(real,b,{capacity:2}).capacity.effective_base_slots).toBe(2);
 for(const invalid of [0,-1,1.5,'8',undefined])expect(()=>derivePhoneCapacity(real,b,{capacity:invalid})).toThrow('phone_capacity_profile_invalid');
 const low=await observation(b,{resources:{...real.resources,data_free_bytes:5*1024**3-1}});expect(derivePhoneCapacity(low,b,{capacity:8})).toBe(null);
 const loaded=await observation(b,{resources:{...real.resources,memory_free_bytes:0,load_1m:999}});expect(derivePhoneCapacity(loaded,b,{capacity:8}).capacity.available).toBeGreaterThan(1);
});
it('busy、draining、未知与真实观测过期都不能被资源预算抹平',async()=>{
 const b=await binding(),{derivePhoneCapacity}=await capacity(),real=await observation(b);
 expect(derivePhoneCapacity(real,b,{capacity:8},Date.now()+5001)).toBe(null);
 for(const patch of [{external_locks:{occupied:1},maintenance:{...real.maintenance,pending:1,external_occupied:1}}, {maintenance:{...real.maintenance,draining:true}}, {maintenance:{...real.maintenance,stable:false}}]){
  expect(derivePhoneCapacity(await observation(b,patch),b,{capacity:8})).toBe(null);
 }
 const n=node();n.id=b.execution_version_id;const other=await resolvePhoneHubBinding({query:async()=>({rows:[{...n,endpoints:{phone_hub:{...n.endpoints.phone_hub,hub_id:'different'}}}]})},{executionVersionId:n.id,machineId:n.canonical_id});
 expect(()=>derivePhoneCapacity(real,other,{capacity:8})).toThrow('phone_capacity_identity_mismatch');
});
