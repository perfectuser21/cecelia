const {createHash}=require('node:crypto');
const {signLinuxScriptPermit,verifyLinuxScriptPermit}=require('./linux-script-permit.cjs');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const key='a'.repeat(64),now=1700000000000;
const expected={machine_registry_id:'71d632df-252a-4991-ad6b-3647fbbea9f7',pool_config_digest:'b'.repeat(64),revision:'c'.repeat(40),host_boot_id:'12345678-1234-4234-8234-123456789abc',worker_boot_id:'22345678-1234-4234-8234-123456789abc',daemon_id:'fixed-daemon',execution_version_id:'32345678-1234-4234-8234-123456789abc',execution_grant_id:'42345678-1234-4234-8234-123456789abc',profile_digest:'d'.repeat(64)};
const body={reservation_id:'52345678-1234-4234-8234-123456789abc',request_nonce:'62345678-1234-4234-8234-123456789abc',job:{cmd:'echo test'}};
function issue(action='start',value=body){return signLinuxScriptPermit({key,expected,action,body:value,now});}
describe('Brain→root桥窄执行许可',()=>{
 it('真实HMAC绑定受信部署/版本/grant/boot与请求全文，验证只返回固定身份',()=>{
  const permit=issue();expect(verifyLinuxScriptPermit({key,expected,action:'start',body,permit,now})).toMatchObject({...expected,body_digest:hash(body)});
  expect(JSON.stringify(permit)).not.toContain(key);
 });
 it.each(['key','expected','action','body','signature','expiry','future','unknown'])('错误%s拒绝',kind=>{
  const permit=issue(),args={key,expected,action:'start',body,permit,now};
  if(kind==='key')args.key='f'.repeat(64);
  if(kind==='expected')args.expected={...expected,worker_boot_id:'72345678-1234-4234-8234-123456789abc'};
  if(kind==='action')args.action='cancel';
  if(kind==='body')args.body={...body,job:{cmd:'wrong'}};
  if(kind==='signature')permit.signature='e'.repeat(64);
  if(kind==='expiry')args.now=now+30001;
  if(kind==='future')args.now=now-1001;
  if(kind==='unknown')permit.payload.endpoint='http://evil';
  expect(()=>verifyLinuxScriptPermit(args)).toThrow('linux_script_permit_unverified');
 });
 it('清理许可可绑定历史boot/version，不要求该版本仍可新执行；动作不可互换',()=>{
  const cancel={...body,challenge:'82345678-1234-4234-8234-123456789abc',container_id:'f'.repeat(64)},permit=issue('cancel',cancel);
  expect(()=>verifyLinuxScriptPermit({key,expected,action:'cancel',body:cancel,permit,now})).not.toThrow();
  expect(()=>verifyLinuxScriptPermit({key,expected,action:'start',body:cancel,permit,now})).toThrow();
 });
 it('不接受缺省key、未知动作、自报额外期望字段或US设备',()=>{
  for(const patch of [{key:null},{action:'exec'},{expected:{...expected,key:'secret'}},{expected:{...expected,machine_registry_id:'1a379d80-ad36-47d3-88ba-e545ab299a54'}}])
   expect(()=>signLinuxScriptPermit({key,expected,action:'start',body,now,...patch})).toThrow('linux_script_permit_unverified');
 });
});
