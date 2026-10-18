import { describe, it, expect, vi } from 'vitest';
import { prepareDefinitionFreeze, assertPreparedFreeze } from './freeze.js';
import { validateRequest } from './contracts.js';
import { createHash } from 'node:crypto';

const revision = 'a'.repeat(40), repo = 'perfectuser21/zenithjoy-workspace';
const definition = () => ({ key:'report', name:'报告', capability_id:'11111111-1111-4111-8111-111111111111',
  channel:'internal',form:'openclaw_skill',version:'1.0.0',
  source:{repo,ref:'commander/contracts/report.json',revision},
  runtime:{skill_id:'22222222-2222-4222-8222-222222222222',entrypoint:'workflow-commander'},
  input_schema:{type:'object'},resources:{},recovery:{max_attempts:1},
  activities:[{key:'read',name:'读回',executor_kind:'code',acceptance:['产物可读'],
    implementation:{kind:'code',ref:'src/read.js',version:'1.0.0',repo,path:'src/read.js',revision:'contract'}}] });
const document = d => { const {source:_source,...rest}=d;return JSON.stringify(rest); };
describe('显式 authoring 冻结来源协议',()=>{
  it('拒绝未知协议，旧请求仍可登记',()=>{
    const request={operation:'create',goal:'报告',actor:'测试'};
    expect(()=>validateRequest(request)).not.toThrow();
    expect(()=>validateRequest({...request,registration_protocol:'arbitrary'})).toThrow();
  });
  it('核实完整文件、实现字节与固定commit，证明只匹配已核验定义',async()=>{
    const d=definition(),readFile=vi.fn(async s=>s.path===d.source.ref?document(d):'export const read = true;');
    const proof=await prepareDefinitionFreeze(d,{readFile});
    expect(()=>assertPreparedFreeze(d,proof)).not.toThrow();
    expect(proof.bindings.get('read')[0]).toMatchObject({status:'verified',revision});
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({repo,revision,path:'src/read.js'}));
    await expect(prepareDefinitionFreeze({...d,input_schema:{type:'array'}},{readFile})).rejects.toThrow(/来源/);
    expect(()=>assertPreparedFreeze({...d,recovery:{max_attempts:8}},proof)).toThrow();
    expect(()=>assertPreparedFreeze(d,{...proof})).toThrow();
  });
  it.each([{repo:'evil.example/repo'},{ref:'../secret'},{revision:'main'}])('无效来源在读文件前拒绝 %j',async patch=>{
    const d=definition();Object.assign(d.source,patch);const readFile=vi.fn();
    await expect(prepareDefinitionFreeze(d,{readFile})).rejects.toThrow();expect(readFile).not.toHaveBeenCalled();
  });
  it('共享活动和无法核验的实现拒绝冻结',async()=>{
    const d=definition();d.activities[0].reuse_activity_id='11111111-1111-4111-8111-111111111111';
    await expect(prepareDefinitionFreeze(d,{readFile:async()=>document(d)})).rejects.toThrow(/共享/);
    delete d.activities[0].reuse_activity_id;d.activities[0].implementation.symbol='read';
    await expect(prepareDefinitionFreeze(d,{readFile:async s=>s.path===d.source.ref?document(d):'export const read=true;'})).rejects.toThrow(/实现/);
  });
  it('迁出业务树的 Skill 按业务锁冻结中央身份，坏摘要不生成证明',async()=>{
    const d=definition(),path='.claude/skills/demo/SKILL.md',central='perfectuser21/zenithjoy-skills',centralRevision='b'.repeat(40);
    const content='---\nname: demo\nversion: 1\n---\ncentral\n',digest=createHash('sha256').update(content).digest('hex');
    d.activities[0].implementation={kind:'skill',repo,path,revision:'contract',name:'demo',version:'1'};
    d.activities.push({...structuredClone(d.activities[0]),key:'read_again'});
    const lock=JSON.stringify({version:1,repository:central,revision:centralRevision,profile:'zenithjoy',loader_sha256:'a'.repeat(64)});
    const catalog=(sha=digest)=>JSON.stringify({version:1,profiles:{zenithjoy:{files:[{path,source:'business-skills/zenithjoy/demo/SKILL.md',sha256:sha}]}}});
    let catalogText=catalog();
    const readFile=vi.fn(async s=>s.path===d.source.ref?document(d):s.path==='.skills-source.json'?lock:s.path==='distribution/catalog.json'?catalogText:s.repo===central?content:Promise.reject(Error('deleted business skill')));
    const proof=await prepareDefinitionFreeze(d,{readFile});
    expect(proof.bindings.get('read')[0]).toMatchObject({status:'verified',repo,revision,path,resolved_source:{repo:central,revision:centralRevision,path:'business-skills/zenithjoy/demo/SKILL.md'}});
    expect(proof.bindings.get('read_again')[0].resolved_source).toEqual(proof.bindings.get('read')[0].resolved_source);
    expect(readFile.mock.calls.filter(([s])=>s.path==='distribution/catalog.json')).toHaveLength(1);
    expect(readFile).not.toHaveBeenCalledWith(expect.objectContaining({repo,path}));
    catalogText=catalog('0'.repeat(64));
    await expect(prepareDefinitionFreeze(d,{readFile})).rejects.toThrow(/摘要/);
  });
});
