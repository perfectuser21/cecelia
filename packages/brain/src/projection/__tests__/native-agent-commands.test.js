import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../../native-agent-executor.js',()=>({requestNativeAgentCancellation:state.request}));
import {applyProjectionCommands} from '../commands.js';
beforeEach(()=>state.request.mockReset());
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
