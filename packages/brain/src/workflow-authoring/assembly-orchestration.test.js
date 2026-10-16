import {it,expect} from 'vitest';
const orchestration=await import('./assembly-orchestration.js').catch(()=>({}));
it('严格自动候选不能在生产库写入或把update当隔离新建',async()=>{
 expect(typeof orchestration.requireCandidateEnvironment).toBe('function');
 const db={query:async()=>({rows:[{name:'cecelia'}]})};
 await expect(orchestration.requireCandidateEnvironment(db)).rejects.toMatchObject({code:'candidate_environment_unsupported'});
 await expect(orchestration.requireCandidateEnvironment({query:async()=>({rows:[{name:'cecelia_scratch'}]})})).resolves.toBeUndefined();
});
