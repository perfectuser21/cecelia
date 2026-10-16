import {expect,it} from 'vitest';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readNativeConsumerRuntime,assertNativeConsumerRuntime} from './native-consumer-runtime.js';
const read=path=>readFileSync(new URL(basename(path),import.meta.url),'utf8');
const stagePaths=['source','envelopes'].map(n=>`packages/brain/src/lib/existing-ops-stage-${n}.js`);
const provenancePaths=['envelope','core-envelope','entry-envelopes','local-envelopes']
 .map(name=>`packages/brain/src/lib/existing-ops-provenance-${name}.js`).concat(stagePaths).sort();
it('实际身份包含全部6个新增收集器依赖，逐文件记录加载字节',()=>{
 const runtime=readNativeConsumerRuntime();expect(runtime.files).toHaveLength(11);
 for(const path of provenancePaths)expect(runtime.files).toContainEqual({path,sha256:createHash('sha256').update(read(path)).digest('hex')});
});
it.each(provenancePaths)('%s 缺失、错误字节或非普通固定 blob 都拒绝',async path=>{
 const tree={tree:readNativeConsumerRuntime().files.map(file=>{const text=read(file.path);return {path:file.path,type:'blob',mode:'100644',sha:createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex')};})};
 await expect(assertNativeConsumerRuntime(p=>{if(p===path)throw Error('missing');return read(p);})).rejects.toMatchObject({code:'IMPLEMENTATION_CI_SOURCE_RUNTIME_MISMATCH'});
 await expect(assertNativeConsumerRuntime(p=>read(p)+(p===path?'\nchanged':''))).rejects.toMatchObject({code:'IMPLEMENTATION_CI_SOURCE_RUNTIME_MISMATCH'});
 for(const change of [rows=>rows.filter(e=>e.path!==path),rows=>rows.map(e=>e.path===path?{...e,mode:'120000'}:e),rows=>rows.map(e=>e.path===path?{...e,sha:'0'.repeat(40)}:e)])
  await expect(assertNativeConsumerRuntime(read,{tree:change(tree.tree)})).rejects.toMatchObject({code:'IMPLEMENTATION_CI_SOURCE_RUNTIME_MISMATCH'});
});
it.each(provenancePaths)('%s 加载后改盘不改变进程身份，并拒绝新磁盘字节',path=>{
 const dir=mkdtempSync(join(tmpdir(),'native-provenance-runtime-'));
 try{
  const entry=join(dir,'runtime.mjs');copyFileSync(new URL('./native-consumer-runtime.js',import.meta.url),entry);
  for(const file of readNativeConsumerRuntime().files)writeFileSync(join(dir,basename(file.path)),read(file.path));
  const program=`import {writeFileSync,readFileSync} from 'node:fs';import {basename} from 'node:path';import {pathToFileURL} from 'node:url';
   const url=pathToFileURL(process.argv[1]),module=await import(url.href),before=module.readNativeConsumerRuntime();
   writeFileSync(new URL(basename(process.argv[2]),url),'changed after load');
   let error;try{await module.assertNativeConsumerRuntime(p=>readFileSync(new URL(basename(p),url),'utf8'));}catch(e){error=e.code;}
   console.log(JSON.stringify({before,after:module.readNativeConsumerRuntime(),error}));`;
  const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',program,entry,path],{encoding:'utf8'}));
  expect(result.after).toEqual(result.before);expect(result.error).toBe('IMPLEMENTATION_CI_SOURCE_RUNTIME_MISMATCH');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('返回对象可自由修改但不能污染进程后续固定指纹，原始源码正常匹配',async()=>{
 const before=readNativeConsumerRuntime(),copy=readNativeConsumerRuntime();
 copy.repo='fake';copy.files[0].path='/etc/passwd';copy.files[0].sha256='0'.repeat(64);copy.files.push({path:'fake'});
 expect(readNativeConsumerRuntime()).toEqual(before);
 await expect(assertNativeConsumerRuntime(read)).resolves.toBeUndefined();
});
it('加载后磁盘被替换也不冒充已加载collector，真实独立模块进程验证',()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-runtime-'));
 try{
  const entry=join(dir,'runtime.mjs');copyFileSync(new URL('./native-consumer-runtime.js',import.meta.url),entry);
  for(const file of readNativeConsumerRuntime().files)writeFileSync(join(dir,basename(file.path)),read(file.path));
  const program=`import {writeFileSync,readFileSync} from 'node:fs';import {basename} from 'node:path';import {pathToFileURL} from 'node:url';
   const module=await import(pathToFileURL(process.argv[1]).href),before=module.readNativeConsumerRuntime();
   writeFileSync(new URL(basename(before.files[0].path),pathToFileURL(process.argv[1])),'changed after load');
   let error;try{await module.assertNativeConsumerRuntime(path=>readFileSync(new URL(basename(path),pathToFileURL(process.argv[1])),'utf8'));}catch(e){error=e.code;}
   console.log(JSON.stringify({before,after:module.readNativeConsumerRuntime(),error}));`;
  const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',program,entry],{encoding:'utf8'}));
  expect(result.after).toEqual(result.before);expect(result.error).toBe('IMPLEMENTATION_CI_SOURCE_RUNTIME_MISMATCH');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('固定blob封印和普通文件模式必须同时正确，不能用symlink或伪sha冒充',async()=>{
 const tree={tree:readNativeConsumerRuntime().files.map(file=>{const text=read(file.path);return {path:file.path,type:'blob',mode:'100644',sha:createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex')};})};
 await expect(assertNativeConsumerRuntime(read,tree)).resolves.toBeUndefined();
 for(const mutate of [entry=>{entry.mode='120000';},entry=>{entry.sha='0'.repeat(40);}]){
  const bad=structuredClone(tree);mutate(bad.tree[0]);await expect(assertNativeConsumerRuntime(read,bad)).rejects.toMatchObject({code:'IMPLEMENTATION_CI_SOURCE_RUNTIME_MISMATCH',status:409});
 }
 await expect(assertNativeConsumerRuntime(path=>read(path)+'\n')).rejects.toMatchObject({code:'IMPLEMENTATION_CI_SOURCE_RUNTIME_MISMATCH'});
});
