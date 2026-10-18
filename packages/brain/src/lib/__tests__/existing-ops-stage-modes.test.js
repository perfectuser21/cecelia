import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {REVIEWED_STAGE_MODES} from '../existing-ops-stage-modes.js';
it('新增模式保留旧仓完整QA与合并策略，只新增独立Skills配置',()=>{
 const [legacy,extended]=REVIEWED_STAGE_MODES.map(mode=>JSON.parse(mode['repos.json']).repos);
 expect(extended.slice(0,legacy.length)).toEqual(legacy);expect(extended).toHaveLength(legacy.length+1);
 const skill=extended.at(-1);expect(skill).toMatchObject({key:'zenithjoy-skills',enabled:true,default:false,automerge:false,required_checks:['lint-skills'],preview:{type:'local'}});
 for(const prior of legacy)for(const field of ['clone','worktree_base','state_ns'])expect(skill[field]).not.toBe(prior[field]);
 expect(REVIEWED_STAGE_MODES[1]['runner/lib/repos.mjs']).toBe(REVIEWED_STAGE_MODES[0]['runner/lib/repos.mjs']);
 expect(legacy.some(repo=>repo.key==='zenithjoy-skills')).toBe(false);
});
it('新增证明模块的测试和release碎片走现行明确辅助归属登记',()=>{
 const relations=JSON.parse(readFileSync(new URL('../../../../../.implementation-source-relations.json',import.meta.url),'utf8')).relations;
 expect(relations).toContainEqual({owner_path:'packages/brain/src/lib/existing-ops-stage-modes.js',path:'packages/brain/src/lib/__tests__/existing-ops-stage-modes.test.js',role:'verification'});
 expect(relations).toContainEqual({owner_path:'packages/brain/src/lib/existing-ops-stage-source.js',path:'changes/cp-10182235-stage-proof-bootstrap.md',role:'release'});
});
