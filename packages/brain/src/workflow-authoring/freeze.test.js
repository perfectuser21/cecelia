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

describe('共享中央 Skill 与来源读取总预算回归',()=>{
  it('共享中央 Skill 保留双来源身份且不读取业务树已迁出的文件',async()=>{
    const {validateFixedImplementationBindings}=await import('./fixed-git-source.js');
    const {definitionDigest}=await import('./contracts.js');
    const d=definition(),path='.claude/skills/demo/SKILL.md',central='perfectuser21/zenithjoy-skills';
    const centralRevision='b'.repeat(40),centralPath='business-skills/zenithjoy/demo/SKILL.md';
    const content='---\nname: demo\nversion: 1\n---\ncentral shared skill\n';
    const contract={key:'original',name:'共享活动',implementation:{kind:'skill',repo,path,revision:'contract'}};
    const files=new Map([
      ['shared.json',JSON.stringify({activities:[contract]})],
      ['.skills-source.json',JSON.stringify({version:1,repository:central,revision:centralRevision,profile:'zenithjoy',loader_sha256:'c'.repeat(64)})],
      ['distribution/catalog.json',JSON.stringify({version:1,profiles:{zenithjoy:{files:[{path,source:centralPath,sha256:createHash('sha256').update(content).digest('hex')}]}}})],
      [centralPath,content],
    ]);
    const readFile=vi.fn(async source=>{
      if(source.path===d.source.ref)return document(d);
      if(!files.has(source.path))throw Error('业务树文件不存在：'+source.path);
      return files.get(source.path);
    });
    const bindings=await validateFixedImplementationBindings(contract,{repo,commit:revision},{readFile});
    const version={id:'shared-version',activity_id:'shared-activity',source_repo:repo,source_path:'shared.json',source_commit:revision,
      contract_sha256:definitionDigest(contract),payload:{activity_id:'shared-activity',contract,steps:[],implementation_bindings:bindings}};
    d.activities=[{key:'read',reuse_activity_id:version.activity_id,reuse_activity_definition_version_id:version.id,reuse_contract_sha256:version.contract_sha256}];
    readFile.mockClear();
    const proof=await prepareDefinitionFreeze(d,{readFile,sharedVersions:[version]});
    expect(proof.bindings.get('read')).toEqual(bindings);
    expect(proof.bindings.get('read')[0].resolved_source).toEqual({repo:central,path:centralPath,revision:centralRevision});
    expect(readFile.mock.calls.some(([s])=>s.path==='.skills-source.json')).toBe(true);
    expect(readFile.mock.calls.some(([s])=>s.repo===central&&s.path===centralPath)).toBe(true);
    expect(readFile.mock.calls.some(([s])=>s.repo===repo&&s.path===path)).toBe(false);
  });

  it('耗时读取后所有业务 Git 请求仍共用六十秒总 deadline',async()=>{
    const d=definition(),tree='b'.repeat(40),rows=new Map();
    for(const [path,text] of [[d.source.ref,document(d)],['src/read.js','export const read=true;']]){
      const bytes=Buffer.from(text),sha=createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex');
      rows.set(path,{bytes,sha});
    }
    let now=0,definitionRead=false;const requests=[];
    const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
    try{
      const fetchFn=async url=>{
        requests.push({url,at:now});
        if(url.includes('/commits/'))return {ok:true,json:async()=>({sha:revision,tree:{sha:tree}})};
        if(url.includes('/trees/')){
          if(definitionRead)now=61000;
          return {ok:true,json:async()=>({sha:tree,truncated:false,tree:[...rows].map(([path,r])=>({path,type:'blob',mode:'100644',sha:r.sha}))})};
        }
        const row=[...rows.values()].find(r=>url.endsWith(r.sha));
        if(!definitionRead){now=50000;definitionRead=true;}
        return {ok:true,json:async()=>({sha:row.sha,size:row.bytes.length,encoding:'base64',content:row.bytes.toString('base64')})};
      };
      await expect(prepareDefinitionFreeze(d,{fetchFn,resolveToken:async()=>{if(definitionRead)now=61000;return 'fixture';}})).rejects.toThrow();
      expect(requests.filter(r=>r.at>=60000)).toEqual([]);
      expect(requests.filter(r=>r.url.includes('/blobs/'))).toHaveLength(1);
    }finally{clock.mockRestore();}
  });

  it('最后一个实现读取结束时取消也不能生成冻结证明',async()=>{
    const d=definition(),controller=new AbortController();
    const readFile=vi.fn(async source=>{
      if(source.path===d.source.ref)return document(d);
      controller.abort();return 'export const read=true;';
    });
    await expect(prepareDefinitionFreeze(d,{readFile,signal:controller.signal})).rejects.toThrow();
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});

it('自身绑定耗尽两百文件预算后在读取共享合同前拒绝',async()=>{
  const {validateFixedImplementationBindings}=await import('./fixed-git-source.js');
  const {definitionDigest}=await import('./contracts.js');
  const d=definition(),content='export const fixed=true;';
  const binding=index=>({kind:'code',repo,revision,path:`src/code-${index}.js`});
  const contract={key:'shared',implementation:binding(0)};
  const bindings=await validateFixedImplementationBindings(contract,{repo,commit:revision},{readFile:async()=>content});
  const version={id:'shared-version',activity_id:'shared-activity',source_repo:repo,source_path:'shared.json',source_commit:revision,
    contract_sha256:definitionDigest(contract),payload:{activity_id:'shared-activity',contract,steps:[],implementation_bindings:bindings}};
  d.activities=[
    {key:'own',implementation_bindings:Array.from({length:199},(_,index)=>binding(index))},
    {key:'reuse',reuse_activity_id:version.activity_id,reuse_activity_definition_version_id:version.id,reuse_contract_sha256:version.contract_sha256},
  ];
  const readFile=vi.fn(async source=>source.path===d.source.ref?document(d):source.path==='shared.json'?JSON.stringify({activities:[contract]}):content);
  const result=await prepareDefinitionFreeze(d,{readFile,sharedVersions:[version]}).then(()=>({accepted:true}),()=>({accepted:false}));
  expect(readFile.mock.calls.some(([source])=>source.path==='shared.json')).toBe(false);
  expect(readFile).toHaveBeenCalledTimes(200);
  expect(result.accepted).toBe(false);
});
