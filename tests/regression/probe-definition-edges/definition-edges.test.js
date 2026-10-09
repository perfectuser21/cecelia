import { expect, it } from 'vitest';
import { definitionEdges } from '../../../scripts/ci/implementation-snapshot.mjs';
function snapshot() {
 const repo='perfectuser21/zenithjoy-workspace',revision='a'.repeat(40);
 return {repo,revision,definitions:{
  workflows:[{id:'wv',source_path:'contracts/workflow.yaml',payload:{capability_id:'cap',activities:[{activity_version_id:'av'}]}}],
  activities:[{id:'av',activity_id:'activity',source_path:'contracts/activity.yaml',payload:{implementation_bindings:[{repo,revision,kind:'code',status:'verified',path:'services/controller.js'}]}}],
 },assertions:[
  {id:'probe',journey_id:'cap',step_id:'activity',assertion_ref:'probe:videos_readback'},
  {id:'code',journey_id:'cap',step_id:'activity',assertion_ref:'tests/controller.test.js',assertion_revision:1},
 ]};
}
it('业务探针没有文件边，代码回归保留真实路径，原登记不变',()=>{
 const s=snapshot(),before=structuredClone(s),edges=definitionEdges(s);
 expect(edges.every(e=>typeof e.dst_path==='string'&&e.dst_path.trim().length>0)).toBe(true);
 expect(edges.filter(e=>e.detail.via==='current_assertion_registration').map(e=>e.dst_path)).toEqual(['tests/controller.test.js']);
 expect(s).toEqual(before);
});
it('纯业务探针仍保留固定定义边，不生成伪代码路径',()=>{
 const s=snapshot();s.assertions=s.assertions.slice(0,1);
 expect(definitionEdges(s).map(e=>e.dst_path)).toEqual(['contracts/workflow.yaml','contracts/activity.yaml']);
});
it('定义来源与实现绑定空路径明确失败，不丢边冒充成功',()=>{
 for(const bad of [undefined,null,'','  ',42])for(const target of ['workflow','activity','binding']) {
  const s=snapshot();
  if(target==='workflow')s.definitions.workflows[0].source_path=bad;
  if(target==='activity')s.definitions.activities[0].source_path=bad;
  if(target==='binding')s.definitions.activities[0].payload.implementation_bindings[0].path=bad;
  expect(()=>definitionEdges(s)).toThrow();
 }
});
it('代码断言路径穿越拒绝，既有不可分类断言保留兼容行为',()=>{
 const s=snapshot();s.assertions[1].assertion_ref='../outside.test.js';
 expect(()=>definitionEdges(s)).toThrow();
 s.assertions[1].assertion_ref='manual:echo unknown';
 expect(definitionEdges(s)).toHaveLength(2);
});

it('Brain 单包读者可读取空冻结定义图，不要求安装扫描器依赖或触发扫描',()=>{
 const s={repo:'perfectuser21/cecelia',revision:'a'.repeat(40),definitions:{workflows:[],activities:[]},assertions:[]};
 const before=structuredClone(s);
 expect(definitionEdges(s)).toEqual([]);
 expect(s).toEqual(before);
});
