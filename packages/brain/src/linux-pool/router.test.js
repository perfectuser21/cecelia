import express from 'express';
import { afterEach,it,expect,vi } from 'vitest';
import { createLinuxPoolRouter } from './router.js';
import { createDeploymentReader,normalizeDeployment } from './deployment.js';
const servers=[];
afterEach(async()=>{vi.unstubAllEnvs();await Promise.all(servers.splice(0).map(s=>new Promise(r=>s.close(r))));});
async function fixture(){let calls=0;const service=Object.fromEntries(['challenge','attest','activate','revoke','get'].map(method=>[method,async(id,body)=>{calls++;return {method,id,body,execution:false};}]));
 const app=express();app.use(express.json({limit:'40kb'}));app.use('/machines/linux-pool',createLinuxPoolRouter(service));const server=app.listen(0,'127.0.0.1');servers.push(server);await new Promise(r=>server.once('listening',r));return {url:`http://127.0.0.1:${server.address().port}/machines/linux-pool/a`,calls:()=>calls};}
it('真实HTTP未配置及错误内部token均拒绝，loopback也不能自授',async()=>{
 vi.stubEnv('CECELIA_INTERNAL_TOKEN','');const f=await fixture();
 expect((await fetch(f.url+'/challenges',{method:'POST'})).status).toBe(503);expect(f.calls()).toBe(0);
 vi.stubEnv('CECELIA_INTERNAL_TOKEN','internal-fixture-token');
 expect((await fetch(f.url+'/activate',{method:'POST',headers:{Authorization:'Bearer wrong'}})).status).toBe(401);expect(f.calls()).toBe(0);
});
it('固定内部路由委托同服务，不接受通用机器PATCH作为授权',async()=>{
 vi.stubEnv('CECELIA_INTERNAL_TOKEN','internal-fixture-token');const f=await fixture();
 for(const [suffix,method]of [['challenges','challenge'],['attest','attest'],['activate','activate'],['revoke','revoke']]){
  const r=await fetch(f.url+'/'+suffix,{method:'POST',headers:{Authorization:'Bearer internal-fixture-token','Content-Type':'application/json'},body:JSON.stringify({expected_version_id:null})});expect(r.status).toBe(200);expect(await r.json()).toMatchObject({method,execution:false});
 }
 expect((await fetch(f.url+'/activate',{method:'PATCH',headers:{Authorization:'Bearer internal-fixture-token'}})).status).toBe(404);
});
it('部署读取默认拒绝，只有固定保护配置引用的凭据文件能作为签名密钥',async()=>{
 await expect(createDeploymentReader({env:{}})('id')).rejects.toThrow('linux_pool_deployment_unavailable');
 const paths=[];const reader=createDeploymentReader({env:{CECELIA_LINUX_POOL_DEPLOYMENTS_FILE:'/etc/cecelia/pools.json'},readProtected:(p,opts)=>{paths.push([p,opts]);return JSON.stringify({schema_version:1,deployments:[]});}});
 await expect(reader('id')).rejects.toThrow('linux_pool_deployment_unavailable');expect(paths).toHaveLength(1);expect(paths[0][1]).toMatchObject({mode:0o600,maxBytes:65536});
 expect(()=>normalizeDeployment({endpoint:'http://evil',token:'fake'},'fake')).toThrow('linux_pool_deployment_invalid');
});
