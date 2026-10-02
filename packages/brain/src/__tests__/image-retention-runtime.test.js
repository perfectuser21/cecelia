import { it, expect } from 'vitest';
import { mkdtemp, mkdir, copyFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
