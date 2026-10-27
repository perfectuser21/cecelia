import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
export function registerReviewedAGuardTests({ BRAIN_ROOT, findClaudeInvocations }) {
 const root=path.join(BRAIN_ROOT,'src/lib');
 const names=['source','build-source','build-envelopes','runtime-source','stage-source','stage-envelopes','stage-modes','provenance-envelope','provenance-core-envelope','provenance-entry-envelopes','provenance-local-envelopes','native-evidence-source','native-evidence-envelopes'];
 const files=names.map(n=>path.join(root,`existing-ops-${n}.js`));
 const data=path.join(root,'existing-ops-build-envelopes.js');
 const base=()=>new Map(files.map(f=>[f,readFileSync(f,'utf8')]));
 const scan=(s,f=data)=>findClaudeInvocations(s.get(f),{file:f,sources:s});
 describe('A封套精确只读闭包及执行防复活',()=>{
  it.each(['build','stage','native-evidence'])('%s完整已审组合无误报',name=>{const f=path.join(root,`existing-ops-${name}-envelopes.js`);expect(scan(base(),f)).toEqual([]);});
  it.each(files)('任何闭包成员语义突变必须拒绝：%s',f=>{const s=base();s.set(f,s.get(f)+'\nexport const unknownClosure=true;');expect(scan(s).some(h=>h.rule==='E1')).toBe(true);});
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
