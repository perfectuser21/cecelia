import {it,expect} from 'vitest';
import {fixture} from './canary-service-fixture.js';
async function service(f,extra={}){
 let api={};try{api=await import('../../canary-service.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
 expect(api.createAppServerCanaryService).toBeTypeOf('function');return api.createAppServerCanaryService({...f,...extra,pollMs:5,pollTimeoutMs:1000});
}
it('真实PG→HTTP→持久runner两代封存与清理后事务激活，重复推进不新建',async()=>{
 const f=await fixture();try{
  const s=await service(f),a=await s.prepare(f.input);
  expect(await s.advance(a.id)).toMatchObject({id:a.id,state:'active'});
  expect(f.calls.filter(x=>x==='create')).toHaveLength(2);expect(f.calls.filter(x=>x==='remove')).toHaveLength(2);expect(f.containers.size).toBe(0);
  const attempts=(await f.pool.query('SELECT r.status,e.envelope FROM app_server_canary_attempts m JOIN capacity_reservations r ON r.id=m.reservation_id JOIN app_server_canary_evidence e USING(reservation_id) WHERE m.authorization_id=$1',[a.id])).rows;
  expect(attempts).toHaveLength(2);expect(attempts.every(x=>x.status==='released'&&JSON.parse(x.envelope.receipt_json).canary_evidence.sealed)).toBe(true);
  expect((await f.pool.query('SELECT status,result FROM tasks WHERE id=$1',[a.evidence_task_id])).rows[0]).toMatchObject({status:'completed',result:{actor:'brain:app-server-canary'}});
  expect(await s.advance(a.id)).toMatchObject({state:'active'});expect(f.calls.filter(x=>x==='create')).toHaveLength(2);
 }finally{await f.close();}
});
it('start副作用后丢回执保持同预约；runner与服务重建后对账继续且不重复create',async()=>{
 const f=await fixture();try{
  let s=await service(f);const a=await s.prepare(f.input);f.startLost=true;
  await expect(s.advance(a.id)).rejects.toThrow();expect((await f.store.listOutstanding())).toHaveLength(1);expect(f.containers.size).toBe(1);
  f.restart();s=await service(f);expect(await s.advance(a.id)).toMatchObject({state:'active'});expect(f.calls.filter(x=>x==='create')).toHaveLength(2);
 }finally{await f.close();}
});
it('精确清理失回执保留占位和封存证据；重建后复用旧证据清理再做第二代',async()=>{
 const f=await fixture();try{
  let s=await service(f);const a=await s.prepare(f.input);f.removeFails=true;
  await expect(s.advance(a.id)).rejects.toThrow();expect((await f.pool.query('SELECT * FROM app_server_canary_evidence')).rows).toHaveLength(1);
  expect((await f.store.listOutstanding())[0].cancel_requested).toBe(true);expect((await f.pool.query('SELECT state FROM execution_grants WHERE id=$1',[a.grant_id])).rows[0].state).toBe('pending');
  f.restart();f.removeFails=false;s=await service(f);expect(await s.advance(a.id)).toMatchObject({state:'active'});expect(f.calls.filter(x=>x==='create')).toHaveLength(2);
 }finally{await f.close();}
});
it('失败协议可精确清理但永不激活；显式撤销不推进新代',async()=>{
 const f=await fixture();try{
  const s=await service(f),a=await s.prepare(f.input);f.invalidProtocol=true;
  expect(await s.advance(a.id)).toMatchObject({state:'failed'});expect(f.containers.size).toBe(0);
  expect(await s.advance(a.id)).toMatchObject({state:'failed'});expect(f.calls.filter(x=>x==='create')).toHaveLength(1);
  await f.authorizationStore.revoke(a.id);expect(await s.advance(a.id)).toMatchObject({state:'revoked'});expect(f.calls.filter(x=>x==='create')).toHaveLength(1);
 }finally{await f.close();}
});
it('双向流完成但证据存储回执丢失，跨runner重建只对账封存结果不重放RPC',async()=>{
 const f=await fixture();try{
  const a=await f.authorizationStore.prepare(f.input);
  const s=await service(f,{evidence:{...f.evidence,record:async()=>{throw Error('database unavailable');}}});
  await expect(s.advance(a.id)).rejects.toThrow('database unavailable');
  expect(f.calls.filter(x=>x==='initialize')).toHaveLength(1);expect((await f.store.listOutstanding())).toHaveLength(1);
  f.restart();expect(await (await service(f)).advance(a.id)).toMatchObject({state:'active'});
  expect(f.calls.filter(x=>x==='initialize')).toHaveLength(2);expect(f.calls.filter(x=>x==='create')).toHaveLength(2);
 }finally{await f.close();}
});
it('并发推进只有一个会话占验收锁；资源不足零启动且可继续',async()=>{
 const f=await fixture();let release;try{
  const a=await f.authorizationStore.prepare(f.input);let ready;
  const entered=new Promise(r=>{ready=r;}),held=new Promise(r=>{release=r;});
  const first=(await service(f,{collectSnapshot:async()=>{ready();await held;return {verified:false};}})).advance(a.id);
  await entered;expect(await (await service(f)).advance(a.id)).toMatchObject({state:'busy'});release();
  expect(await first).toMatchObject({state:'waiting_resources'});expect(f.calls).toEqual([]);
  await f.authorizationStore.revoke(a.id);expect(await (await service(f)).advance(a.id)).toMatchObject({state:'revoked'});expect(f.calls).toEqual([]);
 }finally{release?.();await f.close();}
});
