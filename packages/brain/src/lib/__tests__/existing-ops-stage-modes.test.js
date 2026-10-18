import {it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {REVIEWED_STAGE_MODES} from '../existing-ops-stage-modes.js';
it('新增模式保留旧仓完整QA与合并策略，只新增独立Skills配置',()=>{
 const [legacy,extended]=REVIEWED_STAGE_MODES.map(mode=>JSON.parse(mode['repos.json']).repos);
 expect(extended.slice(0,legacy.length)).toEqual(legacy);expect(extended).toHaveLength(legacy.length+1);
 const skill=extended.at(-1);expect(skill).toMatchObject({key:'zenithjoy-skills',enabled:true,default:false,automerge:false,required_checks:['lint-skills'],preview:{type:'local'}});
 for(const prior of legacy)for(const field of ['clone','worktree_base','state_ns'])expect(skill[field]).not.toBe(prior[field]);
 expect(REVIEWED_STAGE_MODES[1]['runner/lib/repos.mjs']).toBe(REVIEWED_STAGE_MODES[0]['runner/lib/repos.mjs']);
 expect(legacy.some(repo=>repo.key==='zenithjoy-skills')).toBe(false);
});
it('测试保留明确辅助归属，release碎片只允许完整待消费或真实DEFINITION已消费状态',()=>{
 const relations=JSON.parse(readFileSync(new URL('../../../../../.implementation-source-relations.json',import.meta.url),'utf8')).relations;
 expect(relations).toContainEqual({owner_path:'packages/brain/src/lib/existing-ops-stage-modes.js',path:'packages/brain/src/lib/__tests__/existing-ops-stage-modes.test.js',role:'verification'});
 const path='changes/cp-10182235-stage-proof-bootstrap.md',fragment=new URL('../../../../../'+path,import.meta.url);
 const rows=relations.filter(row=>row.path===path);
 const note='预先兼容已审核的中央 Skills runner 完整配置模式，并记录 repoRules 提示词和 build 预检模块的实际固定来源；保留历史绑定、原 QA 隔离及各仓合并策略。执行配置仍保持原状。';
 if(existsSync(fragment)){
  expect(rows).toEqual([{owner_path:'packages/brain/src/lib/existing-ops-stage-source.js',path,role:'release'}]);
  expect(readFileSync(fragment,'utf8').trim()).toBe(note);
 }else{
  expect(rows).toEqual([]);
  expect(readFileSync(new URL('../../../../../DEFINITION.md',import.meta.url),'utf8').split(/\r?\n/)).toContain(note);
 }
});
