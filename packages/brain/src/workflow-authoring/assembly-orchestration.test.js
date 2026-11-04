import {it,expect,vi} from 'vitest';
const orchestration=await import('./assembly-orchestration.js').catch(()=>({}));
it('严格自动候选不能在生产库写入或把update当隔离新建',async()=>{
 expect(typeof orchestration.requireCandidateEnvironment).toBe('function');
 const db={query:async()=>({rows:[{name:'cecelia'}]})};
 await expect(orchestration.requireCandidateEnvironment(db)).rejects.toMatchObject({code:'candidate_environment_unsupported'});
 await expect(orchestration.requireCandidateEnvironment({query:async()=>({rows:[{name:'cecelia_scratch'}]})})).resolves.toBeUndefined();
});

it('隔离库也拒绝update候选，拒绝前不写入正式对象',async()=>{
 const query=vi.fn(async()=>({rows:[{name:'cecelia_scratch'}]}));
 await expect(orchestration.prepareAuthoringCandidate({query},'authoring-task',{request:{operation:'update'}})).rejects.toMatchObject({code:'candidate_isolation_required'});
 expect(query).toHaveBeenCalledTimes(1);
 expect(query.mock.calls[0][0]).toMatch(/SELECT current_database/);
});
