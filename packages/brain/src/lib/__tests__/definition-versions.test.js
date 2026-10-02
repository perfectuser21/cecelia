import { it,expect,vi } from 'vitest';
import { snapshotDefinitions } from '../definition-versions.js';
it('浮动来源与缺少绑定核验的活动不得生成快照',async()=>{
  const query=vi.fn(async()=>({rows:[{id:'a',contract_source:`https://github.com/org/repo/blob/${'a'.repeat(40)}/contract.yaml`}]}));
  await expect(snapshotDefinitions({query},{workflowIds:['w'],source:{commit:'main'}})).rejects.toThrow('固定commit');expect(query).not.toHaveBeenCalled();
  await expect(snapshotDefinitions({query},{workflowIds:['w'],source:{commit:'a'.repeat(40)}})).rejects.toThrow('绑定核验');
  expect(query.mock.calls.some(([sql])=>sql.includes('INSERT'))).toBe(false);
});
