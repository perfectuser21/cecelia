import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../../native-agent-executor.js',()=>({requestNativeAgentCancellation:state.request}));
import {applyProjectionCommands} from '../commands.js';
beforeEach(()=>state.request.mockReset().mockResolvedValue({matched:false}));
it('运行中原生会话取消仅记录同run意图，不改任务终态或释放资源',async()=>{
 const query=vi.fn()
  .mockResolvedValueOnce({rows:[{id:'cmd-native',command_type:'cancel_requested',entity_id:'task-native',payload:{source:'qiumi_owner_stop'}}]})
  .mockResolvedValueOnce({rows:[{id:'task-native',status:'in_progress'}]})
  .mockResolvedValue({rows:[]});
 state.request.mockResolvedValue({matched:true});
 expect(await applyProjectionCommands({query})).toEqual({applied:1,rejected:0,failed:0});
 expect(state.request).toHaveBeenCalledWith(expect.objectContaining({query}), 'task-native');
 expect(query.mock.calls.some(([sql])=>/UPDATE tasks SET status|DELETE FROM device_locks|DELETE FROM task_leases/.test(String(sql)))).toBe(false);
 expect(query.mock.calls.at(-1)[1]).toEqual(['cmd-native','applied',null]);
});
it('非原生或身份不匹配的在途任务仍拒绝取消，不伪造终态',async()=>{
 const query=vi.fn()
  .mockResolvedValueOnce({rows:[{id:'cmd-legacy',command_type:'cancel_requested',entity_id:'task-legacy',payload:{}}]})
  .mockResolvedValueOnce({rows:[{id:'task-legacy',status:'in_progress'}]})
  .mockResolvedValue({rows:[]});
 state.request.mockResolvedValue({matched:false});
 expect(await applyProjectionCommands({query})).toEqual({applied:0,rejected:1,failed:0});
 expect(query.mock.calls.at(-1)[1]).toEqual(['cmd-legacy','rejected','active_or_terminal:in_progress']);
});
it.each([true,false])('原生资源等待复核的取消不落普通blocked终态（authority=%s）',async matched=>{
 const query=vi.fn()
  .mockResolvedValueOnce({rows:[{id:'cmd-review',command_type:'cancel_requested',entity_id:'task-review',payload:{source:'qiumi_owner_stop'}}]})
  .mockResolvedValueOnce({rows:[{id:'task-review',status:'blocked',native_control_epoch:'9',blocked_reason:'owner_decision',executor_kind:'external-worker',result:{native_agent:{needs_review:true}}}]})
  .mockResolvedValue({rows:[],rowCount:1});
 state.request.mockResolvedValue(matched?{matched:true}:{matched:false,nativeOwned:true});
 expect(await applyProjectionCommands({query})).toEqual(matched?{applied:1,rejected:0,failed:0}:{applied:0,rejected:1,failed:0});
 expect(query.mock.calls.some(([sql])=>/UPDATE tasks SET status|DELETE FROM device_locks|DELETE FROM task_leases/.test(String(sql)))).toBe(false);
});
it('普通blocked任务取消保留原语义，不误交原生运行器',async()=>{
 const query=vi.fn()
  .mockResolvedValueOnce({rows:[{id:'cmd-normal',command_type:'cancel_requested',entity_id:'task-normal',payload:{}}]})
  .mockResolvedValueOnce({rows:[{id:'task-normal',status:'blocked',native_control_epoch:'9',blocked_reason:'dependency',executor_kind:'other-worker',result:{}}]})
  .mockResolvedValue({rows:[],rowCount:1});
 expect(await applyProjectionCommands({query})).toEqual({applied:1,rejected:0,failed:0});
 expect(query.mock.calls.some(([sql])=>/UPDATE tasks SET status='cancelled'/.test(String(sql)))).toBe(true);
});

it('只有伪原生标签但没有server-run归属的blocked任务仍可按普通任务取消',async()=>{
 const query=vi.fn()
  .mockResolvedValueOnce({rows:[{id:'cmd-fake',command_type:'cancel_requested',entity_id:'task-fake',payload:{}}]})
  .mockResolvedValueOnce({rows:[{id:'task-fake',status:'blocked',native_control_epoch:'9',blocked_reason:'owner_decision',executor_kind:'external-worker',result:{native_agent:{needs_review:true}}}]})
  .mockResolvedValue({rows:[],rowCount:1});
 expect(await applyProjectionCommands({query})).toEqual({applied:1,rejected:0,failed:0});
 expect(query.mock.calls.some(([sql])=>/UPDATE tasks SET status='cancelled'/.test(String(sql)))).toBe(true);
});
