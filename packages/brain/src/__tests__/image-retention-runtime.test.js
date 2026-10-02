import { it, expect } from 'vitest';
import { mkdtemp, mkdir, copyFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadImageRetentionEngine } from '../image-retention-runtime.js';
it('仓库与镜像打包位置均加载固定runtime，无受信配置保持关闭',async()=>{
 expect(await loadImageRetentionEngine()).toBeNull();
 const root=await mkdtemp(join(tmpdir(),'image-runtime-package-'));
 try{
  await mkdir(join(root,'src'));await mkdir(join(root,'scripts'));
  await copyFile(new URL('../image-retention-runtime.js',import.meta.url),join(root,'src/runtime.mjs'));
  await cp(new URL('../../../../scripts/brain-image-retention/',import.meta.url),join(root,'scripts/brain-image-retention'),{recursive:true});
  const module=await import(/* @vite-ignore */ join(root,'src/runtime.mjs'));
  expect(await module.loadImageRetentionEngine()).toBeNull();
 }finally{await rm(root,{recursive:true,force:true});}
});
it('打包runtime缺失明确报错，不能冒充策略正常关闭',async()=>{
 const root=await mkdtemp(join(tmpdir(),'image-runtime-missing-'));
 try{
  await mkdir(join(root,'src'));
  await copyFile(new URL('../image-retention-runtime.js',import.meta.url),join(root,'src/runtime.mjs'));
  const script="import {pathToFileURL} from 'node:url';const module=await import(pathToFileURL(process.argv[1]));try{await module.loadImageRetentionEngine();process.stdout.write('unexpected_success');}catch(error){process.stdout.write(error.code??'unknown_error');}";
  const result=await promisify(execFile)(process.execPath,['--input-type=module','-e',script,join(root,'src/runtime.mjs')]);
  expect(result).toMatchObject({stdout:'ERR_MODULE_NOT_FOUND',stderr:''});
 }finally{await rm(root,{recursive:true,force:true});}
});
