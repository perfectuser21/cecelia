/** 现役严格16成员只读消费资格；不执行来源模板。 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {registerCiRetirementGuardTests,ciVersionGuardCohorts} from './claude-channel-retired.ci-retirement.fixture.js';

const cache=new Map(), referenceCache=new Map();
function hash(text,parse,shape){
 if(!cache.has(text))cache.set(text,createHash('sha256').update(shape(parse(text))).digest('hex'));
 return cache.get(text);
}
export function reviewedADataRanges(src,{file,sources,root,parse,shape,rows,decoded,provenFingerprintReader}){
 const data=['build-envelopes','stage-envelopes','native-evidence-envelopes'].map(n=>path.join(root,`existing-ops-${n}.js`));
 if(!data.includes(file)||src!==sources?.get(file))return null;
 try{
  const selected=ciVersionGuardCohorts().find(tuple=>Object.entries(tuple).every(([name,digest])=>{
   const text=sources.get(path.join(root,name));return typeof text==='string'&&hash(text,parse,shape)===digest;
  }));
  if(!selected)return null;
  const closure=new Set(Object.keys(selected).map(name=>path.join(root,name)));
  for(const [name,digest] of Object.entries(selected)){
   const text=sources.get(path.join(root,name));
   if(typeof text!=='string'||![].concat(digest).includes(hash(text,parse,shape)))return null;
  }
  // 准确固定所有内部消费者；外部不得取得原文或传入 eval 解析器。
  // source.js 仅向注册器返回摘要/关系，允许正常调用；其完整 AST 已在上面绑定。
  const protectedNames=Object.keys(selected).filter(n=>n!=='existing-ops-source.js');
  for(const [consumer,text] of sources){
   if(closure.has(consumer)||provenFingerprintReader(consumer,text))continue;
   if(!referenceCache.has(text))referenceCache.set(text,decoded(text));
   if(referenceCache.get(text).some(value=>protectedNames.some(name=>value.includes(name))))return null;
  }
  return rows(parse(src)).filter(({node})=>node.type==='Literal'&&typeof node.value==='string'
   ||node.type==='TemplateLiteral'&&node.expressions.length===0).map(({node})=>[node.start,node.end]);
 }catch{return null;}
}

export function registerReviewedAGuardTests({ BRAIN_ROOT, findClaudeInvocations }) {
 const root=path.join(BRAIN_ROOT,'src/lib');
 const names=['source','workspace-source','build-source','build-envelopes','runtime-source','us-compose-source','stage-source','stage-envelopes','stage-modes','provenance-envelope','provenance-core-envelope','provenance-entry-envelopes','provenance-local-envelopes','native-evidence-source','native-evidence-envelopes'];
 const files=names.map(n=>path.join(root,`existing-ops-${n}.js`));
 const data=path.join(root,'existing-ops-build-envelopes.js');
 const snapshot=path.join(BRAIN_ROOT,'../../scripts/ci/implementation-snapshot.mjs');
 const base=()=>new Map([...files,snapshot].map(f=>[f,readFileSync(f,'utf8')]));
 const scan=(s,f=data)=>findClaudeInvocations(s.get(f),{file:f,sources:s});
 registerCiRetirementGuardTests({root,base,scan});
 describe('A封套精确只读闭包及执行防复活',()=>{
  it('获客预发来源兼容完整只读组合通过，未知 runtime 仍拒绝',()=>{
   const current=base(),runtime=path.join(root,'existing-ops-runtime-source.js');
   expect(scan(current)).toEqual([]);
   const changed=base();changed.set(runtime,changed.get(runtime)+'\nexport const unknownStagingSource=true;');
   expect(scan(changed).some(h=>h.rule==='E1')).toBe(true);
  });
  it.each(['eval','raw export','process'])('移动至workspace的helper出现%s仍失败关闭',kind=>{
   const s=base(),file=path.join(root,'existing-ops-workspace-source.js');
   const edits={eval:'\neval(candidate);','raw export':"\nimport {STAGE_ENVELOPES} from './existing-ops-stage-envelopes.js';export const raw=STAGE_ENVELOPES;",process:"\nimport {spawn as launch} from 'node:child_process';launch('claude',['-p']);"};
   s.set(file,s.get(file)+edits[kind]);expect(scan(s).some(h=>h.rule==='E1')).toBe(true);
   if(kind==='process')expect(scan(s,file).some(h=>h.rule==='R1')).toBe(true);
  });
  it('CI scratch既有实际调用方缺失不能取得完整闭包资格',()=>{
   const s=base();expect(scan(s)).toEqual([]);s.delete(snapshot);expect(scan(s).some(h=>h.rule==='E1')).toBe(true);
  });
  it.each(['unknown','eval callback','raw export','process'])('CI scratch调用方%s仍失败关闭',kind=>{
   const s=base(),old=s.get(snapshot);
   const edited=kind==='eval callback'?old.replace('parse:text=>parse(text,','parse:text=>eval(text,')
    :old+({unknown:'\nexport const unknownCaller=true;','raw export':'\nexport const rawWorkspace=collectWorkspaceInputEdges;',process:"\nimport {spawn as launch} from 'node:child_process';launch('claude',['-p']);"}[kind]);
   expect(edited).not.toBe(old);s.set(snapshot,edited);expect(scan(s).some(h=>h.rule==='E1')).toBe(true);
   if(kind==='process')expect(scan(s,snapshot).some(h=>h.rule==='R1')).toBe(true);
  });
  it('未知workspace第三消费者不能借已审scratch调用方取得资格',()=>{
   const s=base();s.set(path.join(root,'unknown-workspace-reader.js'),"import {collectWorkspaceInputEdges} from './existing-ops-workspace-source.js';collectWorkspaceInputEdges({parse:eval});");
   expect(scan(s).some(h=>h.rule==='E1')).toBe(true);
  });


  it.each(['build-source','build-envelopes'])('B只读闭包禁止A/B混配 %s',name=>{const s=base();s.set(path.join(root,`existing-ops-${name}.js`),execFileSync('git',['show',`5dd82456a80b77dda054f5994d1561e1106317eb:packages/brain/src/lib/existing-ops-${name}.js`],{encoding:'utf8'}));expect(scan(s).some(h=>h.rule==='E1')).toBe(true)});

  it.each(['build','stage','native-evidence'])('%s完整已审组合无误报',name=>{const f=path.join(root,`existing-ops-${name}-envelopes.js`);expect(scan(base(),f)).toEqual([]);});
  it.each(files)('任何闭包成员突变或缺失必须拒绝：%s',f=>{const s=base();s.set(f,s.get(f)+'\nexport const unknownClosure=true;');expect(scan(s).some(h=>h.rule==='E1')).toBe(true);const missing=base();missing.delete(f);expect(findClaudeInvocations(base().get(data),{file:data,sources:missing}).some(h=>h.rule==='E1')).toBe(true);});
  it.each(['eval','raw','spawn','alias','interpolation','escaped','concat','dynamic','caller'])('%s不能继承只读资格',kind=>{
   const s=base(),consumer=path.join(root,'existing-ops-build-source.js'),extra=path.join(root,'third.js');
   if(kind==='eval')s.set(consumer,s.get(consumer)+'\neval(A_ENVELOPES.reviewed.any);');
   if(kind==='raw')s.set(consumer,s.get(consumer)+'\nexport const raw=A_ENVELOPES;');
   if(kind==='spawn'||kind==='alias')s.set(data,s.get(data)+(kind==='spawn'?"\nspawn('claude',['-p']);":"\nimport {spawn as launch} from 'node:child_process';launch('claude',['-p']);"));
   if(kind==='interpolation')s.set(data,s.get(data).replace('spawnParameters: `','spawnParameters: `${launch("claude")}'));
   if(kind==='escaped')s.set(extra,"import {A_ENVELOPES} from './existing-ops-build-\\u0065nvelopes.js';eval(A_ENVELOPES.reviewed.any);");
   if(kind==='concat')s.set(extra,"const m=await import('./existing-ops-build-'+'envelopes.js');eval(m.A_ENVELOPES.reviewed.any);");
   if(kind==='dynamic')s.set(extra,"const m=await import('./existing-ops-build-envelopes.js');eval(m.A_ENVELOPES.reviewed.any);");
   if(kind==='caller'){const f=path.join(root,'existing-ops-source.js');s.set(f,s.get(f)+'\neval(await reviewedAContext(options));');}
   expect(scan(s).some(h=>h.rule==='E1')).toBe(true);
   if(['spawn','alias'].includes(kind))expect(scan(s).some(h=>h.rule==='R1')).toBe(true);
  });
  it('当前文件字节不能借sources旧副本取得资格',()=>{const s=base();expect(findClaudeInvocations(s.get(data)+"\nspawn('claude',['-p']);",{file:data,sources:s}).some(h=>h.rule==='R1')).toBe(true);});
 });
}
