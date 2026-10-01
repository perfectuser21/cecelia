import {it,expect,vi} from 'vitest';
const {query}=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../db.js',()=>({default:{query}}));
import {loadActiveMachines,clearMachineCache} from './load-machines.js';
import {legacyRecords} from '../execution-directory/legacy-policy.js';
it('目录投影只有旧2组合；snapshot读取不每次查DB',async()=>{
 const a=await loadActiveMachines();const b=await loadActiveMachines();
 expect(a.map(n=>n.metadata.executors.length)).toEqual([1,0,1]);expect(b).toEqual(a);expect(query).not.toHaveBeenCalled();
});
it('PATCH后刷新原子发布；metadata.executors不能授予M1能力',async()=>{
 const rows=legacyRecords({env:{FLEET_WORKER_XIAN_MAC_M1_URL:'http://m1:5231'}});
 rows[1].metadata.executors=[{executor:'codex',url:'http://m1:3458'}];
 query.mockResolvedValue({rows});await clearMachineCache();
 const next=await loadActiveMachines();expect(next.find(n=>n.canonical_id==='xian-mac-m1').metadata.executors).toEqual([]);
 expect(query.mock.calls.at(-1)[0]).toContain('execution_nodes');
});
it('刷新失败不产生未处理promise，保留已有快照到过期',async()=>{
 query.mockRejectedValue(Error('db down'));await expect(clearMachineCache()).resolves.toBeNull();
});
