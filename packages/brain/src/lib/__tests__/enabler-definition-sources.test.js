import {it,expect} from 'vitest';
import {resolveEnablerSource} from '../enabler-definition-sources.js';
const repo='owner/repo',revision='a'.repeat(40),digest='sha256:'+'b'.repeat(64);
const component=path=>({kind:'code',repo,revision,path,digest});
const binding=(path,extra={})=>({...component(path),scope:'activity',status:'verified',validation_scope:'reference_only',enabler_key:'lock',...extra});
const av=(id,bindings,steps=[])=>({id:'v-'+id,activity_id:id,source_repo:repo,source_commit:revision,payload:{activity_id:id,implementation_bindings:bindings,steps}});
const call={id:'call',caller_type:'activity',caller_id:'a',enabler_key:'lock',enabler_id:'e',active:true,impl_ref:`${repo}@${revision}:entry.sh`};
it('同父显式三文件固定证据均冻结，legacy符号不被宣称已核验',()=>{
 const files=['entry.sh','lock.sh','helper.py'],r=resolveEnablerSource({...call,impl_ref:'legacy:entry.sh#lock'},[av('a',files.map(p=>binding(p)))],files.map(component));
 expect(r).toMatchObject({activity_id:'a',step_id:null,source_status:'verified',validation_scope:'reference_only',symbol_status:'unverified'});
 expect(r.source_evidence.map(e=>e.path)).toEqual(files);expect(r.source_evidence.every(e=>e.validation_scope==='reference_only')).toBe(true);
});
it('两父共享同一Enabler不能借另一父的声明，即便legacy固定文件可匹配',()=>{
 const r=resolveEnablerSource(call,[av('a',[]),av('other',[binding('entry.sh')])],[component('entry.sh')]);expect(r.source_status).toBe('unknown');
});
it('仅无显式声明才兼容旧固定impl_ref；新声明错key不能fallback',()=>{
 expect(resolveEnablerSource(call,[av('a',[])],[component('entry.sh')]).source_status).toBe('verified');
 expect(resolveEnablerSource(call,[av('a',[binding('entry.sh',{enabler_key:'wrong'})])],[component('entry.sh')]).source_status).toBe('unknown');
});
for(const [name,change] of Object.entries({unresolved:{status:'unresolved'},raw:{kind:'raw'},wrong_scope:{scope:'step',step_key:'s'},wrong_sha:{revision:'c'.repeat(40)},wrong_digest:{digest:'sha256:'+'0'.repeat(64)},symbol:{symbol:'lock'},unknown_validation:{validation_scope:'business'}}))it(`显式${name}拒绝且不fallback`,()=>{
 expect(resolveEnablerSource(call,[av('a',[binding('entry.sh',change)])],[component('entry.sh')]).source_status).toBe('unknown');
});
it('显式组件缺任一文件整组未知；不挑一份好来源',()=>{
 expect(resolveEnablerSource(call,[av('a',[binding('entry.sh'),binding('helper.py')])],[component('entry.sh')]).source_status).toBe('unknown');
});
it('Step按规范UUID、父Activity与step_key精确匹配',()=>{
 const c={...call,caller_type:'step',caller_id:'step-id'},step={step_id:'step-id',locator:{activity_id:'a',step_key:'s'}};
 const a=av('a',[binding('entry.sh',{scope:'step',step_key:'s'})],[step]);
 expect(resolveEnablerSource(c,[a],[component('entry.sh')])).toMatchObject({source_status:'verified',activity_id:'a',step_id:'step-id'});
 a.payload.steps[0].locator.activity_id='other';expect(resolveEnablerSource(c,[a],[component('entry.sh')]).source_status).toBe('unknown');
 a.payload.steps[0].locator.activity_id='a';a.payload.implementation_bindings[0].step_key='other';expect(resolveEnablerSource(c,[a],[component('entry.sh')]).source_status).toBe('unknown');
});
it('inactive或不唯一父身份不借已知文件变绿',()=>{
 const a=av('a',[binding('entry.sh')]);expect(resolveEnablerSource({...call,active:false},[a],[component('entry.sh')]).source_status).toBe('unknown');
 expect(resolveEnablerSource(call,[a,structuredClone(a)],[component('entry.sh')]).source_status).toBe('unknown');
});
