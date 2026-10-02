import {it,expect,vi} from 'vitest';
vi.mock('../db.js',()=>({default:{query:vi.fn(),connect:vi.fn()}}));
vi.mock('../task-updater.js',()=>({broadcastTaskState:vi.fn()}));
it('actions既有createTask导出复用机械抽取模块，原公共接口不增加授权参数',async()=>{
 const actions=await import('../actions.js');let extracted;try{extracted=await import('./task-create.js');}catch{}
 expect(extracted?.createTask,'createTask尚未独立抽取').toBeTypeOf('function');expect(actions.createTask).toBe(extracted.createTask);
});
