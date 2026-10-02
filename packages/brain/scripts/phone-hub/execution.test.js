import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {serverFixture,token,endpoint,node} from '../../src/__tests__/fixtures/phone-http.js';
import {resolvePhoneHttpLeaseBinding} from '../../src/phone-dispatch/http-binding.js';
import {createPhoneHttpClient} from '../../src/phone-dispatch/http-client.js';
const require=createRequire(import.meta.url),py=fileURLToPath(new URL('../phone-ssh/http_physical_fixture.py',import.meta.url));
const callPython=(root,mode,input)=>new Promise((resolve,reject)=>{const child=execFile('python3',['-B',py,root,mode],{timeout:5000,maxBuffer:16384},(error,out)=>error?reject(error):resolve(JSON.parse(out)));child.stdin.end(input??'');});
it('execution真实HTTP→固定SSH参数→真实Python取消墓碑→强身份HMAC客户端品牌',async()=>{
 const root=mkdtempSync(join(tmpdir(),'phone-http-execution-'));
 try{
  const execution=require('./execution.cjs');const physical=await callPython(root,'setup');
  const e=endpoint();e.physical=Object.fromEntries(Object.keys(e.physical).map(k=>[k,physical[k]]));
  const n=node();n.worker_boot_id=physical.physical_boot_id;n.endpoints.phone_hub=e;
  const row={id:randomUUID(),task_id:randomUUID(),reservation_id:randomUUID(),execution_version_id:n.id,execution_grant_id:randomUUID(),lease_token:randomUUID(),execution_id:randomUUID(),transport_mode:'http',machine_id:n.canonical_id,worker_id:n.worker_id,worker_boot_id:n.worker_boot_id,host:'fixture-host',serial:'fixture-serial',profile:'fixture-profile',account_id:'fixture-account',action:'adb_get_state',config_digest:'f'.repeat(64),http_binding:{execution_version_id:n.id,...e},canonical_id:n.canonical_id,version_worker_id:n.worker_id,version_boot_id:n.worker_boot_id,version_endpoints:n.endpoints};
  const b=await resolvePhoneHttpLeaseBinding({query:async()=>({rows:[row]})},{dispatchId:row.id});let calls=0;
  const transport=execution.createExecution({targets:[{...e.physical,ssh:{host:'fixture-host',user:'administrator',port:22}}],run:async(file,args,input)=>{
   calls++;expect(file).toBe('/usr/bin/ssh');expect(args).toContain('StrictHostKeyChecking=yes');expect(args.at(-2)).toBe('fixture-host');expect(args.at(-1)).toBe('/opt/homebrew/bin/python3 /opt/cecelia/phone-ssh/runner.py');
   const out=await callPython(root,'handle',input);return {code:0,stdout:JSON.stringify(out)};
  }});
  const {createPhoneHubServer}=require('./service.cjs');
  const hub=createPhoneHubServer({token,identity:{hub_id:e.hub_id,boot_id:e.hub_boot_id,build_digest:e.hub_build_digest,config_digest:e.hub_config_digest,http_endpoint:e.http_endpoint,hub_process_identity:{pid:123,pgid:123,boot_id:e.hub_boot_id,start_time:'fixture-start',state:'S'}},capabilities:async()=>({}),maintenance:async()=>({}),execution:transport});
  await serverFixture((req,res)=>hub.emit('request',req,res),async()=>{
   const client=createPhoneHttpClient({token});const cancelled=await client.cancel(b);expect(cancelled.identity).toMatchObject({status:'failed',reason:'phone_cancelled',execution_exited:true,lock_released:true,lock_owner:b.lease_token});
   expect((await client.inspect(b)).identity).toEqual(cancelled.identity);await expect(client.start(b)).rejects.toThrow('phone_http_unconfirmed');expect(calls).toBe(3);
  });
 }finally{rmSync(root,{recursive:true,force:true});}
});
