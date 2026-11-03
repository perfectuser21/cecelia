// 旧relay不再成功spawn；兼容驱动仍须结束观测事件并返回退役失败。
import {it,expect,vi} from 'vitest';
const boundaries=vi.hoisted(()=>({query:vi.fn(async()=>({rows:[]})),process:vi.fn()}));
vi.mock('../db.js',()=>({default:{query:(...args)=>boundaries.query(...args)}}));
vi.mock('node:child_process',async original=>({...await original(),spawn:(...args)=>boundaries.process(...args),execFile:(...args)=>boundaries.process(...args)}));
import {runHarnessInitiativeRouter} from '../executor.js';
it('真实退役入口返回失败且不spawn，观测事件同initiative完成收口',async()=>{
 const query=vi.fn(async()=>({rows:[]}));
 const result=await runHarnessInitiativeRouter({id:'task-retired',task_type:'harness_initiative',payload:{orchestrator:'skill-relay',initiative_id:'initiative-retired'}},{pool:{query}});
 expect(result).toMatchObject({ok:false,error:'kernel_runtime_retired'});expect(boundaries.process).not.toHaveBeenCalled();
 const events=query.mock.calls.filter(([sql])=>sql.includes('initiative_run_events'));
 expect(events).toHaveLength(2);
 expect(events[0][0]).toContain('INSERT INTO initiative_run_events');expect(events[0][1]).toEqual(['initiative-retired','skill-relay-spawn','running',1,expect.any(Number),null]);
 expect(events[1][0]).toMatch(/WHERE initiative_id = \$2 AND node = 'skill-relay-spawn' AND status = 'running'/);
 // done仅指拒绝调用已结束，result.ok=false禁止视为业务成功。
 expect(events[1][1]).toEqual(['done','initiative-retired']);
 expect(query.mock.calls.some(([sql])=>/INSERT INTO (?:task_runs|initiative_runs)/.test(sql))).toBe(false);
});
