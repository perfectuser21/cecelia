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

describe('两业务仓中央Skill profile必须按仓库显式匹配',()=>{
 const central='perfectuser21/zenithjoy-skills',sha='b'.repeat(40),path='packages/workflows/skills/demo/SKILL.md';
 const content='---\nname: demo\nversion: 1\n---\nfixed central Skill\n';
 const profiles={cecelia:'perfectuser21/cecelia',zenithjoy:'perfectuser21/zenithjoy-workspace'};
 const source=profile=>`business-skills/${profile}/demo/SKILL.md`;
 function table(profile,lockProfile=profile){
  const files=new Map([[`${profiles[profile]}:.skills-source.json`,JSON.stringify({version:1,repository:central,revision:sha,profile:lockProfile,loader_sha256:'c'.repeat(64)})]]);
  files.set(`${central}:distribution/catalog.json`,JSON.stringify({version:1,profiles:Object.fromEntries(Object.keys(profiles).map(p=>[p,{files:[{path,source:source(p),sha256:createHash('sha256').update(content).digest('hex')}]}]))}));
  for(const p of Object.keys(profiles))files.set(`${central}:${source(p)}`,content);
  return files;
 }
 it.each(Object.keys(profiles))('%s按正确锁读取中央正文，业务原路径已不存在',async profile=>{
  const files=table(profile),readFile=vi.fn(s=>files.get(`${s.repo}:${s.path}`));
  const binding={kind:'skill',repo:profiles[profile],path,revision};
  const [result]=await validateFixedImplementationBindings({implementation_bindings:[binding]},{repo:profiles[profile],commit:revision},{readFile});
  expect(result.resolved_source).toEqual({repo:central,path:source(profile),revision:sha});
  expect(result.digest).toBe('sha256:'+createHash('sha256').update(content).digest('hex'));
  expect(readFile.mock.calls.some(([s])=>s.repo===profiles[profile]&&s.path===path)).toBe(false);
 });
 it.each(Object.keys(profiles))('%s不能使用另一仓profile，即使中央目录包含同名路径',async profile=>{
  const other=profile==='cecelia'?'zenithjoy':'cecelia',files=table(profile,other),reads=[];
  await expect(readFixedImplementationBinding({kind:'skill',repo:profiles[profile],path,revision},{readFile:s=>{reads.push(s);return files.get(`${s.repo}:${s.path}`);}})).rejects.toMatchObject({code:'definition_source_invalid'});
  expect(reads).toHaveLength(1);expect(reads[0].path).toBe('.skills-source.json');
 });
 it('Cecelia历史固定树证实无锁时仍读原Skill；不可读锁不得冒充无锁',async()=>{
  const binding={kind:'skill',repo:profiles.cecelia,path,revision},reads=[];
  const readFile=(s,options)=>{reads.push(s.path);if(s.path==='.skills-source.json'){expect(options).toEqual({allowMissing:true});return null;}return content;};
  expect((await readFixedImplementationBinding(binding,{readFile})).content).toBe(content);
  expect(reads).toEqual(['.skills-source.json',path]);
  const forbidden=vi.fn(()=>{throw Object.assign(Error('forbidden'),{status:403});});
  await expect(readFixedImplementationBinding(binding,{readFile:forbidden})).rejects.toThrow();expect(forbidden).toHaveBeenCalledOnce();
 });
});

import * as fixedSources from './fixed-git-source.js';
describe('请求内已验证Git对象复用',()=>{
 function fixture(){
  const tree='d'.repeat(40),blobs=new Map(),entries=['one','two'].map(path=>{const b=Buffer.from('fixed '+path),sha=createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`),b])).digest('hex');blobs.set(sha,{sha,size:b.length,encoding:'base64',content:b.toString('base64')});return {path,sha,type:'blob',mode:'100644',size:b.length};});
  const documents={commit:{sha:revision,tree:{sha:tree}},tree:{sha:tree,tree:entries}},fetchFn=vi.fn(async url=>({ok:true,json:async()=>url.includes('/commits/')?documents.commit:url.includes('/trees/')?documents.tree:blobs.get(url.split('/').at(-1))}));
  return {documents,blobs,fetchFn,options:{fetchFn,resolveToken:async()=> 'fixture',gitSession:fixedSources.createFixedGitReadSession?.()??{}}};
 }
 const read=(f,path='one',extra={})=>readFixedGitFile({repo,revision,path},{...f.options,...extra});
 it('同commit不同blob只验证一次commit/tree，blob仍逐文件取证',async()=>{
  const f=fixture();expect(await read(f)).toBe('fixed one');expect(await read(f,'two')).toBe('fixed two');
  for(const kind of ['commits','trees'])expect(f.fetchFn.mock.calls.filter(([u])=>u.includes('/'+kind+'/'))).toHaveLength(1);
  expect(f.fetchFn.mock.calls.filter(([u])=>u.includes('/blobs/'))).toHaveLength(2);
 });
 it('tree复制而不冻结调用方对象，返回正文也不能污染会话',async()=>{
  const f=fixture();await read(f);expect(Object.isFrozen(f.documents.tree)).toBe(false);f.documents.tree.tree[1].mode='120000';f.documents.commit.tree.sha='e'.repeat(40);
  expect(await read(f,'two')).toBe('fixed two');
  const b={kind:'code',repo,revision,path:'one'},options={...f.options,cache:new Map()},first=await readFixedImplementationBinding(b,options);first.bytes.fill(0);expect((await readFixedImplementationBinding(b,options)).content).toBe('fixed one');
 });
 it('失败对象不缓存，已验证commit保留而坏tree/blob重试',async()=>{
  const f=fixture();f.documents.commit.sha='0'.repeat(40);await expect(read(f)).rejects.toThrow();f.documents.commit.sha=revision;f.documents.tree.truncated=true;await expect(read(f)).rejects.toThrow();f.documents.tree.truncated=false;await read(f);
  for(const kind of ['commits','trees'])expect(f.fetchFn.mock.calls.filter(([u])=>u.includes('/'+kind+'/'))).toHaveLength(2);
  const blob=[...f.blobs.values()][1],content=blob.content;blob.content=Buffer.from('bad').toString('base64');await expect(read(f,'two')).rejects.toThrow();blob.content=content;expect(await read(f,'two')).toBe('fixed two');
 });
 it('cache命中、慢token及blob后仍遵守同一deadline/abort',async()=>{
  const f=fixture();await read(f);const count=f.fetchFn.mock.calls.length,controller=new AbortController();controller.abort();
  await expect(read(f,'two',{signal:controller.signal})).rejects.toMatchObject({code:'readiness_deadline_exceeded'});await expect(read(f,'two',{deadline:Date.now()-1})).rejects.toMatchObject({code:'readiness_deadline_exceeded'});expect(f.fetchFn).toHaveBeenCalledTimes(count);
  const live=new AbortController();await expect(read(f,'two',{resolveToken:async()=>{live.abort();return 'fixture';},signal:live.signal})).rejects.toMatchObject({code:'readiness_deadline_exceeded'});expect(f.fetchFn).toHaveBeenCalledTimes(count);
 });
 it('拒绝伪造metadata会话，repo/revision及新请求独立',async()=>{
  const f=fixture();await expect(read(f,'one',{gitSession:new Map()})).rejects.toThrow();expect(f.fetchFn).not.toHaveBeenCalled();await read(f);
  await expect(readFixedGitFile({repo:'perfectuser21/cecelia',revision:'e'.repeat(40),path:'one'},f.options)).rejects.toThrow();expect(f.fetchFn.mock.calls.filter(([u])=>u.includes('/commits/'))).toHaveLength(2);
  await read(f,'one',{gitSession:fixedSources.createFixedGitReadSession?.()??{}});expect(f.fetchFn.mock.calls.filter(([u])=>u.includes('/commits/'))).toHaveLength(3);
 });
});

it('metadata保留最多64对象，满后仍读取并验证而不memo',async()=>{
 const bytes=Buffer.from('body'),blob=createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex'),tree='f'.repeat(40),counts={commits:0,trees:0,blobs:0};
 const options={gitSession:fixedSources.createFixedGitReadSession(),resolveToken:async()=> 'fixture',fetchFn:async url=>{const match=url.match(/git\/(commits|trees|blobs)\/([a-f0-9]{40})/),kind=match[1];counts[kind]++;return {ok:true,json:async()=>kind==='commits'?{sha:match[2],tree:{sha:tree}}:kind==='trees'?{sha:tree,tree:[{path:'file',sha:blob,type:'blob',mode:'100644'}]}:{sha:blob,size:bytes.length,encoding:'base64',content:bytes.toString('base64')}};}};
 const read=revision=>readFixedGitFile({repo,revision,path:'file'},options),versions=Array.from({length:33},(_,i)=>(i+1).toString(16).padStart(40,'0'));
 for(const sha of versions)expect(await read(sha)).toBe('body');
 await read(versions[32]);expect(counts.commits).toBe(34);expect(counts.trees).toBe(34);
 await read(versions[0]);expect(counts.commits).toBe(34);expect(counts.trees).toBe(34);
 await readFixedGitFile({repo:'perfectuser21/cecelia',revision:versions[0],path:'file'},options);expect(counts.commits).toBe(35);expect(counts.trees).toBe(35);
});
it('原响应16MiB流上限保持且超限数据不进入metadata缓存',async()=>{
 const cancel=vi.fn(async()=>{}),options={gitSession:fixedSources.createFixedGitReadSession(),resolveToken:async()=> 'fixture',fetchFn:async()=>({ok:true,body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(16*1024*1024+1)}),cancel})}})};
 await expect(readFixedGitFile({repo,revision,path:'file'},options)).rejects.toThrow(/上限/);expect(cancel).toHaveBeenCalledOnce();
});
it('tree内null坏项仍拒绝，不因metadata规范化变成静默忽略',async()=>{
 const tree='e'.repeat(40),calls=[],options={gitSession:fixedSources.createFixedGitReadSession(),resolveToken:async()=> 'fixture',fetchFn:async url=>{calls.push(url);return {ok:true,json:async()=>url.includes('/commits/')?{sha:revision,tree:{sha:tree}}:{sha:tree,tree:[null]}};}};
 for(let i=0;i<2;i++)await expect(readFixedGitFile({repo,revision,path:'file'},options)).rejects.toThrow();
 expect(calls.filter(u=>u.includes('/commits/'))).toHaveLength(1);expect(calls.filter(u=>u.includes('/trees/'))).toHaveLength(2);expect(calls.some(u=>u.includes('/blobs/'))).toBe(false);
});
