import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {RECEIPT_BINDINGS} from './identity.js';
let api;try{api=await import('./client.js');}catch{}
const endpoint={host:'xian-m4',user:'administrator',port:22,hub:{host:'mmv',user:'administrator',port:22}};
function row(){const r=Object.fromEntries(RECEIPT_BINDINGS.map(k=>[k,randomUUID()]));return {...r,id:randomUUID(),host:endpoint.host,serial:'fixture-serial',profile:'fixture-profile',action:'adb_get_state',config_digest:'a'.repeat(64)};}
function client(run){expect(api?.createPhoneSshClient,'固定SSH客户端尚未实现').toBeTypeOf('function');return api.createPhoneSshClient({run});}
function reply(body,receipt){return {code:0,stdout:JSON.stringify({schema:'phone-ssh/v1',request_nonce:body.request_nonce,route:body.route,receipt})};}
it('两跳客户端只发固定argv和JSONstdin，认证由本机产生',async()=>{
 const r=row();let seen;
 const c=client(async(file,args,input)=>{seen={file,args,input};return reply(JSON.parse(input),{...r,dispatch_id:r.id,status:'running'});});
 const result=await c.request('start',r,endpoint);
 expect(result.authenticated).toBe(true);expect(seen.file).toBe('/usr/bin/ssh');
 expect(seen.args).toContain('StrictHostKeyChecking=yes');expect(seen.args).toContain('UserKnownHostsFile=/etc/cecelia/phone-ssh/known_hosts');
 expect(seen.args).toContain('/opt/homebrew/bin/node /opt/cecelia/phone-ssh/hub.cjs');
 expect(seen.args).toContain('mmv');expect(seen.args).toContain('-F');expect(seen.args).toContain('/dev/null');
 expect(JSON.parse(seen.input).identity).toMatchObject({dispatch_id:r.id,serial:r.serial});
});
for(const fault of ['exit','nonce','binding','route','oversized','json'])it(`SSH回复${fault}不能认证`,async()=>{
 const r=row(),c=client(async(file,args,input)=>{const body=JSON.parse(input),result=reply(body,{...r,dispatch_id:r.id,status:'running',authenticated:true});
 if(fault==='exit')result.code=255;
 if(fault==='oversized')result.stdout='x'.repeat(65537);
 if(fault==='json')result.stdout='partial';
 if(['nonce','binding','route'].includes(fault)){const e=JSON.parse(result.stdout);if(fault==='nonce')e.request_nonce=randomUUID();if(fault==='binding')e.receipt.serial='other';if(fault==='route')e.route.host='other';result.stdout=JSON.stringify(e);}
 return result;});await expect(c.request('inspect',r,endpoint)).rejects.toThrow(/phone_/);
});
it('完整终态退出和解锁证据缺失不能认证',async()=>{
 const r=row(),c=client(async(file,args,input)=>reply(JSON.parse(input),{...r,dispatch_id:r.id,status:'completed',execution_exited:false,lock_released:true,lock_owner:r.lease_token}));
 await expect(c.request('inspect',r,endpoint)).rejects.toThrow(/phone_/);
});
it('公开请求不接受任意动作及endpoint shell字段',async()=>{
 const c=client(async()=>{throw Error('unexpected_call');}),r=row();
 await expect(c.request('shell',r,endpoint)).rejects.toThrow(/phone_/);
 await expect(c.request('start',r,{...endpoint,path:'/tmp/evil'})).rejects.toThrow(/phone_/);
 await expect(c.request('start',r,{...endpoint,host:'-oProxyCommand=evil'})).rejects.toThrow(/phone_/);
});
it('MMV hub仅转发受信清单路由，下游nonce和绑定错误拒绝',async()=>{
 const require=createRequire(import.meta.url);let hub;try{hub=require('../../scripts/phone-ssh/hub.cjs');}catch{}
 expect(hub?.createHub,'固定中枢尚未实现').toBeTypeOf('function');
 const r=row(),route={host:endpoint.host,user:endpoint.user,port:endpoint.port},identity={...r,dispatch_id:r.id};delete identity.id;
 const input={schema:'phone-ssh/v1',operation:'inspect',request_nonce:randomUUID(),identity,route};
 let calls=0;const h=hub.createHub({routes:[{machine_id:r.machine_id,...route}],run:async(file,args,text)=>{calls++;expect(file).toBe('/usr/bin/ssh');expect(args.at(-1)).toBe('/opt/homebrew/bin/python3 /opt/cecelia/phone-ssh/runner.py');return {code:0,stdout:JSON.stringify({schema:'phone-ssh/v1',request_nonce:JSON.parse(text).request_nonce,receipt:{...identity,status:'unknown'}})};}});
 expect((await h.handle(input)).receipt.status).toBe('unknown');
 await expect(h.handle({...input,route:{...route,host:'attacker'}})).rejects.toThrow(/phone_/);expect(calls).toBe(1);
});
