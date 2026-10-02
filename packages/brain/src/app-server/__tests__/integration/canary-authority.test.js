import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture} from './canary-service-fixture.js';
import {authorizePreparedCanary,authorizeCanaryReservation} from '../../canary-authority.js';
it('pending仅通过同代验收预约；错boot、错HOME、显式撤销均在启动前拒绝',async()=>{
 const f=await fixture();try{
  const a=await f.authorizationStore.prepare(f.input),capabilities=await f.client.probeCapabilities(a.machine_registry_id,a.node_version_id);
  const input={id:a.id,home:f.home,machineId:'xian-mac-m1',capabilities};
  expect((await authorizePreparedCanary(f.pool,input)).grantId).toBe(a.grant_id);
  await expect(authorizePreparedCanary(f.pool,{...input,capabilities:{...capabilities,worker_boot_id:randomUUID()}})).rejects.toThrow('appserver_canary_authorization_denied');
  await expect(authorizePreparedCanary(f.pool,{...input,home:{...f.home,homeKey:'d'.repeat(64)}})).rejects.toThrow('appserver_canary_authorization_denied');
  const {reservation}=await f.store.reserveCanary({authorizationId:a.id,sequence:1,capabilities,capacitySnapshot:await f.collectSnapshot('xian-mac-m1')});
  expect((await authorizeCanaryReservation(f.pool,reservation)).grantId).toBe(a.grant_id);
  await expect(authorizeCanaryReservation(f.pool,{...reservation,worker_boot_id:randomUUID()})).rejects.toThrow('appserver_canary_authorization_denied');
  await f.authorizationStore.revoke(a.id);
  await expect(authorizePreparedCanary(f.pool,input)).rejects.toThrow('appserver_canary_authorization_denied');expect(f.calls).toEqual([]);
 }finally{await f.close();}
});
