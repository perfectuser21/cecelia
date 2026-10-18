import {it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {removeConsumedReleaseRelations} from '../../../../../scripts/ci/implementation-auxiliary-evidence.mjs';
import {REVIEWED_STAGE_MODES} from '../existing-ops-stage-modes.js';
it('新增模式保留旧仓完整QA与合并策略，只新增独立Skills配置',()=>{
 const [legacy,extended]=REVIEWED_STAGE_MODES.map(mode=>JSON.parse(mode['repos.json']).repos);
 expect(extended.slice(0,legacy.length)).toEqual(legacy);expect(extended).toHaveLength(legacy.length+1);
 const skill=extended.at(-1);expect(skill).toMatchObject({key:'zenithjoy-skills',enabled:true,default:false,automerge:false,required_checks:['lint-skills'],preview:{type:'local'}});
 for(const prior of legacy)for(const field of ['clone','worktree_base','state_ns'])expect(skill[field]).not.toBe(prior[field]);
 expect(REVIEWED_STAGE_MODES[1]['runner/lib/repos.mjs']).toBe(REVIEWED_STAGE_MODES[0]['runner/lib/repos.mjs']);
 expect(legacy.some(repo=>repo.key==='zenithjoy-skills')).toBe(false);
});
const releasePath='changes/cp-10182235-stage-proof-bootstrap.md';
const release={owner_path:'packages/brain/src/lib/existing-ops-stage-source.js',path:releasePath,role:'release'};
const assertReleaseLifecycle=(relations,present)=>expect(relations.filter(row=>row.path===releasePath)).toEqual(present?[release]:[]);
it('新增证明模块测试始终登记，release碎片消费前后保持原件与登记同状态',()=>{
 const relations=JSON.parse(readFileSync(new URL('../../../../../.implementation-source-relations.json',import.meta.url),'utf8')).relations;
 expect(relations).toContainEqual({owner_path:'packages/brain/src/lib/existing-ops-stage-modes.js',path:'packages/brain/src/lib/__tests__/existing-ops-stage-modes.test.js',role:'verification'});
 assertReleaseLifecycle(relations,existsSync(new URL('../../../../../'+releasePath,import.meta.url)));
});

it('原严格消费器只删除已消费release行，消费前后两态都核验并保其它归属',()=>{
 const verification={owner_path:'packages/brain/src/lib/existing-ops-stage-modes.js',path:'packages/brain/src/lib/__tests__/existing-ops-stage-modes.test.js',role:'verification'};
 const before=JSON.stringify({schema_version:1,repo:'perfectuser21/cecelia',relations:[verification,release]});
 assertReleaseLifecycle(JSON.parse(before).relations,true);
 const after=JSON.parse(removeConsumedReleaseRelations(before,[releasePath]));
 assertReleaseLifecycle(after.relations,false);expect(after.relations).toEqual([verification]);
});
it('碎片仍在但登记缺失时拒绝',()=>{expect(()=>assertReleaseLifecycle([],true)).toThrow();});
it('碎片仍在但owner错误时拒绝',()=>{expect(()=>assertReleaseLifecycle([{...release,owner_path:'packages/brain/src/lib/existing-ops-stage-modes.js'}],true)).toThrow();});
it('碎片已消费却留孤立登记时拒绝',()=>{expect(()=>assertReleaseLifecycle([release],false)).toThrow();});
