import {it,expect,vi} from 'vitest';
import {LINUX_POOL_AUTHORITY} from '../linux-pool/task-authority.js';
const routing=vi.hoisted(()=>vi.fn(async()=>({task:{id:'fixture-created'}})));
vi.mock('../work-routing-store.js',()=>({createRoutedTask:routing}));
vi.mock('../db.js',()=>({default:{query:vi.fn(),connect:vi.fn()}}));
vi.mock('../task-updater.js',()=>({broadcastTaskState:vi.fn()}));
it('actions既有createTask导出复用机械抽取模块，原公共接口不增加授权参数',async()=>{
 const actions=await import('../actions.js');let extracted;try{extracted=await import('./task-create.js');}catch{}
 expect(extracted?.createTask,'createTask尚未独立抽取').toBeTypeOf('function');expect(actions.createTask).toBe(extracted.createTask);
});

it.each(['Pool','Client'])('incoming Linux authority survives actual extracted %s transaction branch',async kind=>{
 routing.mockClear();const db={constructor:{name:kind},connect:vi.fn(),query:vi.fn()};
 const {createTask}=await import('./task-create.js');
 const result=await createTask({title:'fixture',task_type:'audit',executor_kind:'linux-pool-controller',source:'scheduler',source_id:'linux-pool-onboarding:fixture',mutation_intent:'read_only',declared_domain:'operations',allow_unscoped:true,db},{linuxPoolAuthority:LINUX_POOL_AUTHORITY});
 expect(result.task.id).toBe('fixture-created');expect(routing).toHaveBeenCalledTimes(1);
 const context=routing.mock.calls[0][3];expect(context.linuxPoolAuthority).toBe(LINUX_POOL_AUTHORITY);
 expect(context.transaction).toBe(kind==='Client'?'existing':undefined);
});
