import { describe, expect, it } from 'vitest';
describe('手机派发强身份与证据',()=>{
 it('无获批 SSH hub 配置时独立手机授权不可成立',async()=>{const {phoneSshValid}=await import('./identity.js');expect(Boolean(phoneSshValid({worker:'http://worker:5231'}))).toBe(false);});
 it('未知新鲜度或缺失物理容量拒绝；只接收有限的新鲜证据',async()=>{
  const {validSnapshot}=await import('./identity.js');const now=Date.now();
  const s={verified:true,machine:'m',captured_at:now,expires_at:now+30_000,capacity:{ok:true,available:1,physical_base_slots:4,effective_base_slots:4}};
  expect(validSnapshot(s,'m',now)).toBe(true);
  for(const delta of [{captured_at:undefined},{expires_at:undefined},{captured_at:now-90_000},{captured_at:now+1000},{capacity:{ok:true}},{machine:'other'}])expect(validSnapshot({...s,...delta},'m',now)).toBe(false);
 });
 it('终态回执必须认证、逐项身份绑定、确认退出和自己解除锁',async()=>{
  const {receiptMatches}=await import('./identity.js');
  const row={id:'dispatch',reservation_id:'reservation',task_id:'task',machine_id:'m',host:'host',serial:'phone',profile:'profile',account_id:'account',execution_version_id:'version',execution_grant_id:'grant',lease_token:'lease',execution_id:'execution',worker_id:'worker',worker_boot_id:'boot',action:'adb_get_state',config_digest:'a'.repeat(64)};
  const receipt={...row,dispatch_id:row.id,status:'completed',execution_exited:true,lock_released:true,lock_owner:row.lease_token};delete receipt.id;
  expect(receiptMatches(row,{authenticated:true,receipt},true)).toBe(true);
  for(const key of ['dispatch_id','reservation_id','task_id','machine_id','host','serial','profile','account_id','execution_version_id','execution_grant_id','lease_token','execution_id','worker_id','worker_boot_id','action','config_digest','lock_owner'])expect(receiptMatches(row,{authenticated:true,receipt:{...receipt,[key]:'foreign'}},true)).toBe(false);
  for(const delta of [{execution_exited:false},{lock_released:false},{status:'running'}])expect(receiptMatches(row,{authenticated:true,receipt:{...receipt,...delta}},true)).toBe(false);
  expect(receiptMatches(row,{authenticated:false,receipt},true)).toBe(false);
 });
});

it('SSH目标与hub严格配置，不接收环境URL或未批准参数',async()=>{
 const {phoneSshValid}=await import('./identity.js');const e={host:'xian-m1',port:22,user:'administrator',hub:{host:'us-vps',port:22,user:'administrator'}};
 expect(phoneSshValid(e)).toBe(true);for(const delta of [{hub:undefined},{host:'-oProxyCommand=evil'},{user:'root;false'},{port:0},{url:'http://worker'},{hub:{...e.hub,command:'evil'}}])expect(Boolean(phoneSshValid({...e,...delta}))).toBe(false);
});
