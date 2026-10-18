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
