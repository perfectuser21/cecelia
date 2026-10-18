import {it,expect} from 'vitest';
import {diagnosisFacts} from '../commander-diagnosis-facts.js';
const control={envelope:{workflow_key:'publish',run_id:'run',definition:{release_id:'release',snapshot_sha256:'fixed',runtime_snapshot_sha256:'runtime'}}};
it('离线事实保留固定身份并明确缺证据，不把业务输入当诊断事实',()=>{
 const facts=diagnosisFacts({...control,envelope:{...control.envelope,workflow_input:{caption:'private-caption'}},verification:{assertions:[{name:'readback',pass:false,detail:'作品未找到'}],evidence:[]}}, {reason:'verification_failed'}, []);
 expect(facts).toMatchObject({workflow_key:'publish',run_id:'run',definition:'fixed',reason:'verification_failed',evidence_status:'insufficient_evidence',verification:{assertions:[{name:'readback',pass:false,detail:'作品未找到'}]}});
 expect(JSON.stringify(facts)).not.toContain('private-caption');
});
it('URL凭据和私钥被清理，超大Unicode事实保持可解析且有界',()=>{
 const facts=diagnosisFacts({...control,delivery:{failure:{message:'https://user:pass@example.invalid/evidence?token=hidden-query -----BEGIN RSA PRIVATE KEY-----private-key-tail',stack:'故'.repeat(100000)}}},{reason:'failure'},Array.from({length:1000},()=>({repo:'owner/repo',revision:'a'.repeat(40),path:'x'.repeat(10000)})));
 const value=JSON.stringify(facts);
 expect(value).not.toMatch(/user:pass|hidden-query|private-key-tail/);
 expect(Buffer.byteLength(value)).toBeLessThanOrEqual(24000);
 expect(JSON.parse(value).truncated).toBe(true);
});
it('认证与Cookie头整体清理，不能保留Basic载荷或后续会话Cookie',()=>{
 const facts=diagnosisFacts({...control,delivery:{failure:{message:'Authorization: Basic ZmFrZTpzZWNyZXQ=\nCookie: session=fake-session; refresh=fake-refresh\nSet-Cookie: auth=fake-auth; token=fake-cookie'}}},{reason:'failure'},[]);
 const value=JSON.stringify(facts);
 expect(value).not.toMatch(/ZmFrZTpzZWNyZXQ=|fake-session|fake-refresh|fake-auth|fake-cookie/);
});
it('中文cleanup证据与JSON转义超预算时仍硬限24KB',()=>{
 const refs=Array.from({length:8},()=>({ref:'证'.repeat(256),path:'路'.repeat(256),url:'链'.repeat(256),sha256:'哈'.repeat(64)}));
 for(const letter of ['故','\u0001']){
  const facts=diagnosisFacts({...control,delivery:{failure:{reason:letter.repeat(512),message:letter.repeat(1024),stack:letter.repeat(2048)},cleanup:{completed:true,evidence:refs}}},{reason:letter.repeat(512)},[]);
  expect(Buffer.byteLength(JSON.stringify(facts))).toBeLessThanOrEqual(24000);
  expect(facts.truncated).toBe(true);
  expect(facts).toMatchObject({definition:'fixed',release_id:'release',delivery:{cleanup:{completed:true}}});
 }
});
