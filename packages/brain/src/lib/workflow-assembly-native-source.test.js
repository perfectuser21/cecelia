import {it,expect} from 'vitest';
import {readFileSync,mkdtempSync,cpSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareNativeSource,assertNativeSource,NATIVE_REPO,NATIVE_SOURCE_PATHS} from './workflow-assembly-native-source.js';
import {readFixedGitFile} from '../workflow-authoring/fixed-git-source.js';
it('未固定commit或实际代码字节不同，不能形成登记凭证',async()=>{
  await expect(prepareNativeSource({revision:'main'})).rejects.toThrow('revision');
  await expect(prepareNativeSource({revision:'a'.repeat(40),readFile:async()=>'{"fake":true}'})).rejects.toThrow('runtime_mismatch');
});
it('固定Git字节对应本进程才可信；序列化副本不保留授权',async()=>{
  const source=await prepareNativeSource({revision:'a'.repeat(40),readFile:async(_r,path)=>readFileSync(new URL('../../../../'+path,import.meta.url),'utf8')});
  expect(()=>assertNativeSource(source)).not.toThrow();
  expect(source.bindings.map(b=>b.path)).toContain('packages/brain/src/orchestrator/activity-runtime.js');
  expect(source.bindings.map(b=>b.path)).toContain('packages/brain/src/lib/workflow-assembly-native-supervision.js');
  expect(()=>assertNativeSource(JSON.parse(JSON.stringify(source)))).toThrow('unprepared');
});
it('冷启动同一固定版本的 19 个文件只请求一次 commit 和 tree',async()=>{
  const revision='a'.repeat(40),treeSha='b'.repeat(40);
  const blobs=new Map(),requests=[];
  const entries=NATIVE_SOURCE_PATHS.map(path=>{
    const bytes=readFileSync(new URL('../../../../'+path,import.meta.url));
    const sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    blobs.set(sha,{sha,size:bytes.length,encoding:'base64',content:bytes.toString('base64')});
    return {path,sha,type:'blob',mode:'100644',size:bytes.length};
  });
  const fetchFn=async url=>{
    const endpoint=new URL(url),[kind,sha]=endpoint.pathname.split('/').slice(-2);
    expect(endpoint.origin).toBe('https://api.github.com');
    expect(endpoint.pathname).toContain(`/repos/${NATIVE_REPO}/git/`);
    requests.push(kind);
    let body;
    if(kind==='commits' && sha===revision)body={sha,tree:{sha:treeSha}};
    if(kind==='trees' && sha===treeSha && endpoint.searchParams.get('recursive')==='1')body={sha,tree:entries,truncated:false};
    if(kind==='blobs')body=blobs.get(sha);
    expect(body).toBeDefined();
    return {ok:true,json:async()=>body};
  };
  const readFile=(revision,path,options)=>readFixedGitFile({repo:NATIVE_REPO,revision,path},{
    ...options,resolveToken:async()=>'test-github-token',fetchFn,
  });
  for(let closure=0;closure<2;closure++){
    requests.length=0;
    const prepared=await prepareNativeSource({revision,readFile});
    expect(()=>assertNativeSource(prepared)).not.toThrow();
    expect(prepared.bindings.map(binding=>binding.path)).toEqual(NATIVE_SOURCE_PATHS);
    expect(requests).toHaveLength(21);
    expect(requests.filter(kind=>kind==='commits')).toHaveLength(1);
    expect(requests.filter(kind=>kind==='trees')).toHaveLength(1);
    expect(requests.filter(kind=>kind==='blobs')).toHaveLength(19);
  }
});
it('真实Docker平铺Brain布局冷加载，不依赖容器里不存在的monorepo路径或.git',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
  expect(manifest.dependencies['js-yaml']).toBeTruthy();
  const directory=mkdtempSync(join(tmpdir(),'native-flat-runtime-'));
  try{
    cpSync(new URL('../',import.meta.url),join(directory,'src'),{recursive:true});
    cpSync(new URL('../../config/',import.meta.url),join(directory,'config'),{recursive:true});
    // Docker installs production packages; this isolated flat fixture must carry their real dependency closure too.
    const pending=[['js-yaml',createRequire(import.meta.url)]],installed=new Set();
    while(pending.length){
      const [name,require]=pending.shift();if(installed.has(name))continue;installed.add(name);
      const packagePath=require.resolve(name+'/package.json'),dependency=JSON.parse(readFileSync(packagePath,'utf8'));
      mkdirSync(join(directory,'node_modules'),{recursive:true});
      cpSync(dirname(packagePath),join(directory,'node_modules',name),{recursive:true});
      for(const child of Object.keys(dependency.dependencies??{}))pending.push([child,createRequire(packagePath)]);
    }
    const code=`import {readFileSync,realpathSync} from 'node:fs';import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';
      const root=${JSON.stringify(directory)},m=await import(pathToFileURL(root+'/src/lib/workflow-assembly-native-source.js'));
      const source=await m.prepareNativeSource({revision:'a'.repeat(40),readFile:async(_rev,path)=>readFileSync(root+'/'+path.replace('packages/brain/',''),'utf8')});
      const require=createRequire(pathToFileURL(root+'/package.json')),yaml=require('js-yaml');
      const runtimeDependencies=['js-yaml','argparse'].every(name=>realpathSync(require.resolve(name+'/package.json')).startsWith(realpathSync(root)+'/node_modules/'));
      console.log(JSON.stringify({bindings:source.bindings.length,revision:m.deployedNativeRevision(),yaml:yaml.load('fixed: true'),runtimeDependencies}));`;
    const out=execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:directory,encoding:'utf8',env:{...process.env,GIT_SHA:'a'.repeat(40)},stdio:['ignore','pipe','pipe']});
    expect(JSON.parse(out)).toEqual({bindings:NATIVE_SOURCE_PATHS.length,revision:'a'.repeat(40),yaml:{fixed:true},runtimeDependencies:true});
  }finally{rmSync(directory,{recursive:true,force:true});}
});
