import {it,expect} from 'vitest';
import {fixture} from './canary-service-fixture.js';
import {createCanaryEvidenceStore} from '../../canary-evidence.js';
import {createAppServerCanaryService} from '../../canary-service.js';
it('两代精确清理后也必须验完整签名；错key不提交授权，原封存证据可恢复激活',async()=>{
 const f=await fixture();try{
  const a=await f.authorizationStore.prepare(f.input);
  await expect(f.evidence.activate(a.id)).rejects.toThrow('appserver_canary_evidence_incomplete');
  const service=createAppServerCanaryService({...f,pollMs:5,pollTimeoutMs:1000,evidence:{...f.evidence,activate:async()=>{throw Error('activation response unavailable');}}});
  await expect(service.advance(a.id)).rejects.toThrow('activation response unavailable');
  expect(f.containers.size).toBe(0);expect((await f.pool.query('SELECT count(*)::int AS n FROM app_server_canary_evidence')).rows[0].n).toBe(2);
  const wrong=createCanaryEvidenceStore({...f,token:'wrong-signing-key'.repeat(3),afterTask:async()=>{}});
  await expect(wrong.activate(a.id)).rejects.toThrow('appserver_canary_evidence_invalid');
  expect((await f.pool.query('SELECT state FROM execution_grants WHERE id=$1',[a.grant_id])).rows[0].state).toBe('pending');
  expect(await f.evidence.activate(a.id)).toMatchObject({state:'active'});expect(f.calls.filter(x=>x==='create')).toHaveLength(2);
  expect((await f.pool.query('SELECT status,result FROM tasks WHERE id=$1',[a.evidence_task_id])).rows[0]).toMatchObject({status:'completed',result:{actor:'brain:app-server-canary'}});
 }finally{await f.close();}
});
