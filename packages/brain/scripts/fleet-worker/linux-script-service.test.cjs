const {createLinuxScriptService}=require('./linux-script-service.cjs');
const {fixture}=require('./linux-script-test-fixture.cjs');
const {randomUUID}=require('node:crypto');
describe('root服务部署更换与历史清理',()=>{
 it.each(['missing','malformed'])('root凭据不传入普通Worker，部署%s默认禁新执行，历史操作仍接持久runtime',async kind=>{
  const calls=[],boot=randomUUID(),pool=fixture().record.pool;
  const service=createLinuxScriptService({key:'a'.repeat(64),pool,workerBootId:boot,stateRoot:'/trusted',
   readDeployment:()=>{if(kind==='missing')throw Error('missing');return {};},createRuntime:options=>{calls.push(options);return {inspect:async()=>({status:'cleaned'}),close(){}};},createGate:()=>async()=>{}});
  expect(await service.inspect({})).toEqual({status:'cleaned'});
  expect(calls[0].deployment).toMatchObject({pool,worker_boot_id:boot,execution_enabled:false,profiles:{}});
  service.close();
 });
 it('root部署更新构建新runtime，仍用当前进程boot；活动操作期间禁止换代',async()=>{
  const pool=fixture().record.pool,calls=[],closed=[];let value={pool,execution_enabled:false,profiles:{}};
  let release;const hold=new Promise(r=>release=r);
  const service=createLinuxScriptService({key:'a'.repeat(64),pool,workerBootId:randomUUID(),stateRoot:'/trusted',readDeployment:()=>value,
   createRuntime:o=>{const id=calls.length;calls.push(o);return {start:async()=>hold,inspect:async()=>id,close:()=>closed.push(id)};},createGate:()=>async()=>{}});
  expect(await service.inspect({})).toBe(0);const pending=service.start({});
  value={...value,execution_enabled:true};await expect(service.inspect({})).rejects.toThrow('linux_script_service_deployment_busy');
  release();await pending;expect(await service.inspect({})).toBe(1);expect(closed).toEqual([0]);service.close();
 });
 it('运行中配置变更会被最终闸重新读取发现，HTTP无法提供配置或依赖',async()=>{
  const pool=fixture().record.pool;let value={pool,execution_enabled:true,profiles:{}},gateOptions;
  const service=createLinuxScriptService({key:'a'.repeat(64),pool,workerBootId:randomUUID(),stateRoot:'/trusted',readDeployment:()=>value,
   createRuntime:()=>({inspect:async()=>true,close(){}}),createGate:o=>{gateOptions=o;return async()=>{};}});
  await service.inspect({deployment:{execution_enabled:true}});const before=gateOptions.configDigest;
  value={...value,execution_enabled:false};expect(await gateOptions.readConfigDigest()).not.toBe(before);service.close();
 });
});
