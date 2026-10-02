import {it,expect} from 'vitest';
import {fixture} from './canary-service-fixture.js';
import {randomUUID} from 'node:crypto';
import {directory} from '../../../execution-directory/directory.js';
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
it('活授权普通预约必须完整HOME/config与验收boot；Worker换boot拒绝旧预约start/流，未知旧boot不假释放',async()=>{
 const f=await fixture();try{
  const s=await service(f),a=await s.prepare(f.input);await s.advance(a.id);await directory.refresh({pool:f.pool});
  const capabilities=await f.client.probeCapabilities(a.machine_registry_id,a.node_version_id);
  const input={home:f.home,requestKey:randomUUID(),machineId:'xian-mac-m1',capacitySnapshot:await f.collectSnapshot('xian-mac-m1'),capabilities};
  await expect(f.store.reserve({...input,capabilities:{...capabilities,worker_boot_id:randomUUID()}})).rejects.toThrow('appserver_active_authorization_mismatch');
  await expect(f.store.reserve({...input,home:{...f.home,homeKey:'e'.repeat(64),homeId:'chat-other'}})).rejects.toThrow('appserver_active_authorization_mismatch');
  const {reservation:row}=await f.store.reserve(input);f.restart(true);
  await expect(f.client.start(row.id)).rejects.toThrow('appserver_worker_configuration_mismatch');
  await expect(f.client.prepareStream(row.id)).rejects.toThrow('appserver_worker_configuration_mismatch');
  expect(f.calls.filter(x=>x==='create')).toHaveLength(2);
  const pending=await f.store.requestCancel(row.id);
  // 没有Worker journal且旧boot变化时，未知取消不能伪造释放。
  await expect(f.client.cancel(pending.id)).rejects.toThrow();expect((await f.store.get(row.id)).status).toBe('cleanup_pending');
 }finally{await f.close();}
});
it('普通实例启动后Worker换boot，拒绝旧grant继续attach但历史同代清理仍可确认',async()=>{
 const f=await fixture();try{
  const s=await service(f),a=await s.prepare(f.input);await s.advance(a.id);await directory.refresh({pool:f.pool});
  const capabilities=await f.client.probeCapabilities(a.machine_registry_id,a.node_version_id);
  const {reservation:row}=await f.store.reserve({home:f.home,requestKey:randomUUID(),machineId:'xian-mac-m1',capacitySnapshot:await f.collectSnapshot('xian-mac-m1'),capabilities});
  await f.store.observe(row.id,await f.client.start(row.id));f.restart(true);
  await expect(f.client.prepareStream(row.id)).rejects.toThrow('appserver_worker_configuration_mismatch');
  await f.store.requestCancel(row.id);expect(await f.store.confirmCleanup(row.id,await f.client.cancel(row.id))).toMatchObject({status:'released'});
  expect(f.containers.size).toBe(0);
 }finally{await f.close();}
});
it('cancel已经成功但响应丢失，重建后精确释放且不重复RPC',async()=>{
 const f=await fixture();try{
  const a=await f.authorizationStore.prepare(f.input);let lost=true;
  const client={...f.client,cancel:async id=>{const result=await f.client.cancel(id);if(lost){lost=false;throw Error('lost cancel response');}return result;}};
  await expect((await service(f,{client})).advance(a.id)).rejects.toThrow('lost cancel response');
  expect(f.containers.size).toBe(0);expect((await f.store.listOutstanding())).toHaveLength(1);
  expect((await f.pool.query('SELECT state FROM execution_grants WHERE id=$1',[a.grant_id])).rows[0].state).toBe('pending');
  f.restart();expect(await (await service(f)).advance(a.id)).toMatchObject({state:'active'});
  expect(f.calls.filter(x=>x==='initialize')).toHaveLength(2);expect(f.calls.filter(x=>x==='create')).toHaveLength(2);
 }finally{await f.close();}
});
it('evidence提交成功后回执丢失，JSONB证据复用且不重复RPC',async()=>{
 const f=await fixture();try{
  const a=await f.authorizationStore.prepare(f.input);let lost=true;
  const evidence={...f.evidence,record:async(...args)=>{const result=await f.evidence.record(...args);if(lost){lost=false;throw Error('lost record response');}return result;}};
  await expect((await service(f,{evidence})).advance(a.id)).rejects.toThrow('lost record response');
  expect((await f.pool.query('SELECT * FROM app_server_canary_evidence')).rows).toHaveLength(1);
  f.restart();expect(await (await service(f)).advance(a.id)).toMatchObject({state:'active'});
  expect(f.calls.filter(x=>x==='initialize')).toHaveLength(2);expect(f.calls.filter(x=>x==='create')).toHaveLength(2);
 }finally{await f.close();}
});
it('grant写入失败必须回滚任务完成与accepted，重试复用两代持久签名',async()=>{
 const f=await fixture();try{
  const a=await f.authorizationStore.prepare(f.input);
  await f.pool.query(`CREATE FUNCTION review_reject_active() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.surface='app_server' AND NEW.state='active' THEN RAISE EXCEPTION 'review_grant_failure'; END IF;RETURN NEW;END $$;CREATE TRIGGER review_reject_active BEFORE UPDATE ON execution_grants FOR EACH ROW EXECUTE FUNCTION review_reject_active();`);
  await expect((await service(f)).advance(a.id)).rejects.toThrow('review_grant_failure');
  expect((await f.pool.query('SELECT status FROM tasks WHERE id=$1',[a.evidence_task_id])).rows[0].status).toBe('in_progress');
  expect((await f.pool.query('SELECT state,evidence FROM app_server_authorizations WHERE id=$1',[a.id])).rows[0]).toEqual({state:'prepared',evidence:null});
  expect((await f.pool.query('SELECT state FROM execution_grants WHERE id=$1',[a.grant_id])).rows[0].state).toBe('pending');
  expect((await f.pool.query('SELECT * FROM app_server_canary_evidence')).rows).toHaveLength(2);expect(await f.store.listOutstanding()).toHaveLength(0);
  await f.pool.query('DROP TRIGGER review_reject_active ON execution_grants');
  expect(await (await service(f)).advance(a.id)).toMatchObject({state:'active'});expect(f.calls.filter(x=>x==='initialize')).toHaveLength(2);expect(f.calls.filter(x=>x==='create')).toHaveLength(2);
 }finally{await f.close();}
});
it('RPC已开始但双向流未封存，重建保持占位且绝不重放initialize',async()=>{
 const f=await fixture();let req;try{
  const {request}=await import('node:http'),a=await f.authorizationStore.prepare(f.input);
  const protocol=ticket=>new Promise((resolve,reject)=>{
   req=request(ticket.stream_url,{method:'POST',headers:{authorization:`Bearer ${ticket.token}`,'content-type':'application/x-ndjson'}},res=>{
    res.once('data',()=>{resolve();});res.on('error',()=>{});
   });req.on('error',reject);req.flushHeaders();req.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'cecelia_canary',version:'1'},capabilities:{experimentalApi:true}}})+'\n');
  });
  await expect((await service(f,{protocol})).advance(a.id)).rejects.toThrow('appserver_canary_evidence_unconfirmed');
  expect(f.calls.filter(x=>x==='initialize')).toHaveLength(1);
  await expect((await service(f)).advance(a.id)).rejects.toThrow('appserver_canary_evidence_unconfirmed');
  expect(f.calls.filter(x=>x==='initialize')).toHaveLength(1);expect(f.calls.filter(x=>x==='create')).toHaveLength(1);
  expect(await f.store.listOutstanding()).toHaveLength(1);expect(f.containers.size).toBe(1);
  expect((await f.pool.query('SELECT state FROM execution_grants WHERE id=$1',[a.grant_id])).rows[0].state).toBe('pending');
  expect((await f.pool.query('SELECT status FROM tasks WHERE id=$1',[a.evidence_task_id])).rows[0].status).toBe('in_progress');
 }finally{req?.destroy();await f.close();}
});
it.each(['start','prepareStream'])('锁内cap响应延迟跨越grant有效期时必须拒绝普通%s',async action=>{
 const f=await fixture();try{
  await f.pool.query(`CREATE FUNCTION review_short_lifetime() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.authorization_expires_at=statement_timestamp()+interval '3 seconds'; RETURN NEW; END $$; CREATE TRIGGER a_review_short_lifetime BEFORE INSERT ON app_server_authorizations FOR EACH ROW EXECUTE FUNCTION review_short_lifetime();`);
  const a=await f.authorizationStore.prepare(f.input);expect(await (await service(f)).advance(a.id)).toMatchObject({state:'active'});await directory.refresh({pool:f.pool});
  const capabilities=await f.client.probeCapabilities(a.machine_registry_id,a.node_version_id);
  const {reservation:row}=await f.store.reserve({home:f.home,requestKey:randomUUID(),machineId:'xian-mac-m1',capacitySnapshot:await f.collectSnapshot('xian-mac-m1'),capabilities});
  if(action==='prepareStream')await f.store.observe(row.id,await f.client.start(row.id));
  const {createAppServerClient}=await import('../../client.js');
  const client=createAppServerClient({pool:f.pool,store:f.store,env:f.env,fetchFn:async(url,options)=>{
   const response=await fetch(url,options);
   if(url.endsWith('/capabilities'))await new Promise(r=>setTimeout(r,Math.max(0,Number(new Date(a.authorization_expires_at))-Date.now()+40)));
   return response;
  }});
  await expect(client[action](row.id)).rejects.toThrow();
  expect(f.calls.filter(x=>x==='create')).toHaveLength(action==='start'?2:3);expect(f.calls.filter(x=>x==='attach')).toHaveLength(2);
 }finally{await f.close();}
},10000);
it('cap断网释放锁但保留预算；撤销阻断普通capabilities，历史精确取消可达',async()=>{
 const f=await fixture();let release;try{
  const a=await f.authorizationStore.prepare(f.input);await (await service(f)).advance(a.id);await directory.refresh({pool:f.pool});
  const capabilities=await f.client.probeCapabilities(a.machine_registry_id,a.node_version_id);
  const {reservation:row}=await f.store.reserve({home:f.home,requestKey:randomUUID(),machineId:'xian-mac-m1',capacitySnapshot:await f.collectSnapshot('xian-mac-m1'),capabilities});
  const {createAppServerClient}=await import('../../client.js');let entered;
  const held=new Promise(r=>release=r),reached=new Promise(r=>entered=r);let fetches=0;
  const client=createAppServerClient({pool:f.pool,store:f.store,env:f.env,fetchFn:async()=>{fetches++;entered();await held;throw Error('network failed');}});
  const starting=client.start(row.id);const assertion=expect(starting).rejects.toThrow('appserver_worker_unavailable');await reached;
  expect((await f.pool.query("SELECT pg_try_advisory_xact_lock(hashtextextended('app-server-home:'||$1,0)) AS locked",[f.home.homeKey])).rows[0].locked).toBe(false);
  const revoking=f.authorizationStore.revoke(a.id);release();await assertion;await revoking;
  expect((await f.store.get(row.id)).status).toBe('reserved');expect(f.calls.filter(x=>x==='create')).toHaveLength(2);
  await expect(client.capabilities(f.home,'xian-mac-m1')).rejects.toThrow('execution_grant_denied');expect(fetches).toBe(1);
  await f.store.requestCancel(row.id);expect(await f.store.confirmCleanup(row.id,await f.client.cancel(row.id))).toMatchObject({status:'released'});
 }finally{release?.();await f.close();}
});
it.each(['start','prepareStream'])('pending挑战在cap探测期间到期后拒绝%s',async action=>{
 const f=await fixture();try{
  await f.pool.query(`CREATE FUNCTION short_challenge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.challenge_expires_at=statement_timestamp()+interval '1 second'; RETURN NEW; END $$; CREATE TRIGGER a_short_challenge BEFORE INSERT ON app_server_authorizations FOR EACH ROW EXECUTE FUNCTION short_challenge();`);
  const a=await f.authorizationStore.prepare(f.input),capabilities=await f.client.probeCapabilities(a.machine_registry_id,a.node_version_id);
  const {reservation:row}=await f.store.reserveCanary({authorizationId:a.id,sequence:1,capacitySnapshot:await f.collectSnapshot('xian-mac-m1'),capabilities});
  if(action==='prepareStream')await f.store.observe(row.id,await f.client.start(row.id));
  const {createAppServerClient}=await import('../../client.js');
  const client=createAppServerClient({pool:f.pool,store:f.store,env:f.env,fetchFn:async(url,options)=>{
   const response=await fetch(url,options);if(url.endsWith('/capabilities'))await new Promise(r=>setTimeout(r,Math.max(0,Number(new Date(a.challenge_expires_at))-Date.now()+40)));return response;
  }});
  await expect(client[action](row.id)).rejects.toThrow('appserver_canary_authorization_denied');
  expect(f.calls.filter(x=>x==='create')).toHaveLength(action==='start'?0:1);expect(f.calls.filter(x=>x==='attach')).toHaveLength(0);
 }finally{await f.close();}
});
