import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFixedGitFile, readFixedImplementationBinding } from './fixed-git-source.js';
import { validateFixedImplementationBindings } from './fixed-git-source.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
const revision = 'a'.repeat(40), repo = 'perfectuser21/zenithjoy-workspace';
describe('固定 GitHub 文件安全读取',()=>{
  function git(content='{"中文":"换行\\n"}') {
    const bytes=Buffer.from(content),sha=createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex');
    const tree='b'.repeat(40),calls=[];
    const fetchFn=vi.fn(async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('/commits/')?{sha:revision,tree:{sha:tree}}:url.includes('/trees/')?{sha:tree,tree:[{path:'contract.json',sha,type:'blob',mode:'100644'}]}:{sha,size:bytes.length,encoding:'base64',content:bytes.toString('base64')}};});
    return {fetchFn,calls,content};
  }
  it('只访问allowlist固定API，校验blob内容hash并保留原文字节',async()=>{
    const f=git();expect(await readFixedGitFile({repo,path:'contract.json',revision},{fetchFn:f.fetchFn,resolveToken:async()=> 'test-token'})).toBe(f.content);
    expect(f.calls).toHaveLength(3);expect(f.calls.every(c=>c.url.startsWith(`https://api.github.com/repos/${repo}/git/`)&&c.options.redirect==='error')).toBe(true);
  });
  it('篡改blob或非固定Git引用均拒绝',async()=>{
    const f=git(),original=f.fetchFn;
    await expect(readFixedGitFile({repo,path:'contract.json',revision},{resolveToken:async()=> 'test-token',fetchFn:async(u,o)=>{
      const r=await original(u,o);return {ok:true,json:async()=>({...await r.json(),...(u.includes('/blobs/')?{content:Buffer.from('bad').toString('base64')}:{})})};
    }})).rejects.toThrow(/来源/);
    const fetchFn=vi.fn();await expect(readFixedGitFile({repo:'evil/repo',path:'contract.json',revision},{fetchFn})).rejects.toThrow();expect(fetchFn).not.toHaveBeenCalled();
  });
  it('调用方取消及总deadline约束实际Git网络请求，过期时零请求',async()=>{
    const f=git(),control=new AbortController();control.abort();
    await expect(readFixedGitFile({repo,path:'contract.json',revision},{fetchFn:f.fetchFn,resolveToken:async()=> 'test-token',signal:control.signal})).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
    await expect(readFixedGitFile({repo,path:'contract.json',revision},{fetchFn:f.fetchFn,resolveToken:async()=> 'test-token',deadline:Date.now()-1})).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
  it('未读Git时不加载凭据依赖，默认真实读取仍调用原resolver',async()=>{
    vi.resetModules();const load=vi.fn(()=>{throw Error('credential_dependency_observed');});
    vi.doMock('../harness-credentials.js',load);
    try{
      const source=await import('./fixed-git-source.js');expect(load).not.toHaveBeenCalled();
      await expect(source.readFixedGitFile({repo,path:'contract.json',revision},{resolveToken:async()=> 'test-token',fetchFn:async()=>{throw Error('fixture_network');}})).rejects.toThrow('fixture_network');
      expect(load).not.toHaveBeenCalled();
      await expect(source.readFixedGitFile({repo,path:'contract.json',revision})).rejects.toThrow();expect(load).toHaveBeenCalledOnce();
    }finally{vi.doUnmock('../harness-credentials.js');vi.resetModules();}
  });

});

describe('集中 Skill 固定源',()=>{
  it('从每个业务提交独立解析中央锁，并保留声明与实际来源',async()=>{
    const root=mkdtempSync(join(tmpdir(),'fixed-skill-'));
    try{
      const dirs={ 'perfectuser21/zenithjoy-workspace':join(root,'business'), 'perfectuser21/zenithjoy-skills':join(root,'central') };
      const git=(dir,...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
      const put=(dir,path,data)=>{const target=join(dir,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data);};
      const commit=dir=>{git(dir,'add','-A');git(dir,'-c','user.name=Test','-c','user.email=test@example.com','commit','-qm','fixture');return git(dir,'rev-parse','HEAD');};
      for(const dir of Object.values(dirs))mkdirSync(dir),git(dir,'init','-q');
      const business=dirs['perfectuser21/zenithjoy-workspace'],central=dirs['perfectuser21/zenithjoy-skills'];
      const path='.claude/skills/demo/SKILL.md',source='business-skills/zenithjoy/demo/SKILL.md';
      const historicalContent='---\nname: historical\nversion: 1\n---\nfixed historical Skill\n';
      put(business,path,historicalContent);const historicalRevision=commit(business);
      const revisions=[];
      for(const version of ['1','2']){
        const content=`---\nname: demo\nversion: ${version}\n---\ncentral ${version}\n`;
        put(central,source,content);
        put(central,'distribution/catalog.json',JSON.stringify({version:1,profiles:{zenithjoy:{files:[{path,source,sha256:createHash('sha256').update(content).digest('hex')}]}}}));
        const skillRevision=commit(central);
        put(business,'.skills-source.json',JSON.stringify({version:1,repository:'perfectuser21/zenithjoy-skills',revision:skillRevision,profile:'zenithjoy',loader_sha256:'a'.repeat(64)}));
        if(version==='1')put(business,path,'old business skill');
        else git(business,'rm','-q',path);
        revisions.push({business:commit(business),central:skillRevision,content});
      }
      put(business,path,'---\nname: evil\nversion: 9\n---\nworkspace poison\n');
      const readFile=({repo,path,revision},{allowMissing=false}={})=>{
        git(dirs[repo],'rev-parse','--verify',revision+'^{commit}');
        if(allowMissing&&!git(dirs[repo],'ls-tree',revision,'--',path))return null;
        return execFileSync('git',['show',`${revision}:${path}`],{cwd:dirs[repo],stdio:['ignore','pipe','pipe']});
      };
      const activity=revision=>({implementation_bindings:[{kind:'skill',repo:'perfectuser21/zenithjoy-workspace',revision,path}]});
      const historical=await validateFixedImplementationBindings(activity(historicalRevision),{repo,commit:historicalRevision},{readFile});
      expect(historical[0].digest).toBe(`sha256:${createHash('sha256').update(historicalContent).digest('hex')}`);
      expect(historical[0]).not.toHaveProperty('resolved_source');
      for(const row of revisions){
        const result=await validateFixedImplementationBindings(activity(row.business),{repo:'perfectuser21/zenithjoy-workspace',commit:row.business},{readFile});
        expect(result[0]).toMatchObject({status:'verified',digest:`sha256:${createHash('sha256').update(row.content).digest('hex')}`,resolved_source:{repo:'perfectuser21/zenithjoy-skills',revision:row.central, path:source}});
        expect(result[0].path).toBe(path);expect(result[0].revision).toBe(row.business);
      }
      const repeated=activity(revisions[1].business);repeated.implementation_bindings.push({...repeated.implementation_bindings[0]});
      const duplicates=await validateFixedImplementationBindings(repeated,{repo:'perfectuser21/zenithjoy-workspace',commit:revisions[1].business},{readFile});
      expect(duplicates).toHaveLength(2);
      expect(duplicates[0].resolved_source).toEqual(duplicates[1].resolved_source);
      const goodLock=JSON.parse(execFileSync('git',['show',`${revisions[1].business}:.skills-source.json`],{cwd:business,encoding:'utf8'}));
      for(const bad of [{...goodLock,revision:'main'},{...goodLock,repository:'other/repo'},{...goodLock,profile:'missing'}]){
        put(business,'.skills-source.json',JSON.stringify(bad));
        const revision=commit(business);
        await expect(validateFixedImplementationBindings(activity(revision),{repo:'perfectuser21/zenithjoy-workspace',commit:revision},{readFile})).rejects.toThrow();
      }
      git(business,'rm','-q','.skills-source.json');git(business,'rm','-q',path);
      const noLock=commit(business);
      await expect(validateFixedImplementationBindings(activity(noLock),{repo:'perfectuser21/zenithjoy-workspace',commit:noLock},{readFile})).rejects.toMatchObject({code:'definition_source_invalid'});
      const codePath='src/plain.js';put(business,codePath,'fixed code\n');
      const codeRevision=commit(business);put(business,codePath,'poison worktree\n');
      const code=await validateFixedImplementationBindings({implementation_bindings:[{kind:'code',repo:'perfectuser21/zenithjoy-workspace',revision:codeRevision,path:codePath}]},{repo:'perfectuser21/zenithjoy-workspace',commit:codeRevision},{readFile});
      expect(code[0].digest).toBe(`sha256:${createHash('sha256').update('fixed code\n').digest('hex')}`);
      expect(code[0]).not.toHaveProperty('resolved_source');
      for(const invalidPath of ['', '../SKILL.md', 'a'.repeat(1001)+'/SKILL.md']){
        const bad=activity(codeRevision);bad.implementation_bindings[0].path=invalidPath;
        const readInvalid=vi.fn();
        await expect(validateFixedImplementationBindings(bad,{repo:'perfectuser21/zenithjoy-workspace',commit:codeRevision},{readFile:readInvalid})).rejects.toThrow();
        expect(readInvalid).not.toHaveBeenCalled();
      }
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});


describe('历史来源与派生身份的回归边界',()=>{
  const path='.claude/skills/demo/SKILL.md',central='perfectuser21/zenithjoy-skills',centralRevision='b'.repeat(40);
  const sourcePath='business-skills/zenithjoy/demo/SKILL.md';
  const content='---\nname: demo\nversion: 2\n---\ncentral\n';
  const local='---\nname: demo\nversion: 1\n---\nhistorical\n';
  const digest=value=>createHash('sha256').update(value).digest('hex');
  const location={kind:'skill',repo,revision,path};
  function files(){return new Map([
    [`${repo}:.skills-source.json`,JSON.stringify({version:1,repository:central,revision:centralRevision,profile:'zenithjoy',loader_sha256:'c'.repeat(64)})],
    [`${repo}:${path}`,local],
    [`${central}:distribution/catalog.json`,JSON.stringify({version:1,profiles:{zenithjoy:{files:[{path,source:sourcePath,sha256:digest(content)}]}}})],
    [`${central}:${sourcePath}`,content],
  ]);}
  it.each(['forbidden','timeout','malformed-lock'])('锁读取异常不得降级到业务同名Skill：%s',async reason=>{
    const reads=[];
    const readFile=async source=>{
      reads.push(source.path);
      if(source.path==='.skills-source.json'){
        if(reason==='malformed-lock')return '{bad json';
        throw Object.assign(Error(reason),{status:reason==='forbidden'?403:503,code:reason});
      }
      return local;
    };
    await expect(readFixedImplementationBinding(location,{readFile})).rejects.toThrow();
    expect(reads).toEqual(['.skills-source.json']);
  });
  it('远端固定commit/tree证明锁不存在时读取历史Skill，403和超时仍拒绝',async()=>{
    const bytes=Buffer.from(local),blob=createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex');
    const tree='d'.repeat(40),calls=[];
    const fetchFn=async url=>{calls.push(url);return {ok:true,json:async()=>url.includes('/commits/')?{sha:revision,tree:{sha:tree}}:url.includes('/trees/')?{sha:tree,truncated:false,tree:[{path,type:'blob',mode:'100644',sha:blob}]}:{sha:blob,size:bytes.length,encoding:'base64',content:bytes.toString('base64')}};};
    expect((await readFixedImplementationBinding(location,{fetchFn,resolveToken:async()=> 'fixture'})).content).toBe(local);
    expect(calls.every(url=>url.includes('/'+repo+'/'))).toBe(true);
    await expect(readFixedImplementationBinding(location,{fetchFn:async()=>({ok:false,status:403}),resolveToken:async()=> 'fixture'})).rejects.toThrow();
    await expect(readFixedImplementationBinding(location,{fetchFn:async()=>{throw Error('timeout');},resolveToken:async()=> 'fixture'})).rejects.toThrow('timeout');
  });
  it('同位置Code与Skill派生来源隔离，调用方不能伪造派生来源',async()=>{
    const table=files(),readFile=source=>table.get(`${source.repo}:${source.path}`);
    const contract={implementation_bindings:[{...location,kind:'code'},location]};
    const result=await validateFixedImplementationBindings(contract,{repo,commit:revision},{readFile});
    expect(result[0].digest).toBe('sha256:'+digest(local));expect(result[0]).not.toHaveProperty('resolved_source');
    expect(result[1].resolved_source).toEqual({repo:central,path:sourcePath,revision:centralRevision});
    for(const kind of ['code','skill'])await expect(validateFixedImplementationBindings({implementation_bindings:[{...location,kind,resolved_source:{repo:central,path:sourcePath,revision:'e'.repeat(40)}}]},{repo,commit:revision},{readFile})).rejects.toThrow();
  });
});
