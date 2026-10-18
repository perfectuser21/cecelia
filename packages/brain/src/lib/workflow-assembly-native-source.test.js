import {it,expect} from 'vitest';
import {readFileSync,mkdtempSync,cpSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
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
    expect(JSON.parse(out)).toEqual({bindings:11,revision:'a'.repeat(40),yaml:{fixed:true},runtimeDependencies:true});
  }finally{rmSync(directory,{recursive:true,force:true});}
});
