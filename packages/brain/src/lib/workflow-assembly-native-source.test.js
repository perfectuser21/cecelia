import {it,expect} from 'vitest';
import {readFileSync,mkdtempSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareNativeSource,assertNativeSource} from './workflow-assembly-native-source.js';
it('未固定commit或实际代码字节不同，不能形成登记凭证',async()=>{
  await expect(prepareNativeSource({revision:'main'})).rejects.toThrow('revision');
  await expect(prepareNativeSource({revision:'a'.repeat(40),readFile:async()=>'{"fake":true}'})).rejects.toThrow('runtime_mismatch');
});
it('固定Git字节对应本进程才可信；序列化副本不保留授权',async()=>{
  const source=await prepareNativeSource({revision:'a'.repeat(40),readFile:async(_r,path)=>readFileSync(new URL('../../../../'+path,import.meta.url),'utf8')});
  expect(()=>assertNativeSource(source)).not.toThrow();
  expect(()=>assertNativeSource(JSON.parse(JSON.stringify(source)))).toThrow('unprepared');
});
it('真实Docker平铺Brain布局冷加载，不依赖容器里不存在的monorepo路径或.git',()=>{
  const directory=mkdtempSync(join(tmpdir(),'native-flat-runtime-'));
  try{
    cpSync(new URL('../',import.meta.url),join(directory,'src'),{recursive:true});
    cpSync(new URL('../../config/',import.meta.url),join(directory,'config'),{recursive:true});
    const code=`import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
      const root=${JSON.stringify(directory)},m=await import(pathToFileURL(root+'/src/lib/workflow-assembly-native-source.js'));
      const source=await m.prepareNativeSource({revision:'a'.repeat(40),readFile:async(_rev,path)=>readFileSync(root+'/'+path.replace('packages/brain/',''),'utf8')});
      console.log(JSON.stringify({bindings:source.bindings.length,revision:m.deployedNativeRevision()}));`;
    const out=execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:directory,encoding:'utf8',env:{...process.env,GIT_SHA:'a'.repeat(40)},stdio:['ignore','pipe','pipe']});
    expect(JSON.parse(out)).toEqual({bindings:11,revision:'a'.repeat(40)});
  }finally{rmSync(directory,{recursive:true,force:true});}
});
