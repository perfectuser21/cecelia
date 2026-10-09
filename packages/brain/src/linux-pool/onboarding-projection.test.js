import {it,expect,vi} from 'vitest';
import {projectLinuxExecution} from './onboarding-projection.js';
it('权威读取失败时metadata不能伪造执行就绪，普通机器投影保持原值',async()=>{
 const plain={id:'plain',metadata:{}},managed={id:'managed',metadata:{onboarding:{},execution:true}};
 const query=vi.fn(async()=>{throw Error('unavailable');});
 expect(await projectLinuxExecution({query},[plain])).toEqual([plain]);expect(query).not.toHaveBeenCalled();
 const rows=await projectLinuxExecution({query},[plain,managed]);
 expect(rows[0]).toBe(plain);expect(rows[1].execution).toEqual({enabled:false,expires_at:null,verified_until:null});
 expect(managed).not.toHaveProperty('execution');
});
