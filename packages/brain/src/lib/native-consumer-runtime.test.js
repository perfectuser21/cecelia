import {expect,it} from 'vitest';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readNativeConsumerRuntime,assertNativeConsumerRuntime} from './native-consumer-runtime.js';
const read=path=>readFileSync(new URL(basename(path),import.meta.url),'utf8');
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
