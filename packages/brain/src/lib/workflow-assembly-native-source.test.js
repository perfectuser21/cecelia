import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
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
