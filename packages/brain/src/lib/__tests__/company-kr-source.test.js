import { it,expect,vi } from 'vitest';
import { loadCompanyKrSource } from '../company-kr-source.js';
it('固定SHA读取且内容一致才可留来源；失败和不匹配不盖章',async()=>{
  const revision='a'.repeat(40),spec={name:'实际配置'},readSource=vi.fn(async()=>JSON.stringify(spec));
  expect(await loadCompanyKrSource(spec,{revision,readSource})).toMatchObject({commit:revision,path:'packages/brain/config/company-kr-workflow.json'});
  expect(readSource).toHaveBeenCalledWith(revision);
  await expect(loadCompanyKrSource(spec,{revision:'main',readSource})).rejects.toThrow('固定commit');
  await expect(loadCompanyKrSource(spec,{revision,readSource:async()=>'{"name":"other"}'})).rejects.toThrow('不一致');
  await expect(loadCompanyKrSource(spec,{revision,readSource:async()=>{throw Error('源不可读');}})).rejects.toThrow('源不可读');
});
