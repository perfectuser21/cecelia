import {it,expect} from 'vitest';
import {buildExistingOpsSources} from '../existing-ops-source.js';

it('来源输入在解析或读源前拒绝非工厂scope、跨仓库、浮动SHA和非法路径',async()=>{
 const path='packages/brain/src/lib/existing-ops-source.js';let reads=0;
 const input={scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision:'f'.repeat(40),paths:[path],readSource:async()=>{reads++;throw Error('unexpected read');}};
 for(const override of [{scope:'cecelia'},{scope:'cecelia-kr'},{repo:'foreign/repo'},{revision:'main'},
  {paths:['packages/brain/migrations/*.sql']},{paths:['../outside.js']},{paths:[path,path]}])
  await expect(buildExistingOpsSources({...input,...override})).rejects.toThrow('OPS_SOURCE_INPUT_INVALID');
 expect(reads).toBe(0);
});
