// 只读资格只供固定完整cohort；突变正文只交给守卫，不执行候选源码。
import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

export function registerCiRetirementGuardTests({root,base,memoBase,scan}) {
 const source=path.join(root,'existing-ops-source.js');
 const members=['stage-source','workspace-source'].map(name=>path.join(root,`existing-ops-${name}.js`));
 describe('CI退役来源只读完整cohort防复活',()=>{
  const historical=()=>new Map([...base().keys()].map(file=>[file,execFileSync('git',[
   '--no-replace-objects','show','fadbf32852cdb30f71e34dda9ab81b521bda484b:'+path.relative(path.resolve(root,'../../../..'),file),
  ],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})]));
  it('真实版本增量门当前完整reader可读，发布前旧AutoVersion reader仍独立可重放',()=>{
   for(const sources of [historical(),base()])for(const marker of [0,1]){
    sources.set(source,sources.get(source).replace(/EXISTING_OPS_BASIC_CI_SELECTOR_SCHEMA = [01]/,
     'EXISTING_OPS_BASIC_CI_SELECTOR_SCHEMA = '+marker));
    for(const kind of ['build','stage','native-evidence'])expect(scan(sources,path.join(root,`existing-ops-${kind}-envelopes.js`))).toEqual([]);
   }
  });
  it.each([source,members[0]])('当前版本门reader不能混配旧AutoVersion成员：%s',file=>{
   const current=base(),old=historical();
   expect(current.get(file)).not.toBe(old.get(file));
   current.set(file,old.get(file));expect(scan(current).some(hit=>hit.rule==='E1')).toBe(true);
   old.set(file,base().get(file));expect(scan(old).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it.each([0,1])('完整marker%s配对保留三类只读封套，旧memo组合独立保留',marker=>{
   const current=base();current.set(source,current.get(source).replace(/EXISTING_OPS_BASIC_CI_SELECTOR_SCHEMA = [01]/,'EXISTING_OPS_BASIC_CI_SELECTOR_SCHEMA = '+marker));
   for(const kind of ['build','stage','native-evidence'])expect(scan(current,path.join(root,`existing-ops-${kind}-envelopes.js`))).toEqual([]);
   expect(scan(memoBase())).toEqual([]);
  });
  it.each(members.flatMap(file=>['missing','mixed','drift'].map(kind=>[file,kind])))('%s %s不能取得完整只读资格',(file,kind)=>{
   const current=base(),original=current.get(file);
   if(kind==='missing')current.delete(file);
   else current.set(file,kind==='mixed'?memoBase().get(file):original+'\nexport const unreviewedRetirementReader=true;');
   expect(current.get(file)).not.toBe(original);
   expect(scan(current).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it.each(members.flatMap(file=>['early return','spawn'].map(kind=>[file,kind])))('%s %s仍被守卫拒绝',(file,kind)=>{
   const current=base(),original=current.get(file);
   const anchor=file.endsWith('stage-source.js')
    ?'export async function collectBasicCiSources({ read, ci, revision, relations, parse, paths }) {'
    :'export async function collectWorkspaceInputEdges({ revision, paths, readSource, parse }) {';
   const edited=kind==='early return'?original.replace(anchor,anchor+'\n return [];')
    :original+"\nimport {spawn as launchRetired} from 'node:child_process';launchRetired('claude',['-p','probe']);";
   expect(edited).not.toBe(original);current.set(file,edited);
   expect(scan(current).some(hit=>hit.rule==='E1')).toBe(true);
   if(kind==='spawn')expect(scan(current,file).some(hit=>hit.rule==='R1')).toBe(true);
  });
 });
}
