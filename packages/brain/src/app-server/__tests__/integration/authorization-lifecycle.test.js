import {it,expect} from 'vitest';
import {fixture} from './canary-service-fixture.js';
import {createAuthorizationLifecycle,authorizationJob} from '../../authorization-lifecycle.js';
it('内部续验产生单一后继；显式撤销原根后所有后继停止且不能再续验',async()=>{
 const f=await fixture();try{
  const a=await f.authorizationStore.prepare(f.input),lifecycle=createAuthorizationLifecycle(f.pool,async()=>{});
  await lifecycle.retire(a.id);await lifecycle.settle(a.id);
  expect((await authorizationJob(f.pool,a.id)).retired_for_renewal).toBe(true);
  const next=await f.authorizationStore.renew(a.id);expect(next.id).not.toBe(a.id);
  expect((await f.authorizationStore.renew(a.id)).id).toBe(next.id);
  await lifecycle.revoke(a.id);await lifecycle.settle(next.id);
  expect((await authorizationJob(f.pool,next.id)).root_revoked).toBe(true);
  await expect(f.authorizationStore.renew(a.id)).rejects.toThrow('appserver_authorization_renewal_denied');
  expect((await f.pool.query('SELECT state FROM execution_grants WHERE id=ANY($1::uuid[])',[[a.grant_id,next.grant_id]])).rows.every(x=>x.state==='revoked')).toBe(true);
  expect((await f.pool.query('SELECT status FROM tasks WHERE id=ANY($1::uuid[])',[[a.evidence_task_id,next.evidence_task_id]])).rows.every(x=>x.status==='failed')).toBe(true);
  expect(f.calls).toEqual([]);
 }finally{await f.close();}
});
