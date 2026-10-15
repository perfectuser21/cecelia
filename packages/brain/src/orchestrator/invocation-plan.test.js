import { describe, it, expect } from 'vitest';
import { compileInvocation, validateInvocationOutput } from './invocation-plan.js';
const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
const impl={kind:'skill',skill_id:'11111111-1111-4111-8111-111111111111',repo:'perfectuser21/cecelia',path:'skills/pure/SKILL.md',revision:'a'.repeat(40)};
const contract={key:'pure',executor_kind:'agent',runtime:{transport:'codex-bridge'},mutation_intent:'none',input_schema:schema,output_schema:schema,acceptance:['真实产物'],implementation:impl};
export const fixture=()=>({key:'pure',source:{repo:impl.repo,ref:'flow.json',revision:impl.revision},input_schema:schema,output_schema:schema,activities:[structuredClone(contract)]});
const catalog={skills:[{id:impl.skill_id,status:'active'}]};
describe('固定调用计划',()=>{
 it('Activity和Workflow消费同一装配器与严格输入',()=>{const plan=compileInvocation(fixture(),catalog,{tenantId:'t',input:{text:'x'}});expect(plan.gaps).toEqual([]);expect(plan.activities[0].input_schema).toEqual(schema);});
 it.each(['scheduler_only','deprecated'])('不接受%s执行模式',mode=>{const d=fixture();d.activities[0].runtime.mode=mode;expect(compileInvocation(d,catalog,{input:{text:'x'}}).gaps.some(g=>g.code==='execution_mode_unsupported')).toBe(true);});
 it('write不能借research进入编码或无人canvas',()=>{const d=fixture();d.activities[0].mutation_intent='write';expect(compileInvocation(d,catalog,{input:{text:'x'}}).gaps.some(g=>g.code==='mutation_unsupported')).toBe(true);});
 it('无transport如实阻塞',()=>{const d=fixture();delete d.activities[0].runtime;expect(compileInvocation(d,catalog,{input:{text:'x'}}).gaps.some(g=>g.code==='transport_missing')).toBe(true);});
 it('需要未接通设备或外部资源的Skill不得伪称纯输入输出就绪',()=>{const d=fixture();d.activities[0].resources={phone_serial:'required'};expect(compileInvocation(d,catalog,{input:{text:'x'}}).gaps.some(g=>g.code==='resource_not_connected')).toBe(true);});
 it('输入和结构化输出均遵守schema',()=>{expect(compileInvocation(fixture(),catalog,{input:{text:1}}).gaps.some(g=>g.code==='input_schema_invalid')).toBe(true);expect(()=>validateInvocationOutput(schema,{text:1})).toThrow();});
});

it('台账active不能替代仓库用料已抵达执行进程的证据',()=>{
 const d=fixture();d.activities[0].warehouse_dependencies=[{key:'material',role:'uses'}];
 const plan=compileInvocation(d,{...catalog,warehouse_items:[{id:'material-id',key:'material',active:true}]},{input:{text:'x'}});
 expect(plan.gaps.some(g=>g.code==='resource_material_unverified')).toBe(true);
});
