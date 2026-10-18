import {it,expect} from 'vitest';
import {REVIEWED_STAGE_MODES} from '../existing-ops-stage-modes.js';
it('新增Skills封套保留旧仓的完整QA与发布权限，独立隔离状态且不自动合并',()=>{
 const [legacy,extended]=REVIEWED_STAGE_MODES.map(mode=>JSON.parse(mode['repos.json']).repos);
 expect(extended.slice(0,legacy.length)).toEqual(legacy);
 expect(extended).toHaveLength(legacy.length+1);
 const skill=extended.at(-1);
 expect(skill).toMatchObject({key:'zenithjoy-skills',enabled:true,default:false,automerge:false,required_checks:['lint-skills'],preview:{type:'local'}});
 for(const prior of legacy){expect(skill.clone).not.toBe(prior.clone);expect(skill.worktree_base).not.toBe(prior.worktree_base);expect(skill.state_ns).not.toBe(prior.state_ns);}
});
it('现有阶段消费代码和runner仓选择逻辑不借新增Skills模式替换',()=>{
 const [legacy,extended]=REVIEWED_STAGE_MODES;
 expect(Object.keys(extended).sort()).toEqual(Object.keys(legacy).sort());
 for(const name of Object.keys(legacy).filter(p=>!['repos.json','lib/repo-profile.mjs'].includes(p)))expect(extended[name]).toBe(legacy[name]);
 expect(JSON.parse(legacy['repos.json']).repos.some(repo=>repo.key==='zenithjoy-skills')).toBe(false);
});
