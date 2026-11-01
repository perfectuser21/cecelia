import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {fixtureGit,readFixedExistingOpsGitFixture} from './fixed-existing-ops-git-fixture.js';
import {readNativeConsumerRuntime} from '../../native-consumer-runtime.js';

const root=fileURLToPath(new URL('../../../../../../',import.meta.url));
// 只读来源机制夹具，不授予当前候选或生产来源资格。完整HEAD保留已审CI输入的原子一致性。
export function isolatedExistingOpsGitFixture({revision=fixtureGit('rev-parse','HEAD').trim(),changes={},requireRuntime=true}={}){
 assert.match(revision,/^[a-f0-9]{40}$/);
 const dir=mkdtempSync(join(tmpdir(),'ci-deep-existing-ops-'));
 const close=()=>{
  for(let attempt=0;;attempt++){
   try{return rmSync(dir,{recursive:true,force:true});}
   catch(error){
    if(error.code!=='ENOTEMPTY'||attempt===3)throw error;
    // 仅本人目录的短暂竞争：最多三次重试，累计退避120ms，其他错误原样抛出。
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20*(attempt+1));
   }
  }
 };
 const git=(...args)=>execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','core.autocrlf=false','-c','commit.gpgSign=false',
  '-c','maintenance.auto=false','-c','gc.auto=0','-c','gc.autoDetach=false',...args],{
  cwd:dir,encoding:'utf8',maxBuffer:32*1024*1024,
 });
 try{
  git('clone','--quiet','--shared','--no-checkout',root,'.');git('checkout','--quiet','--detach',revision);
  for(const [path,bytes] of Object.entries(changes)){
   assert.ok(path&&!path.includes('\\')&&!path.split('/').some(p=>!p||p==='.'||p==='..'));
   assert.notDeepEqual(readFileSync(join(dir,path)),Buffer.from(bytes),'negative fixture must really change Git bytes');
   writeFileSync(join(dir,path),bytes);
  }
  if(Object.keys(changes).length){
   git('add','--',...Object.keys(changes));
   git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','test: explicitly unproven selector fixture');
   assert.deepEqual(git('diff','--name-only',revision,'HEAD').trim().split('\n').sort(),Object.keys(changes).sort());
  }
  const selected=git('rev-parse','HEAD').trim(),tree=git('rev-parse','HEAD^{tree}').trim();
  const entries=git('ls-tree','-rz','--full-tree',selected).split('\0').filter(Boolean).map(line=>{
   const [meta,path]=line.split('\t'),[mode,type,sha]=meta.split(' ');return {path,mode,type,sha};
  });
  const byPath=new Map(entries.map(e=>[e.path,e])),cache=new Map();
  const read=path=>{
   if(!cache.has(path)){
    const entry=byPath.get(path);assert.ok(entry?.type==='blob'&&['100644','100755'].includes(entry.mode),'fixture requires regular Git blob');
    const bytes=readFileSync(join(dir,path));
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),entry.sha,'checkout bytes must match the selected Git tree');
    cache.set(path,bytes.toString('utf8'));
   }
   return cache.get(path);
  };
  if(requireRuntime){
   const runtime=readNativeConsumerRuntime();assert.equal(runtime.files.length,16);
   for(const file of runtime.files)assert.equal(createHash('sha256').update(read(file.path)).digest('hex'),file.sha256,`fixture HEAD differs from loaded collector: ${file.path}`);
  }
  return {dir,revision:selected,tree,entries,paths:entries.map(e=>e.path),read,git,close};
 }catch(error){close();throw error;}
}

// 历史source与当前controller共享真实Git隔离；原HEAD夹具API保持不变。
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const controllerPaths=[
 'packages/brain/src/lib/existing-ops-registration.js',
 'packages/brain/src/lib/native-consumer-source-selection.js',
 'packages/brain/src/lib/implementation-ci-snapshot.js',
 'packages/brain/src/routes/implementation-ci.js',
 'packages/brain/src/lib/native-consumer-runtime.js',
 'packages/brain/src/lib/consumer-source-set.js',
 'packages/brain/src/lib/implementation-ci-pilot-manifest.js',
];
export async function historicalConsumerRuntimeFixture(){
 const historical=readFixedExistingOpsGitFixture(),dir=mkdtempSync(join(tmpdir(),'historical-consumer-runtime-'));
 const close=()=>rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:20});
 const git=(...args)=>execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','core.autocrlf=false',
  '-c','commit.gpgSign=false','-c','maintenance.auto=false','-c','gc.auto=0',...args],{cwd:dir,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
 try{
  git('clone','--quiet','--shared','--no-checkout',root,'.');git('checkout','--quiet','--detach',historical.revision);
  const controllers=controllerPaths.map(path=>{
   const bytes=readFileSync(join(root,path));
   const committed=execFileSync('git',['--no-replace-objects','show',`HEAD:${path}`],{cwd:root});
   assert.deepEqual(bytes,committed,'controller must be the actual current committed implementation');
   writeFileSync(join(dir,path),bytes);return {path,current_sha256:sha(bytes)};
  });
  git('add','--',...controllerPaths);
  if(git('diff','--cached','--name-only'))git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','test: current controllers with immutable historical collectors');
  const revision=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
  const changed=git('diff','--name-only',historical.revision,revision).split('\n').filter(Boolean);
  assert.ok(changed.every(path=>controllerPaths.includes(path)),'only current non-collector controllers may differ');
  for(const path of ['node_modules','packages/brain/node_modules'])symlinkSync(join(root,path),join(dir,path),'dir');
  const entries=git('ls-tree','-rz','--full-tree',revision).split('\0').filter(Boolean).map(line=>{
   const [metadata,path]=line.split('\t'),[mode,type,sha]=metadata.split(' ');return {path,mode,type,sha};
  });
  const byPath=new Map(entries.map(e=>[e.path,e])),cache=new Map();
  const read=path=>{
   if(!cache.has(path)){
    const entry=byPath.get(path);assert.ok(entry?.type==='blob'&&['100644','100755'].includes(entry.mode),'regular historical Git blob required');
    const bytes=readFileSync(join(dir,path));
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),entry.sha,'checkout must match actual Git tree');
    cache.set(path,bytes.toString());
   }return cache.get(path);
  };
  const load=path=>import(/* @vite-ignore */ pathToFileURL(join(dir,path)).href);
  const runtimeModule=await load('packages/brain/src/lib/native-consumer-runtime.js'),runtime=runtimeModule.readNativeConsumerRuntime();
  assert.equal(runtime.files.length,16);
  for(const file of runtime.files){
   assert.ok(!controllerPaths.includes(file.path),'controllers cannot replace a sealed collector');
   assert.equal(read(file.path),historical.read(file.path),'all sixteen collector bytes must remain historical');
   assert.equal(sha(read(file.path)),file.sha256);
  }
  await runtimeModule.assertNativeConsumerRuntime(async path=>read(path),{tree:entries});
  for(const controller of controllers)assert.equal(sha(read(controller.path)),controller.current_sha256);
  const modules={
   registration:await load('packages/brain/src/lib/existing-ops-registration.js'),
   selection:await load('packages/brain/src/lib/native-consumer-source-selection.js'),
   snapshot:await load('packages/brain/src/lib/implementation-ci-snapshot.js'),
   router:await load('packages/brain/src/routes/implementation-ci.js'),
  };
  return {dir,revision,tree,entries,paths:entries.map(e=>e.path),read,git,close,runtime,controllers,modules,historicalRevision:historical.revision};
 }catch(error){close();throw error;}
}
