import {it,expect} from 'vitest';
import {fixture} from './canary-service-fixture.js';
import {createAppServerCanaryService} from '../../canary-service.js';
import {directory} from '../../../execution-directory/directory.js';
import {randomUUID} from 'node:crypto';
const service=(f,extra={})=>createAppServerCanaryService({...f,...extra,pollMs:5,pollTimeoutMs:1000});
it('prepare同事务登记持久作业，调度推进后保留下一次身份复核时间',async()=>{
 const f=await fixture();try{
  const a=await service(f).prepare(f.input);
  const job=(await f.pool.query('SELECT * FROM app_server_authorization_jobs WHERE authorization_id=$1',[a.id])).rows[0];expect(job.root_authorization_id).toBe(a.id);
  expect((await service(f).run())[0]).toMatchObject({id:a.id,state:'active'});
  expect((await f.pool.query('SELECT next_run_at FROM app_server_authorization_jobs WHERE authorization_id=$1',[a.id])).rows[0].next_run_at).toBeTruthy();
 }finally{await f.close();}
});
it.each(['boot','expiry'])('活授权%s变化自动退役、清理、创建新代并重新验收，旧历史不改写',async mode=>{
 const f=await fixture();try{
  if(mode==='expiry')await f.pool.query(`CREATE FUNCTION short_lifetime() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.authorization_expires_at=statement_timestamp()+interval '3 seconds'; RETURN NEW; END $$; CREATE TRIGGER a_short_lifetime BEFORE INSERT ON app_server_authorizations FOR EACH ROW EXECUTE FUNCTION short_lifetime();`);
  const a=await service(f).prepare(f.input);await service(f).advance(a.id);
  if(mode==='boot')f.restart(true);
  if(mode==='expiry'){await f.pool.query('DROP TRIGGER a_short_lifetime ON app_server_authorizations');await new Promise(r=>setTimeout(r,Math.max(0,Number(new Date(a.authorization_expires_at))-Date.now()+40)));}
  const advanced=await service(f).advance(a.id);
  expect(advanced).toMatchObject({id:a.id,state:'renewing'});expect(advanced.successor_id).toBeTruthy();
  expect((await f.pool.query('SELECT state FROM app_server_authorizations WHERE id=$1',[a.id])).rows[0].state).toBe('revoked');
  expect(await service(f).advance(advanced.successor_id)).toMatchObject({state:'active'});
  expect(f.calls.filter(x=>x==='create')).toHaveLength(4);
 }finally{await f.close();}
},15000);
it('内部退役提交后丢回执仍按持久marker恢复；显式撤销原根会阻止已创建续验任务复活',async()=>{
 const f=await fixture();try{
  const a=await service(f).prepare(f.input);await service(f).advance(a.id);f.restart(true);
  let lost=true;const authorizationStore={...f.authorizationStore,retire:async id=>{const r=await f.authorizationStore.retire(id);if(lost){lost=false;throw Error('retire response lost');}return r;}};
  await expect(service(f,{authorizationStore}).advance(a.id)).rejects.toThrow('retire response lost');
  const next=await service(f).advance(a.id);expect(next.state).toBe('renewing');
  await f.authorizationStore.revoke(a.id);
  expect(await service(f).advance(next.successor_id)).toMatchObject({state:'revoked'});
  expect(await service(f).advance(a.id)).toMatchObject({state:'revoked'});expect(f.calls.filter(x=>x==='create')).toHaveLength(2);
  expect((await f.pool.query("SELECT count(*)::int AS n FROM execution_grants WHERE surface='app_server' AND state='active'")).rows[0].n).toBe(0);
 }finally{await f.close();}
});
it('续验精确清理未知时不创建后继，显式撤销后重试只清理且不重新授权',async()=>{
 const f=await fixture();try{
  const a=await service(f).prepare(f.input);await service(f).advance(a.id);await directory.refresh({pool:f.pool});
  const capabilities=await f.client.probeCapabilities(a.machine_registry_id,a.node_version_id);
  const {reservation:row}=await f.store.reserve({home:f.home,requestKey:randomUUID(),machineId:'xian-mac-m1',capacitySnapshot:await f.collectSnapshot('xian-mac-m1'),capabilities});
  await f.store.observe(row.id,await f.client.start(row.id));f.restart(true);f.removeFails=true;
  await expect(service(f).advance(a.id)).rejects.toThrow();expect((await f.store.get(row.id)).status).toBe('cleanup_pending');
  expect((await f.pool.query('SELECT successor_id FROM app_server_authorization_jobs WHERE authorization_id=$1',[a.id])).rows[0].successor_id).toBeNull();
  await f.authorizationStore.revoke(a.id);f.removeFails=false;
  expect(await service(f).advance(a.id)).toMatchObject({state:'revoked'});expect(f.containers.size).toBe(0);
  expect((await f.pool.query('SELECT count(*)::int AS n FROM app_server_authorizations')).rows[0].n).toBe(1);
 }finally{await f.close();}
});
it('显式单独撤销grant后，即使boot变化也不能通过自动续验复活',async()=>{
 const f=await fixture();try{
  const a=await service(f).prepare(f.input);await service(f).advance(a.id);
  await f.pool.query("UPDATE execution_grants SET state='revoked' WHERE id=$1",[a.grant_id]);f.restart(true);
  await expect(service(f).advance(a.id)).rejects.toThrow('appserver_authorization_renewal_denied');
  expect((await f.pool.query('SELECT count(*)::int AS n FROM app_server_authorizations')).rows[0].n).toBe(1);
 }finally{await f.close();}
});
it('过期prepared挑战清理确认后归档原验收任务为失败，新代独立建账',async()=>{
 const f=await fixture();try{
  await f.pool.query(`CREATE FUNCTION short_challenge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.challenge_expires_at=statement_timestamp()+interval '300 milliseconds'; RETURN NEW; END $$; CREATE TRIGGER a_short_challenge BEFORE INSERT ON app_server_authorizations FOR EACH ROW EXECUTE FUNCTION short_challenge();`);
  const a=await service(f).prepare(f.input);await f.pool.query('DROP TRIGGER a_short_challenge ON app_server_authorizations');
  await new Promise(r=>setTimeout(r,Math.max(0,Number(new Date(a.challenge_expires_at))-Date.now()+40)));
  const next=await service(f).advance(a.id);
  expect(next.state).toBe('renewing');
  expect((await f.pool.query('SELECT status,result FROM tasks WHERE id=$1',[a.evidence_task_id])).rows[0]).toMatchObject({status:'failed',result:{actor:'brain:app-server-canary',evidence:{cleanup_confirmed:true}}});
  expect(await service(f).advance(next.successor_id)).toMatchObject({state:'active'});
 }finally{await f.close();}
});
