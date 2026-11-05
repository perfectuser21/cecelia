// 只读资格只供固定完整cohort；突变正文只交给守卫，不执行候选源码。
import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// 仅追加本批已审的完整组合：AutoVersion marker退役与严格版本门reader必须同时更新。
// 所有未列成员继承固定旧cohort；不读取候选摘要，不按成员任选历史版本。
export function ciVersionGuardCohorts(previous) {
 const current={...previous,
  'existing-ops-source.js':'d34318e7523501f651d846268d956d6f745349e4cf8a10b1adefdd92ebe9a727',
  'existing-ops-stage-source.js':'14ebb11805679dd6f559ea42d88ba6f8a1bc96604f474230a2c486af5866e514',
 };
 const retired={...current,'existing-ops-stage-source.js':'59ac5f256ca1c99b5edae88ef89ea5c79648fe6d63c134afec42800dca2b04d0'};
 // e434身份来源reader：只追加完整caller/runtime/reader组合；旧退休reader仍独立保留。
 const identity={...retired,'existing-ops-stage-source.js':'ffb6ecb81faa63068fb7f02e3ed170d5c7199589b39dcfb6f1430131313ddbf4'};
 // 运行时消费选路reader：完整16成员与marker0/1分别成组，旧身份组不变。
 const runtimeScope={...identity,'existing-ops-stage-source.js':'a56f43da6e5d3989057ce075cb4cb9b14de4631c65cf2783dfd998a946980e43'};
 const concurrency={...runtimeScope,'existing-ops-stage-source.js':'8172bbfe9377f6672911ff1be4afb6f652932ce7fefe506764e08412e34508a1'};
 // W19冻结仅追加完整caller/runtime/reader组合，marker0/1分别封印，旧全部保留。
 const w19Freeze={...concurrency,'existing-ops-stage-source.js':'8027e13f13edf710b95a78bf036b52c72b48e97f4d01fbd3143144ed3f1f0018'};
 // 触达去抖只读reader已审变更：继承完整16成员，只新增独立marker0/1组。
 const outreach={...w19Freeze,'existing-ops-us-compose-source.js':'e1d026e543ef79614fbebbe5037866b2446535cacdd48698b97e3948f0fcf6fa'};
 // Deep max队列只追加完整16成员与marker0/1配对，旧组保持。
 const deepQueue={...outreach,'existing-ops-stage-source.js':'142de92540dde7a10b81fb765460643da89ca075f34aa093ff1ce840e5b115bd'};
 // Bark清退在已合Deep reader基础上追加完整16成员，两个marker封套各自匹配。
 const barkAfterDeep={...deepQueue,'existing-ops-stage-source.js':'75d26499ff2c61c40c95d9d932ac4a0d8a0bdc3a254fb05aca51980b9eec0f6a'};
 return [current,{...current,'existing-ops-source.js':'6634f6af4cca8862d91548114283b0861f35c349a5a81647fbd18b540c974848'},
  retired,{...retired,'existing-ops-source.js':'6634f6af4cca8862d91548114283b0861f35c349a5a81647fbd18b540c974848'},
  identity,{...identity,'existing-ops-source.js':'6634f6af4cca8862d91548114283b0861f35c349a5a81647fbd18b540c974848'},
  runtimeScope,{...runtimeScope,'existing-ops-source.js':'6634f6af4cca8862d91548114283b0861f35c349a5a81647fbd18b540c974848'},
  concurrency,{...concurrency,'existing-ops-source.js':'6634f6af4cca8862d91548114283b0861f35c349a5a81647fbd18b540c974848'},
  w19Freeze,{...w19Freeze,'existing-ops-source.js':'6634f6af4cca8862d91548114283b0861f35c349a5a81647fbd18b540c974848'},
  outreach,{...outreach,'existing-ops-source.js':'6634f6af4cca8862d91548114283b0861f35c349a5a81647fbd18b540c974848'},
  deepQueue,{...deepQueue,'existing-ops-source.js':'6634f6af4cca8862d91548114283b0861f35c349a5a81647fbd18b540c974848'},
  barkAfterDeep,{...barkAfterDeep,'existing-ops-source.js':'6634f6af4cca8862d91548114283b0861f35c349a5a81647fbd18b540c974848'}];
}

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
  it('已合main537完整caller/runtime/reader固定Git回放保留marker0/1资格',()=>{
   const sources=new Map([...base().keys()].map(file=>[file,execFileSync('git',[
    '--no-replace-objects','show','53714060cd53adb9b1247c05bde23e7667cd8fb4:'+path.relative(path.resolve(root,'../../../..'),file),
   ],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})]));
   expect(sources.size).toBe(16);
   for(const marker of [0,1]){
    sources.set(source,sources.get(source).replace(/EXISTING_OPS_BASIC_CI_SELECTOR_SCHEMA = [01]/,'EXISTING_OPS_BASIC_CI_SELECTOR_SCHEMA = '+marker));
    for(const kind of ['build','stage','native-evidence'])expect(scan(sources,path.join(root,`existing-ops-${kind}-envelopes.js`))).toEqual([]);
   }
  });
  it('已合main2f完整身份cohort仍保留marker0/1资格',()=>{
   const sources=new Map([...base().keys()].map(file=>[file,execFileSync('git',[
    '--no-replace-objects','show','2f4c9cbb9fbed1d36e4f3407bdf0ab1b72ece968:'+path.relative(path.resolve(root,'../../../..'),file),
   ],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})]));
   expect(sources.size).toBe(16);
   for(const marker of [0,1]){
    sources.set(source,sources.get(source).replace(/EXISTING_OPS_BASIC_CI_SELECTOR_SCHEMA = [01]/,'EXISTING_OPS_BASIC_CI_SELECTOR_SCHEMA = '+marker));
    for(const kind of ['build','stage','native-evidence'])expect(scan(sources,path.join(root,`existing-ops-${kind}-envelopes.js`))).toEqual([]);
   }
  });
  it.each([...Array(16).keys()].flatMap(index=>['missing','drift'].map(kind=>[index,kind])))('当前16成员第%s项%s拒绝',(index,kind)=>{
   const current=base();expect(current.size).toBe(16);const file=[...current.keys()][index];
   if(kind==='missing')current.delete(file);else current.set(file,current.get(file)+'\nexport const ciUnknownMember=true;\n');
   const target=path.join(root,'existing-ops-'+(file.endsWith('stage-envelopes.js')?'build':'stage')+'-envelopes.js');
   expect(scan(current,target).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it.each(['source','runtime-source'])('身份reader不能与固定旧Git的%s单成员混搭',name=>{
   const file=path.join(root,`existing-ops-${name}.js`),current=base();
   const old=execFileSync('git',['--no-replace-objects','show','88be2549bed2a8d8a3b5a6324bf5ea6267dda0da:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024});
   expect(current.get(file)).not.toBe(old);
   current.set(file,old);expect(scan(current).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it('完整身份reader也不能给予未知外部caller只读资格',()=>{
   const current=base();current.set(path.join(root,'unknown-identity-reader.js'),
    "import { ENVELOPES } from './existing-ops-build-envelopes.js';eval(ENVELOPES.spawnParameters);");
   expect(scan(current).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it('ce20完整旧reader组合仍可重放，追加退休组合不覆盖旧证明',()=>{
   const sources=new Map([...base().keys()].map(file=>[file,execFileSync('git',[
    '--no-replace-objects','show','ce20b5a29123c9ade1a0bc4aa2753e3ea3fe310d:'+path.relative(path.resolve(root,'../../../..'),file),
   ],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})]));
   for(const kind of ['build','stage','native-evidence'])expect(scan(sources,path.join(root,`existing-ops-${kind}-envelopes.js`))).toEqual([]);
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
  it.each([0,1])('触达去抖新reader与已合旧reader完整marker%s均保留三封套资格',marker=>{
   const old=new Map([...base().keys()].map(file=>[file,execFileSync('git',[
    '--no-replace-objects','show','72681c2ab20c1509feae6d5ee28d2bf0b54566c4:'+path.relative(path.resolve(root,'../../../..'),file),
   ],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})]));
   for(const sources of [old,base()]){
    expect(sources.size).toBe(16);
    sources.set(source,sources.get(source).replace(/EXISTING_OPS_BASIC_CI_SELECTOR_SCHEMA = [01]/,'EXISTING_OPS_BASIC_CI_SELECTOR_SCHEMA = '+marker));
    for(const kind of ['build','stage','native-evidence'])expect(scan(sources,path.join(root,`existing-ops-${kind}-envelopes.js`))).toEqual([]);
   }
  });
  it.each(['missing','drift','process'])('触达reader %s不继承完整只读资格',kind=>{
   const current=base(),file=path.join(root,'existing-ops-us-compose-source.js');
   if(kind==='missing')current.delete(file);
   else current.set(file,current.get(file)+(kind==='drift'?'\nexport const unknownOutreachReader=true;':"\nimport {spawn as launch} from 'node:child_process';launch('claude',['-p']);"));
   expect(scan(current).some(hit=>hit.rule==='E1')).toBe(true);
   if(kind==='process')expect(scan(current,file).some(hit=>hit.rule==='R1')).toBe(true);
  });
 });
}
