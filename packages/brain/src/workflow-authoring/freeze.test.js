import { describe, it, expect, vi } from 'vitest';
import { prepareDefinitionFreeze, assertPreparedFreeze } from './freeze.js';
import { validateRequest } from './contracts.js';

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
});
