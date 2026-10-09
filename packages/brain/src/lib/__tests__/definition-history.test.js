import { it,expect,vi } from 'vitest';
import { readDefinitionHistory } from '../definition-history.js';
it('对象不存在与无历史版本区分；SQL同时约束对象和版本',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{versions:[]}]}).mockResolvedValueOnce({rows:[{versions:[{id:'v',payload:{name:'历史'}}]}]});
  expect(await readDefinitionHistory({query},{kind:'workflow',id:'missing'})).toBeUndefined();
  expect(await readDefinitionHistory({query},{kind:'activity',id:'a'})).toEqual([]);
  expect(await readDefinitionHistory({query},{kind:'activity',id:'a',versionId:'v'})).toEqual({id:'v',payload:{name:'历史'}});
  expect(query.mock.calls[2][1]).toEqual(['a','v']);expect(query.mock.calls[2][0]).toContain('v.activity_id=o.id');expect(query.mock.calls[2][0]).toContain('v.id=$2');
  await expect(readDefinitionHistory({query},{kind:'unknown',id:'a'})).rejects.toThrow('定义类型');
});
