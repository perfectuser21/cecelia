import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {fixtureGit} from './fixed-existing-ops-git-fixture.js';
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
