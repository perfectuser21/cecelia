import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {REVIEWED_STAGE_MODES} from '../existing-ops-stage-modes.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/reviewed-skills-mode-2a537.json',import.meta.url),'utf8'));
const canonical=value=>JSON.stringify(value,(key,item)=>['start','end','raw'].includes(key)?undefined:item);
it('受审完整模式匹配独立固定Git三文件及摘要，不能由生产封套自证',()=>{
 const mode=REVIEWED_STAGE_MODES[1];
 for(const [path,row] of Object.entries(fixture.files)){
  expect(createHash('sha256').update(row.content).digest('hex')).toBe(row.sha256);
  const read=text=>path.endsWith('.json')?JSON.parse(text):parse(text,{ecmaVersion:'latest',sourceType:'module'});
  expect(canonical(read(mode[path]))).toBe(canonical(read(row.content)));
 }
});
it('新增模式保留旧仓完整QA与合并策略，只新增独立Skills配置',()=>{
 const [legacy,extended]=REVIEWED_STAGE_MODES.map(mode=>JSON.parse(mode['repos.json']).repos);
 expect(extended.slice(0,legacy.length)).toEqual(legacy);expect(extended).toHaveLength(legacy.length+1);
 const skill=extended.at(-1);expect(skill).toMatchObject({key:'zenithjoy-skills',enabled:true,default:false,automerge:false,required_checks:['lint-skills'],preview:{type:'local'}});
 for(const prior of legacy)for(const field of ['clone','worktree_base','state_ns'])expect(skill[field]).not.toBe(prior[field]);
 expect(REVIEWED_STAGE_MODES[1]['runner/lib/repos.mjs']).toBe(REVIEWED_STAGE_MODES[0]['runner/lib/repos.mjs']);
 expect(legacy.some(repo=>repo.key==='zenithjoy-skills')).toBe(false);
});
