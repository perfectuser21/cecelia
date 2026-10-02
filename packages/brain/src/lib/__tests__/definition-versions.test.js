import { it,expect,vi } from 'vitest';
import { snapshotDefinitions } from '../definition-versions.js';
it('浮动来源与缺少绑定核验的活动不得生成快照',async()=>{
  const query=vi.fn(async sql=>({rows:sql.includes('FROM workflows')?[{id:'w',key:'workflow'}]:[{id:'a',contract_source:`https://github.com/org/repo/blob/${'a'.repeat(40)}/contract.yaml`}]}));
  await expect(snapshotDefinitions({query},{workflowIds:['w'],source:{commit:'main'}})).rejects.toThrow('固定commit');expect(query).not.toHaveBeenCalled();
  await expect(snapshotDefinitions({query},{workflowIds:['w'],source:{repo:'org/repo',commit:'a'.repeat(40)},documentsByWorkflow:new Map([['w',{key:'workflow',activities:[]}]])})).rejects.toThrow('绑定核验');
  expect(query.mock.calls.some(([sql])=>sql.includes('INSERT'))).toBe(false);
});
it('缺少activities原文的部分文档不能冒充完整Workflow契约',async()=>{
  const query=vi.fn(async()=>({rows:[{id:'w',key:'workflow'}]}));
  await expect(snapshotDefinitions({query},{workflowIds:['w'],source:{repo:'org/repo',commit:'a'.repeat(40)},documentsByWorkflow:new Map([['w',{key:'workflow'}]])})).rejects.toThrow('完整契约');
});
