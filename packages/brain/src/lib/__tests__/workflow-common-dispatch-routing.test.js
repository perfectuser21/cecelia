import {describe,it,expect,vi} from 'vitest';
import {dispatchWorkflowCommanderTasks} from '../workflow-commander-dispatch.js';
const task={id:'10000000-0000-4000-8000-000000000001',kind:'workflow',task_type:'workflow_dispatch',status:'queued',payload:{workflow_key:'douyin_video_publish.android'}};
describe('workflow dispatch convergence',()=>{
 it.each([undefined,'commander-v2'])('sends new %s workflow through one common runner without SSH Commander',async protocol=>{
  const row=structuredClone(task);if(protocol)row.payload.commander_protocol=protocol;
  const pool={query:vi.fn(async sql=>sql.includes('SELECT * FROM tasks')?{rows:[row]}:{rows:[],rowCount:0})};
  const dispatch=vi.fn(async()=>({dispatched:true})),sshDispatch=vi.fn(),now=()=>new Date('2026-11-03T12:00:00+08:00');
  const out=await dispatchWorkflowCommanderTasks(pool,{workflowCommonDispatch:dispatch,sshDispatch,now,resolveConfig:()=>({publish_hours:{start:9,end:23}})});
  expect(dispatch).toHaveBeenCalledWith(pool,row);expect(out.dispatched).toBe(1);expect(sshDispatch).not.toHaveBeenCalled();
 });
});
