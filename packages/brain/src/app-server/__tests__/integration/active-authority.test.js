import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture} from './canary-service-fixture.js';
import {assertActiveAppServerAuthorization} from '../../active-authority.js';
import {createAppServerCanaryService} from '../../canary-service.js';
it('真实pending不可用于普通聊天；两代激活后仍绑定原HOME、Worker boot和profile',async()=>{
 const f=await fixture();try{
  const s=createAppServerCanaryService({...f,pollMs:5,pollTimeoutMs:1000}),a=await s.prepare(f.input);
  const auth={grantId:a.grant_id,executionVersionId:a.node_version_id,node:{worker_id:a.worker_id}};
  await expect(assertActiveAppServerAuthorization(f.pool,auth,f.home,a.worker_boot_id)).rejects.toThrow('appserver_active_authorization_mismatch');
  await s.advance(a.id);expect((await assertActiveAppServerAuthorization(f.pool,auth,f.home,a.worker_boot_id)).id).toBe(a.id);
  for(const home of [{...f.home,homeKey:'d'.repeat(64)},{...f.home,configDigest:'e'.repeat(64)}]){
   await expect(assertActiveAppServerAuthorization(f.pool,auth,home,a.worker_boot_id)).rejects.toThrow('appserver_active_authorization_mismatch');
  }
  await expect(assertActiveAppServerAuthorization(f.pool,auth,f.home,randomUUID())).rejects.toThrow('appserver_active_authorization_mismatch');
  await f.authorizationStore.revoke(a.id);
  await expect(assertActiveAppServerAuthorization(f.pool,auth,f.home,a.worker_boot_id)).rejects.toThrow('appserver_active_authorization_mismatch');
  expect(f.calls.filter(x=>x==='create')).toHaveLength(2);
 }finally{await f.close();}
});
