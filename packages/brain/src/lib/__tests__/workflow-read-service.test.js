import { it,expect,vi } from 'vitest';
import { listWorkflows,readWorkflowActivities,readActivityConsumers } from '../workflow-read-service.js';
it('统一查询以关系表读取有序活动，参数过滤不拼接用户值',async()=>{
  const query=vi.fn(async()=>({rows:[{id:'w',activities:[{activity_id:'a'}]}]})),db={query};
  expect(await readWorkflowActivities(db,'w')).toEqual([{activity_id:'a'}]);
  expect(query.mock.calls[0][0]).toContain('workflow_activity_refs');
  expect(query.mock.calls[0][0]).toContain('ORDER BY sequence_no');
  await listWorkflows(db,{status:"x' OR true",capabilityId:'cap'});
  expect(query.mock.calls[1][1]).toEqual(['cap',"x' OR true"]);
  expect(query.mock.calls[1][0]).not.toContain("x' OR true");
  await readActivityConsumers(db,'a'); expect(query.mock.calls[2][1]).toEqual(['a']);
});
